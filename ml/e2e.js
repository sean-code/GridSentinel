/**
 * End-to-end check of the paths the browser actually executes.
 *
 * Loads the exported weights from disk exactly as the app fetches them, scores
 * a grid, runs the physics study, and compares the two. If this passes, the
 * deployed site works — the browser runs this same code.
 *
 *   node ml/e2e.js
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TopoRiskNet } from '../shared/model.js';
import { noGrad, resetTape } from '../shared/autograd.js';
import { generateGrid } from '../shared/grid.js';
import { reinforceGrid, contingencyAnalysis, runCascade, solveNetwork } from '../shared/powerflow.js';
import { extractFeatures, buildMessageIndex } from '../shared/features.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  pass' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

console.log('\nGridSentinel end-to-end check\n');

// 1. Weights load the way the browser loads them.
const weights = JSON.parse(readFileSync(resolve(HERE, '../public/model/toporisknet.json'), 'utf8'));
const report = JSON.parse(readFileSync(resolve(HERE, '../public/model/training-report.json'), 'utf8'));
const net = TopoRiskNet.fromJSON(weights);

check('weights deserialise', net.parameterCount() > 0, `${net.parameterCount().toLocaleString()} params`);
check('format tag present', weights.format === 'toporisknet/1');
check('report has test metrics', Number.isFinite(report.test.graph.nodeAuc), `AUC ${report.test.graph.nodeAuc.toFixed(3)}`);
check('report has scaling sweep', report.benchmark.scaling.length >= 2);
check('report has reliability bins', Array.isArray(report.test.graph.reliability));

// 2. Score grids across the scenarios the UI exposes.
const scenarios = [
  { id: 'normal', demandScale: 0.95, weatherSeverity: 0.1 },
  { id: 'peak', demandScale: 1.28, weatherSeverity: 0.2 },
  { id: 'storm', demandScale: 1.05, weatherSeverity: 0.85 },
  { id: 'peak-storm', demandScale: 1.3, weatherSeverity: 0.9 },
  { id: 'light', demandScale: 0.72, weatherSeverity: 0.05 },
];
const sizes = [38, 62, 88, 120];

let agreementSum = 0;
let agreementCount = 0;

for (const size of sizes) {
  for (const scenario of scenarios) {
    const grid = generateGrid(20260730, {
      busCount: size,
      demandScale: scenario.demandScale,
      weatherSeverity: scenario.weatherSeverity,
    });
    const base = reinforceGrid(grid);
    const { nodeFeatures, edgeFeatures, n, edgeCount } = extractFeatures(grid, base);
    const sample = {
      n,
      edgeCount,
      nodeFeatures,
      edgeFeatures,
      index: buildMessageIndex(grid),
      fromIndex: Int32Array.from(grid.lines, (l) => l.from),
      toIndex: Int32Array.from(grid.lines, (l) => l.to),
    };

    let out;
    noGrad(() => {
      out = net.forward(sample);
      resetTape();
    });

    const risks = Array.from(out.nodeRisk.data);
    const ok =
      risks.length === grid.busCount &&
      risks.every((r) => Number.isFinite(r) && r >= 0 && r <= 1) &&
      Array.from(out.edgeCriticality.data).every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
    check(`score ${size} buses / ${scenario.id}`, ok);

    // Compare against the study on one representative case per size.
    if (scenario.id === 'peak') {
      const study = contingencyAnalysis(grid, { baseState: base });
      const rank = (arr) => {
        const order = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
        const r = new Float64Array(arr.length);
        order.forEach((idx, k) => {
          r[idx] = k;
        });
        return Array.from(r);
      };
      const a = rank(risks);
      const b = rank(Array.from(study.nodeRisk));
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
      }
      const rho = num / Math.sqrt(da * db);
      agreementSum += rho;
      agreementCount++;
      check(`  rank agreement at ${size} buses`, rho > 0.55, `rho ${rho.toFixed(3)}`);
    }
  }
}

// 3. Cascade replay — the frame construction the Cascade view depends on.
{
  const grid = generateGrid(20260730, { busCount: 62, demandScale: 1.28, weatherSeverity: 0.2 });
  reinforceGrid(grid);
  const analysis = contingencyAnalysis(grid);
  const trigger = analysis.worstLine;
  const result = runCascade(grid, [trigger]);

  const mask = new Uint8Array(grid.lines.length).fill(1);
  const frames = [];
  result.tripSequence.forEach((round) => {
    for (const k of round) mask[k] = 0;
    frames.push(solveNetwork(grid, mask));
  });

  check('cascade produces frames', frames.length === result.tripSequence.length, `${frames.length} rounds`);
  check(
    'every frame solves cleanly',
    frames.every((f) => Array.from(f.flows).every(Number.isFinite) && Array.from(f.loading).every(Number.isFinite))
  );
  check(
    'load shed is monotone through the cascade',
    frames.every((f, i) => i === 0 || f.loadShed >= frames[i - 1].loadShed - 1e-6),
    `final ${frames[frames.length - 1].loadShed.toFixed(0)} MW`
  );
  check('worst contingency does damage', result.loadShed > 0, `${result.loadShed.toFixed(0)} MW`);
}

// 4. Determinism — the seed promise the UI makes to the user.
{
  const a = generateGrid(12345, { busCount: 50 });
  const b = generateGrid(12345, { busCount: 50 });
  const same =
    a.lines.length === b.lines.length &&
    a.lines.every((l, i) => l.from === b.lines[i].from && l.to === b.lines[i].to) &&
    a.buses.every((bus, i) => Math.abs(bus.demand - b.buses[i].demand) < 1e-12);
  check('same seed gives the same grid', same);
}

console.log(`\n  mean rank agreement with the study: ${(agreementSum / agreementCount).toFixed(3)}`);
console.log(`\n${failures === 0 ? 'end-to-end verified' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
