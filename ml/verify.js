/**
 * Sanity checks for the simulation layer. Run with `npm run verify`.
 * These are the invariants that must hold before any of the risk labels mean
 * anything: the intact grid must be secure, cascades must be monotone in
 * severity, and the risk distribution must be neither all-zero nor all-one.
 */

import { generateGrid } from '../shared/grid.js';
import { reinforceGrid, contingencyAnalysis, runCascade, solveBaseCase } from '../shared/powerflow.js';
import { extractFeatures } from '../shared/features.js';

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? '  pass' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

console.log('\nGridSentinel simulation checks\n');

const t0 = Date.now();
let riskValues = [];
let shedValues = [];

for (let seed = 1; seed <= 6; seed++) {
  const grid = generateGrid(seed * 977);
  const base = reinforceGrid(grid);

  console.log(
    `grid ${seed}: ${grid.busCount} buses, ${grid.lines.length} circuits, ` +
      `${grid.totalDemand.toFixed(0)} MW demand, reserve ${(grid.reserveMargin * 100 - 100).toFixed(0)}%`
  );

  let worstBase = 0;
  for (let k = 0; k < grid.lines.length; k++) worstBase = Math.max(worstBase, base.loading[k]);
  check('intact network is secure', worstBase <= 0.95, `worst loading ${worstBase.toFixed(2)}`);
  check('intact network is connected', base.islands === 1, `${base.islands} islands`);
  check('no load shed in base case', base.loadShed < 1e-6, `${base.loadShed.toFixed(1)} MW`);

  const analysis = contingencyAnalysis(grid, { baseState: base });
  const risks = Array.from(analysis.nodeRisk);
  riskValues = riskValues.concat(risks);
  shedValues.push(analysis.expectedShed);

  const atRisk = risks.filter((r) => r > 0.15).length;
  console.log(`        ${atRisk}/${grid.busCount} buses above 0.15 risk`);
  check('risk in [0,1]', risks.every((r) => r >= 0 && r <= 1.0001));
  check('grid is not uniformly doomed', atRisk < grid.busCount);

  const { nodeFeatures } = extractFeatures(grid, base);
  check('features finite', nodeFeatures.every(Number.isFinite));

  const worst = runCascade(grid, [analysis.worstLine]);
  check(
    'worst contingency causes measurable impact',
    worst.loadShed > 0,
    `${worst.loadShed.toFixed(0)} MW over ${worst.rounds} rounds`
  );
  console.log('');
}

const mean = riskValues.reduce((a, b) => a + b, 0) / riskValues.length;
const positive = riskValues.filter((r) => r > 0.15).length / riskValues.length;
check('label balance is trainable across the corpus', positive > 0.05 && positive < 0.6, `${(positive * 100).toFixed(1)}% positive`);
console.log(`mean bus risk ............ ${mean.toFixed(3)}`);
console.log(`share above 0.15 ......... ${(positive * 100).toFixed(1)}%`);
console.log(`mean expected load shed .. ${((shedValues.reduce((a, b) => a + b, 0) / shedValues.length) * 100).toFixed(1)}%`);
console.log(`elapsed .................. ${Date.now() - t0} ms`);
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
