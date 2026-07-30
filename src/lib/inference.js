/**
 * Browser-side inference.
 *
 * Loads the weights exported by the training pipeline and runs the exact same
 * forward pass that produced the reported metrics. No server, no API call —
 * the network runs in the tab.
 */

import { TopoRiskNet } from '@shared/model.js';
import { noGrad, resetTape } from '@shared/autograd.js';
import { extractFeatures, buildMessageIndex } from '@shared/features.js';

let modelPromise = null;
let report = null;

export async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [weightsResponse, reportResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}model/toporisknet.json`),
        fetch(`${import.meta.env.BASE_URL}model/training-report.json`),
      ]);
      if (!weightsResponse.ok) throw new Error(`Model weights unavailable (${weightsResponse.status})`);
      const json = await weightsResponse.json();
      report = reportResponse.ok ? await reportResponse.json() : null;
      const net = TopoRiskNet.fromJSON(json);
      // One warm pass so the first user-visible timing is not a JIT artefact.
      return net;
    })();
  }
  return modelPromise;
}

export function getReport() {
  return report;
}

/** Package a solved grid into the tensors the network expects. */
export function toSample(grid, state) {
  const { nodeFeatures, edgeFeatures, n, edgeCount } = extractFeatures(grid, state);
  return {
    n,
    edgeCount,
    nodeFeatures,
    edgeFeatures,
    index: buildMessageIndex(grid),
    fromIndex: Int32Array.from(grid.lines, (l) => l.from),
    toIndex: Int32Array.from(grid.lines, (l) => l.to),
  };
}

/**
 * Score a grid. Returns per-bus outage probabilities, per-circuit criticality,
 * the learned embeddings, and how long the forward pass took.
 */
export function predict(net, sample) {
  const t0 = performance.now();
  let nodeRisk;
  let edgeCriticality;
  let embedding;
  noGrad(() => {
    const out = net.forward(sample);
    nodeRisk = Float64Array.from(out.nodeRisk.data);
    edgeCriticality = Float64Array.from(out.edgeCriticality.data);
    embedding = { data: Float64Array.from(out.embedding.data), rows: out.embedding.rows, cols: out.embedding.cols };
    resetTape();
  });
  return { nodeRisk, edgeCriticality, embedding, ms: performance.now() - t0 };
}

/** Run the model a few times and keep the fastest — timers are noisy. */
export function benchmarkPredict(net, sample, reps = 12) {
  let bestMs = Infinity;
  let result = null;
  for (let i = 0; i < reps; i++) {
    const r = predict(net, sample);
    if (r.ms < bestMs) {
      bestMs = r.ms;
      result = r;
    }
  }
  return { ...result, ms: bestMs };
}

/**
 * Undo the square-root compression applied to circuit-criticality targets
 * during training, so the number shown is a share of system load again.
 */
export function decodeCriticality(value) {
  return value * value;
}
