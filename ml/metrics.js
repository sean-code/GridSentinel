/**
 * Evaluation metrics.
 *
 * Risk scoring is an imbalanced ranking problem, so accuracy would be
 * misleading — a model that declares every bus safe scores well and helps
 * nobody. These are the measures that actually reflect operator value:
 * ranking quality (AUC, average precision), calibration (Brier), and whether
 * the handful of circuits at the top of the list are the right ones.
 */

export function rocAuc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  // Average ranks over ties.
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && pairs[j + 1][0] === pairs[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }
  let positives = 0;
  let rankSum = 0;
  for (let k = 0; k < n; k++) {
    if (pairs[k][1] === 1) {
      positives++;
      rankSum += ranks[k];
    }
  }
  const negatives = n - positives;
  if (positives === 0 || negatives === 0) return NaN;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function averagePrecision(scores, labels) {
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  let tp = 0;
  let sum = 0;
  const totalPositives = labels.reduce((a, b) => a + b, 0);
  if (totalPositives === 0) return NaN;
  order.forEach((idx, rank) => {
    if (labels[idx] === 1) {
      tp++;
      sum += tp / (rank + 1);
    }
  });
  return sum / totalPositives;
}

export function brier(scores, labels) {
  let s = 0;
  for (let i = 0; i < scores.length; i++) s += (scores[i] - labels[i]) ** 2;
  return s / scores.length;
}

export function mae(pred, target) {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += Math.abs(pred[i] - target[i]);
  return s / pred.length;
}

export function pearson(a, b) {
  const n = a.length;
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
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

function rankOf(values) {
  const order = values.map((v, i) => i).sort((x, y) => values[x] - values[y]);
  const ranks = new Float64Array(values.length);
  order.forEach((idx, r) => {
    ranks[idx] = r;
  });
  return Array.from(ranks);
}

export function spearman(a, b) {
  return pearson(rankOf(Array.from(a)), rankOf(Array.from(b)));
}

/**
 * Of the k circuits the model flags as most critical, what share are genuinely
 * in the true top k? This is the number that decides whether an operator's
 * morning worklist is the right worklist.
 */
export function precisionAtK(pred, target, k) {
  const n = pred.length;
  const kk = Math.min(k, n);
  if (kk === 0) return NaN;
  const predTop = new Set(
    pred
      .map((v, i) => i)
      .sort((a, b) => pred[b] - pred[a])
      .slice(0, kk)
  );
  const trueTop = new Set(
    target
      .map((v, i) => i)
      .sort((a, b) => target[b] - target[a])
      .slice(0, kk)
  );
  let hit = 0;
  for (const i of predTop) if (trueTop.has(i)) hit++;
  return hit / kk;
}
