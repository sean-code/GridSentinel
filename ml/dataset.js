/**
 * Dataset construction.
 *
 * Each training example is one whole grid under one operating scenario. The
 * label is produced by running a full probability-weighted N-1 contingency
 * study with cascade propagation — the expensive computation the network is
 * being trained to replace.
 *
 * Scenario knobs are sampled explicitly rather than left to chance so the
 * corpus covers the operating envelope: quiet nights through peak load under
 * storm conditions, thin and thick reserve margins, radial and heavily meshed
 * topologies. A surrogate is only trustworthy inside the envelope it saw.
 */

import { Rng } from '../shared/rng.js';
import { generateGrid } from '../shared/grid.js';
import { reinforceGrid, contingencyAnalysis } from '../shared/powerflow.js';
import { extractFeatures, buildMessageIndex } from '../shared/features.js';

/** Bus is treated as "at risk" above this probability for classification metrics. */
export const RISK_THRESHOLD = 0.15;

export function makeScenario(seed) {
  const rng = new Rng(seed ^ 0x9e3779b9);
  return {
    busCount: rng.int(30, 66),
    // Peak-day loading is where the interesting failures live, so it is
    // oversampled relative to a uniform draw.
    demandScale: rng.bool(0.55) ? rng.range(1.0, 1.35) : rng.range(0.72, 1.02),
    weatherSeverity: rng.bool(0.4) ? rng.range(0.45, 1.0) : rng.range(0.0, 0.45),
    meshDensity: rng.range(0.28, 0.8),
  };
}

/** Build a single labelled example from a seed. */
export function buildSample(seed) {
  const scenario = makeScenario(seed);
  const grid = generateGrid(seed, scenario);
  const base = reinforceGrid(grid);
  const analysis = contingencyAnalysis(grid, { baseState: base });
  const { nodeFeatures, edgeFeatures, n, edgeCount } = extractFeatures(grid, base);
  const index = buildMessageIndex(grid);

  const fromIndex = Int32Array.from(grid.lines, (l) => l.from);
  const toIndex = Int32Array.from(grid.lines, (l) => l.to);

  return {
    seed,
    n,
    edgeCount,
    nodeFeatures,
    edgeFeatures,
    index,
    fromIndex,
    toIndex,
    nodeTarget: analysis.nodeRisk,
    // Load-shed fractions are small and skewed; a square root spreads them
    // across the sigmoid's usable range instead of piling them near zero.
    edgeTarget: Float64Array.from(analysis.lineCriticality, (v) => Math.sqrt(Math.min(v, 1))),
    meta: {
      busCount: grid.busCount,
      lineCount: grid.lines.length,
      totalDemand: grid.totalDemand,
      reserveMargin: grid.reserveMargin,
      weatherSeverity: grid.weatherSeverity,
      demandScale: grid.demandScale,
      expectedShed: analysis.expectedShed,
      contingencies: analysis.contingenciesRun,
    },
  };
}

/**
 * Build a split. Seed ranges are disjoint by construction, so there is no way
 * for a validation grid to leak into training.
 */
export function buildSplit(startSeed, count, onProgress = null) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push(buildSample(startSeed + i * 7919));
    if (onProgress && (i + 1) % 25 === 0) onProgress(i + 1, count);
  }
  return samples;
}

export const SPLITS = {
  train: { start: 1_000_000, count: 420 },
  val: { start: 5_000_000, count: 90 },
  test: { start: 9_000_000, count: 140 },
};

export function datasetStats(samples) {
  let nodes = 0;
  let edges = 0;
  let positives = 0;
  let riskSum = 0;
  let contingencies = 0;
  let demand = 0;
  for (const s of samples) {
    nodes += s.n;
    edges += s.edgeCount;
    contingencies += s.meta.contingencies;
    demand += s.meta.totalDemand;
    for (let i = 0; i < s.n; i++) {
      riskSum += s.nodeTarget[i];
      if (s.nodeTarget[i] > RISK_THRESHOLD) positives++;
    }
  }
  return {
    grids: samples.length,
    buses: nodes,
    circuits: edges,
    meanBuses: nodes / samples.length,
    meanCircuits: edges / samples.length,
    meanDemandMw: demand / samples.length,
    contingenciesSimulated: contingencies,
    positiveRate: positives / nodes,
    meanRisk: riskSum / nodes,
  };
}
