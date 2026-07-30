/**
 * Finite-difference gradient check.
 *
 * The autodiff engine is hand-written, so before trusting a single training
 * curve it is worth proving that every analytic gradient matches a numerical
 * one. This perturbs randomly sampled parameters by ±h and compares the
 * resulting change in loss against the gradient the tape produced.
 *
 *   node ml/gradcheck.js
 */

import { Rng } from '../shared/rng.js';
import { TopoRiskNet } from '../shared/model.js';
import { backward, bceLoss, addLoss, resetTape, noGrad } from '../shared/autograd.js';
import { buildSample } from './dataset.js';

const H = 1e-5;
const TOLERANCE = 2e-4;
const CHECKS_PER_TENSOR = 3;

const sample = buildSample(424_242);
const rng = new Rng(11);
const net = new TopoRiskNet({ hidden: 12, layers: 2, headHidden: 8 }, rng);

function lossOf() {
  let value = 0;
  noGrad(() => {
    const out = net.forward(sample);
    const a = bceLoss(out.nodeRisk, sample.nodeTarget, 1);
    const b = bceLoss(out.edgeCriticality, sample.edgeTarget, 0.5);
    value = a.data[0] + b.data[0];
    resetTape();
  });
  return value;
}

// Analytic pass.
resetTape();
const out = net.forward(sample);
const loss = addLoss(bceLoss(out.nodeRisk, sample.nodeTarget, 1), bceLoss(out.edgeCriticality, sample.edgeTarget, 0.5));
backward(loss);

const params = net.parameters();
console.log(`\nGradient check — ${params.length} parameter tensors, ${net.parameterCount()} values\n`);

let worst = 0;
let worstName = '';
let failures = 0;
let checked = 0;
const picker = new Rng(99);

params.forEach((p, pi) => {
  for (let c = 0; c < CHECKS_PER_TENSOR; c++) {
    const idx = picker.int(0, p.data.length);
    const analytic = p.grad[idx];
    const original = p.data[idx];

    p.data[idx] = original + H;
    const plus = lossOf();
    p.data[idx] = original - H;
    const minus = lossOf();
    p.data[idx] = original;

    const numeric = (plus - minus) / (2 * H);
    const scale = Math.max(1e-6, Math.abs(analytic) + Math.abs(numeric));
    const relative = Math.abs(analytic - numeric) / scale;
    checked++;
    if (relative > worst) {
      worst = relative;
      worstName = `tensor ${pi}[${idx}]`;
    }
    if (relative > TOLERANCE) {
      failures++;
      console.log(`  FAIL tensor ${pi}[${idx}]  analytic ${analytic.toExponential(4)}  numeric ${numeric.toExponential(4)}  rel ${relative.toExponential(2)}`);
    }
  }
});

console.log(`  checked ${checked} partial derivatives`);
console.log(`  worst relative error ${worst.toExponential(2)} at ${worstName}`);
console.log(`\n${failures === 0 ? 'autograd verified' : `${failures} GRADIENT MISMATCH(ES)`}\n`);
process.exit(failures === 0 ? 0 : 1);
