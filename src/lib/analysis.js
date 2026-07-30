/**
 * The physics reference, run in the browser.
 *
 * This is the same contingency study that generated the training labels, but
 * sliced into chunks that yield to the event loop between batches. That keeps
 * the page responsive and — more usefully — lets the interface show the study
 * grinding through contingencies in real time, right next to a network
 * prediction that already finished.
 *
 * The honest comparison is the point of the whole project, so the reference
 * implementation gets to run at full fidelity rather than being stubbed out.
 */

import { runCascade, failureHazard, solveBaseCase } from '@shared/powerflow.js';

const CHUNK = 6;

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {object} grid
 * @param {object} baseState result of solveBaseCase
 * @param {(progress: {done: number, total: number, elapsed: number}) => void} onProgress
 * @param {() => boolean} shouldCancel
 */
export async function runContingencyStudy(grid, baseState, onProgress = null, shouldCancel = null) {
  const base = baseState || solveBaseCase(grid);
  const lines = grid.lines;
  const n = grid.busCount;

  const hazards = lines.map((line, k) => failureHazard(line, base.loading[k]));
  const nodeRisk = new Float64Array(n);
  const lineCriticality = new Float64Array(lines.length);
  const lineIslanding = new Uint8Array(lines.length);
  const lineRounds = new Uint8Array(lines.length);

  let hazardSum = 0;
  let expectedShed = 0;
  let worstShed = 0;
  let worstLine = -1;

  const started = performance.now();

  for (let k = 0; k < lines.length; k++) {
    if (shouldCancel && shouldCancel()) return null;

    const h = hazards[k];
    hazardSum += h;
    const result = runCascade(grid, [k]);
    const shedFraction = grid.totalDemand > 0 ? result.loadShed / grid.totalDemand : 0;

    lineCriticality[k] = shedFraction;
    lineIslanding[k] = result.state.islands > 1 ? 1 : 0;
    lineRounds[k] = Math.min(result.rounds, 255);
    expectedShed += h * shedFraction;

    if (shedFraction > worstShed) {
      worstShed = shedFraction;
      worstLine = k;
    }
    for (let i = 0; i < n; i++) if (result.deEnergized[i]) nodeRisk[i] += h;

    if ((k + 1) % CHUNK === 0 || k === lines.length - 1) {
      if (onProgress) {
        onProgress({ done: k + 1, total: lines.length, elapsed: performance.now() - started });
      }
      await yieldToBrowser();
    }
  }

  if (hazardSum > 0) {
    for (let i = 0; i < n; i++) nodeRisk[i] /= hazardSum;
    expectedShed /= hazardSum;
  }

  return {
    nodeRisk,
    lineCriticality,
    lineIslanding,
    lineRounds,
    hazards,
    expectedShed,
    worstShed,
    worstLine,
    contingencies: lines.length,
    // Wall-clock excludes the artificial yields so the comparison is fair to
    // the simulator rather than flattering to the model.
    computeMs: performance.now() - started,
  };
}

/** Rank correlation between the model's ordering and the study's ordering. */
export function agreement(predicted, actual) {
  const n = predicted.length;
  if (n < 3) return NaN;
  const rank = (values) => {
    const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
    const ranks = new Float64Array(n);
    order.forEach((idx, r) => {
      ranks[idx] = r;
    });
    return ranks;
  };
  const a = rank(predicted);
  const b = rank(actual);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

/** Mean absolute error between two equally sized score vectors. */
export function meanAbsoluteError(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
