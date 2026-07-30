/**
 * Training pipeline.
 *
 * Trains TopoRiskNet and its graph-blind ablation on identical data with an
 * identical budget, evaluates both on a held-out split, benchmarks inference
 * against the physics simulator it replaces, and writes everything the web app
 * needs into public/model/.
 *
 *   node ml/train.js [--epochs 45] [--quick] [--seed 7]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Rng } from '../shared/rng.js';
import { TopoRiskNet } from '../shared/model.js';
import { Adam, backward, bceLoss, addLoss, resetTape, noGrad } from '../shared/autograd.js';
import { buildSplit, datasetStats, SPLITS, RISK_THRESHOLD } from './dataset.js';
import { rocAuc, averagePrecision, brier, mae, pearson, spearman, precisionAtK } from './metrics.js';
import { generateGrid } from '../shared/grid.js';
import { reinforceGrid, contingencyAnalysis } from '../shared/powerflow.js';
import { extractFeatures, buildMessageIndex } from '../shared/features.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/model');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? Number(args[i + 1]) : fallback;
};
const QUICK = args.includes('--quick');
const EPOCHS = flag('epochs', QUICK ? 4 : 45);
const SEED = flag('seed', 7);
const BATCH = 8;
const EDGE_LOSS_WEIGHT = 0.5;

function log(...a) {
  console.log(...a);
}

function fmt(x, d = 4) {
  return Number.isFinite(x) ? x.toFixed(d) : '  n/a';
}

// --------------------------------------------------------------------------
// Data
// --------------------------------------------------------------------------

log('\n════ GridSentinel · TopoRiskNet training ════\n');

const splitSizes = QUICK
  ? { train: 60, val: 25, test: 40 }
  : { train: SPLITS.train.count, val: SPLITS.val.count, test: SPLITS.test.count };

const dataStart = Date.now();
log('Simulating training corpus (full N-1 contingency study per grid)…');
const train = buildSplit(SPLITS.train.start, splitSizes.train, (i, n) =>
  process.stdout.write(`\r  train  ${i}/${n} grids`)
);
process.stdout.write('\r  train  done                    \n');
const val = buildSplit(SPLITS.val.start, splitSizes.val);
log('  val    done');
const test = buildSplit(SPLITS.test.start, splitSizes.test);
log('  test   done');
const dataMs = Date.now() - dataStart;

const stats = {
  train: datasetStats(train),
  val: datasetStats(val),
  test: datasetStats(test),
};

log(
  `\n  ${stats.train.grids + stats.val.grids + stats.test.grids} grids · ` +
    `${stats.train.buses + stats.val.buses + stats.test.buses} buses · ` +
    `${(stats.train.contingenciesSimulated + stats.val.contingenciesSimulated + stats.test.contingenciesSimulated).toLocaleString()} contingencies simulated`
);
log(`  positive rate ${(stats.train.positiveRate * 100).toFixed(1)}% · built in ${(dataMs / 1000).toFixed(1)}s\n`);

// --------------------------------------------------------------------------
// Training
// --------------------------------------------------------------------------

function snapshot(net) {
  return net.parameters().map((p) => Float64Array.from(p.data));
}

function restore(net, snap) {
  net.parameters().forEach((p, i) => p.data.set(snap[i]));
}

function evaluate(net, samples, { collect = false } = {}) {
  const nodeScores = [];
  const nodeLabels = [];
  const nodeTargets = [];
  const edgeScores = [];
  const edgeTargets = [];
  let perGridEdgePrecision = 0;
  let gridsWithEdges = 0;

  noGrad(() => {
    for (const s of samples) {
      const out = net.forward(s);
      resetTape();
      for (let i = 0; i < s.n; i++) {
        nodeScores.push(out.nodeRisk.data[i]);
        nodeTargets.push(s.nodeTarget[i]);
        nodeLabels.push(s.nodeTarget[i] > RISK_THRESHOLD ? 1 : 0);
      }
      const ePred = [];
      const eTrue = [];
      for (let k = 0; k < s.edgeCount; k++) {
        edgeScores.push(out.edgeCriticality.data[k]);
        edgeTargets.push(s.edgeTarget[k]);
        ePred.push(out.edgeCriticality.data[k]);
        eTrue.push(s.edgeTarget[k]);
      }
      if (s.edgeCount >= 5) {
        perGridEdgePrecision += precisionAtK(ePred, eTrue, 5);
        gridsWithEdges++;
      }
    }
  });

  const result = {
    nodeAuc: rocAuc(nodeScores, nodeLabels),
    nodeAveragePrecision: averagePrecision(nodeScores, nodeLabels),
    nodeBrier: brier(nodeScores, nodeLabels),
    nodeMae: mae(nodeScores, nodeTargets),
    edgeSpearman: spearman(edgeScores, edgeTargets),
    edgePearson: pearson(edgeScores, edgeTargets),
    edgeMae: mae(edgeScores, edgeTargets),
    edgePrecisionAt5: gridsWithEdges ? perGridEdgePrecision / gridsWithEdges : NaN,
    positiveRate: nodeLabels.reduce((a, b) => a + b, 0) / nodeLabels.length,
  };
  if (collect) {
    result.reliability = reliabilityCurve(nodeScores, nodeLabels);
    result.scoreHistogram = histogram(nodeScores, 20);
  }
  return result;
}

function reliabilityCurve(scores, labels, bins = 10) {
  const out = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    let n = 0;
    let sumPred = 0;
    let sumLabel = 0;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] >= lo && (scores[i] < hi || (b === bins - 1 && scores[i] <= hi))) {
        n++;
        sumPred += scores[i];
        sumLabel += labels[i];
      }
    }
    out.push({ bin: (lo + hi) / 2, count: n, predicted: n ? sumPred / n : null, observed: n ? sumLabel / n : null });
  }
  return out;
}

function histogram(values, bins) {
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(v * bins)));
    counts[b]++;
  }
  return counts;
}

function trainModel(label, useGraph) {
  log(`── training ${label} ──`);
  const rng = new Rng(SEED);
  const net = new TopoRiskNet({ useGraph }, rng);
  const params = net.parameters();
  const optimiser = new Adam(params, { lr: 4e-3, weightDecay: 1e-5 });

  log(`  ${net.parameterCount().toLocaleString()} parameters`);

  const history = [];
  let best = { auc: -Infinity, epoch: -1, snap: snapshot(net) };
  const order = [...train.keys()];
  const shuffler = new Rng(SEED + 101);
  const t0 = Date.now();

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Cosine decay: large steps to find the basin, small ones to settle in it.
    optimiser.lr = 2e-4 + 0.5 * (4e-3 - 2e-4) * (1 + Math.cos((Math.PI * epoch) / EPOCHS));
    shuffler.shuffle(order);

    let epochLoss = 0;
    let seen = 0;
    optimiser.zeroGrad();

    for (let b = 0; b < order.length; b++) {
      const sample = train[order[b]];
      const out = net.forward(sample);
      const nodeLoss = bceLoss(out.nodeRisk, sample.nodeTarget, 1);
      const edgeLoss = bceLoss(out.edgeCriticality, sample.edgeTarget, EDGE_LOSS_WEIGHT);
      const loss = addLoss(nodeLoss, edgeLoss);
      backward(loss);
      epochLoss += loss.data[0];
      seen++;

      if (seen % BATCH === 0 || b === order.length - 1) {
        // Gradients accumulated over the batch; scale back to a mean.
        const scale = 1 / Math.min(BATCH, seen);
        for (const p of params) if (p.grad) for (let i = 0; i < p.grad.length; i++) p.grad[i] *= scale;
        optimiser.clipGradients(5);
        optimiser.step();
        optimiser.zeroGrad();
      }
    }

    const valMetrics = evaluate(net, val);
    history.push({
      epoch: epoch + 1,
      loss: epochLoss / seen,
      valAuc: valMetrics.nodeAuc,
      valMae: valMetrics.nodeMae,
      valEdgeSpearman: valMetrics.edgeSpearman,
      lr: optimiser.lr,
    });

    if (valMetrics.nodeAuc > best.auc) {
      best = { auc: valMetrics.nodeAuc, epoch: epoch + 1, snap: snapshot(net) };
    }

    const bar = '█'.repeat(Math.round(Math.max(0, valMetrics.nodeAuc - 0.5) * 40));
    log(
      `  epoch ${String(epoch + 1).padStart(3)}  loss ${fmt(epochLoss / seen)}  ` +
        `val AUC ${fmt(valMetrics.nodeAuc)}  MAE ${fmt(valMetrics.nodeMae)}  ${bar}`
    );
  }

  restore(net, best.snap);
  const seconds = (Date.now() - t0) / 1000;
  log(`  best epoch ${best.epoch} (val AUC ${fmt(best.auc)}) · ${seconds.toFixed(1)}s\n`);
  return { net, history, bestEpoch: best.epoch, trainSeconds: seconds };
}

const gnn = trainModel('TopoRiskNet (graph)', true);
const baseline = trainModel('Baseline MLP (graph-blind)', false);

// --------------------------------------------------------------------------
// Evaluation
// --------------------------------------------------------------------------

log('── held-out evaluation ──');
const gnnTest = evaluate(gnn.net, test, { collect: true });
const baseTest = evaluate(baseline.net, test, { collect: true });

const rows = [
  ['bus risk ROC-AUC', gnnTest.nodeAuc, baseTest.nodeAuc],
  ['bus risk avg precision', gnnTest.nodeAveragePrecision, baseTest.nodeAveragePrecision],
  ['bus risk Brier (lower better)', gnnTest.nodeBrier, baseTest.nodeBrier],
  ['bus risk MAE (lower better)', gnnTest.nodeMae, baseTest.nodeMae],
  ['circuit criticality Spearman', gnnTest.edgeSpearman, baseTest.edgeSpearman],
  ['circuit top-5 precision', gnnTest.edgePrecisionAt5, baseTest.edgePrecisionAt5],
];
log(`  ${'metric'.padEnd(32)} ${'graph'.padStart(8)} ${'blind'.padStart(8)}   delta`);
for (const [name, a, b] of rows) {
  log(`  ${name.padEnd(32)} ${fmt(a).padStart(8)} ${fmt(b).padStart(8)}   ${(a - b >= 0 ? '+' : '') + fmt(a - b, 3)}`);
}

// --------------------------------------------------------------------------
// Speed benchmark: surrogate vs simulator
// --------------------------------------------------------------------------

log('\n── inference vs simulation, by system size ──');

/**
 * The two methods have different complexity. A contingency study is
 * O(circuits x cascade rounds x buses^3) because every contingency needs its
 * own factorisation; the surrogate is O(circuits x hidden^2) — linear in the
 * size of the system. On a 40-bus toy the gap is unremarkable. It is the slope
 * that matters, so the benchmark sweeps sizes instead of quoting one number.
 */
function makeSample(grid, base) {
  const { nodeFeatures, edgeFeatures, n, edgeCount } = extractFeatures(grid, base);
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

// Warm the JIT so the first measured call is not paying compilation costs.
{
  const g = generateGrid(999_331, { busCount: 48 });
  const b = reinforceGrid(g);
  const s = makeSample(g, b);
  for (let i = 0; i < 40; i++) noGrad(() => { gnn.net.forward(s); resetTape(); });
  contingencyAnalysis(g, { baseState: b });
}

const sweep = QUICK
  ? [{ buses: 40, repeats: 2 }, { buses: 80, repeats: 1 }]
  : [
      { buses: 40, repeats: 3 },
      { buses: 70, repeats: 3 },
      { buses: 110, repeats: 2 },
      { buses: 160, repeats: 2 },
    ];

const scaling = [];
log(`  ${'buses'.padStart(6)} ${'circuits'.padStart(9)} ${'physics'.padStart(11)} ${'surrogate'.padStart(11)} ${'speedup'.padStart(9)}`);

for (const point of sweep) {
  let simMs = 0;
  let netMs = 0;
  let circuits = 0;
  let contingencies = 0;

  for (let r = 0; r < point.repeats; r++) {
    const grid = generateGrid(3_000_000 + point.buses * 1000 + r * 7919, { busCount: point.buses });
    const base = reinforceGrid(grid);
    const sample = makeSample(grid, base);
    circuits += grid.lines.length;

    let t = process.hrtime.bigint();
    const analysis = contingencyAnalysis(grid, { baseState: base });
    simMs += Number(process.hrtime.bigint() - t) / 1e6;
    contingencies += analysis.contingenciesRun;

    // Average several inference passes — a single one is below timer noise.
    t = process.hrtime.bigint();
    const REPS = 20;
    noGrad(() => {
      for (let i = 0; i < REPS; i++) {
        gnn.net.forward(sample);
        resetTape();
      }
    });
    netMs += Number(process.hrtime.bigint() - t) / 1e6 / REPS;
  }

  const entry = {
    buses: point.buses,
    circuits: circuits / point.repeats,
    contingencies: contingencies / point.repeats,
    simulatorMs: simMs / point.repeats,
    surrogateMs: netMs / point.repeats,
    speedup: simMs / netMs,
  };
  scaling.push(entry);
  log(
    `  ${String(point.buses).padStart(6)} ${entry.circuits.toFixed(0).padStart(9)} ` +
      `${(entry.simulatorMs.toFixed(1) + ' ms').padStart(11)} ${(entry.surrogateMs.toFixed(2) + ' ms').padStart(11)} ` +
      `${(entry.speedup.toFixed(0) + 'x').padStart(9)}`
  );
}

const largest = scaling[scaling.length - 1];
const benchmark = {
  scaling,
  headline: {
    buses: largest.buses,
    simulatorMs: largest.simulatorMs,
    surrogateMs: largest.surrogateMs,
    speedup: largest.speedup,
  },
};
log('');

// --------------------------------------------------------------------------
// Export
// --------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const weightsPath = resolve(OUT_DIR, 'toporisknet.json');
writeFileSync(weightsPath, JSON.stringify(gnn.net.toJSON()));

const report = {
  generatedAt: new Date().toISOString(),
  riskThreshold: RISK_THRESHOLD,
  epochs: EPOCHS,
  batchSize: BATCH,
  seed: SEED,
  quick: QUICK,
  architecture: {
    name: 'TopoRiskNet',
    family: 'edge-gated GraphSAGE',
    hidden: gnn.net.config.hidden,
    layers: gnn.net.config.layers,
    headHidden: gnn.net.config.headHidden,
    parameters: gnn.net.parameterCount(),
    baselineParameters: baseline.net.parameterCount(),
  },
  dataset: stats,
  datasetBuildSeconds: dataMs / 1000,
  training: {
    graph: { history: gnn.history, bestEpoch: gnn.bestEpoch, seconds: gnn.trainSeconds },
    blind: { history: baseline.history, bestEpoch: baseline.bestEpoch, seconds: baseline.trainSeconds },
  },
  test: { graph: gnnTest, blind: baseTest },
  benchmark,
};

writeFileSync(resolve(OUT_DIR, 'training-report.json'), JSON.stringify(report, null, 2));

const kb = (p) => (Buffer.byteLength(JSON.stringify(p)) / 1024).toFixed(0);
log(`wrote public/model/toporisknet.json      ${kb(gnn.net.toJSON())} KB`);
log(`wrote public/model/training-report.json  ${kb(report)} KB\n`);
log('done.\n');
