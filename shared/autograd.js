/**
 * A small reverse-mode automatic differentiation engine over dense matrices.
 *
 * Written from scratch rather than pulled from a library for two reasons.
 * First, the trained model has to run in a browser tab with no build step and
 * no 90 MB runtime download. Second, and more importantly, the *same* forward
 * pass then serves both training and inference, so the network that scores a
 * grid in the browser is provably the network that was trained — there is no
 * second implementation to drift out of sync.
 *
 * Tensors are row-major [rows x cols]. Operations record a closure on a global
 * tape; `backward()` walks it in reverse accumulating gradients.
 */

let tape = [];
let recording = true;

export function noGrad(fn) {
  const previous = recording;
  recording = false;
  try {
    return fn();
  } finally {
    recording = previous;
  }
}

export function resetTape() {
  tape = [];
}

export class Tensor {
  constructor(rows, cols, data = null, requiresGrad = false) {
    this.rows = rows;
    this.cols = cols;
    this.data = data || new Float64Array(rows * cols);
    this.requiresGrad = requiresGrad;
    this.grad = requiresGrad ? new Float64Array(rows * cols) : null;
  }

  static zeros(rows, cols, requiresGrad = false) {
    return new Tensor(rows, cols, null, requiresGrad);
  }

  static from(rows, cols, data, requiresGrad = false) {
    return new Tensor(rows, cols, Float64Array.from(data), requiresGrad);
  }

  ensureGrad() {
    if (!this.grad) this.grad = new Float64Array(this.rows * this.cols);
    return this.grad;
  }

  zeroGrad() {
    if (this.grad) this.grad.fill(0);
  }

  get size() {
    return this.rows * this.cols;
  }

  clone() {
    return new Tensor(this.rows, this.cols, Float64Array.from(this.data), this.requiresGrad);
  }
}

/** Run the tape backwards from a scalar loss. */
export function backward(lossTensor) {
  lossTensor.ensureGrad()[0] = 1;
  for (let i = tape.length - 1; i >= 0; i--) tape[i]();
  resetTape();
}

// --------------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------------

/** C = A · B, with A [n x k] and B [k x m]. */
export function matmul(A, B) {
  const n = A.rows;
  const k = A.cols;
  const m = B.cols;
  const out = new Tensor(n, m);
  const a = A.data;
  const b = B.data;
  const c = out.data;
  for (let i = 0; i < n; i++) {
    const ai = i * k;
    const ci = i * m;
    for (let p = 0; p < k; p++) {
      const av = a[ai + p];
      if (av === 0) continue;
      const bp = p * m;
      for (let j = 0; j < m; j++) c[ci + j] += av * b[bp + j];
    }
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    {
      const ga = A.ensureGrad();
      for (let i = 0; i < n; i++) {
        const gi = i * m;
        const ai = i * k;
        for (let p = 0; p < k; p++) {
          let s = 0;
          const bp = p * m;
          for (let j = 0; j < m; j++) s += go[gi + j] * b[bp + j];
          ga[ai + p] += s;
        }
      }
    }
    {
      const gb = B.ensureGrad();
      for (let p = 0; p < k; p++) {
        const bp = p * m;
        for (let i = 0; i < n; i++) {
          const av = a[i * k + p];
          if (av === 0) continue;
          const gi = i * m;
          for (let j = 0; j < m; j++) gb[bp + j] += av * go[gi + j];
        }
      }
    }
  });
  return out;
}

/** Broadcast-add a [1 x m] bias across rows. */
export function addBias(A, bias) {
  const n = A.rows;
  const m = A.cols;
  const out = new Tensor(n, m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) out.data[i * m + j] = A.data[i * m + j] + bias.data[j];
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    {
      const ga = A.ensureGrad();
      for (let i = 0; i < go.length; i++) ga[i] += go[i];
    }
    {
      const gb = bias.ensureGrad();
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) gb[j] += go[i * m + j];
    }
  });
  return out;
}

/** Elementwise sum of two equally shaped tensors. */
export function add(A, B) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < out.data.length; i++) out.data[i] = A.data[i] + B.data[i];
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    {
      const ga = A.ensureGrad();
      for (let i = 0; i < go.length; i++) ga[i] += go[i];
    }
    {
      const gb = B.ensureGrad();
      for (let i = 0; i < go.length; i++) gb[i] += go[i];
    }
  });
  return out;
}

/** Elementwise product. */
export function mul(A, B) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < out.data.length; i++) out.data[i] = A.data[i] * B.data[i];
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    {
      const ga = A.ensureGrad();
      for (let i = 0; i < go.length; i++) ga[i] += go[i] * B.data[i];
    }
    {
      const gb = B.ensureGrad();
      for (let i = 0; i < go.length; i++) gb[i] += go[i] * A.data[i];
    }
  });
  return out;
}

export function relu(A) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < A.data.length; i++) out.data[i] = A.data[i] > 0 ? A.data[i] : 0;
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    for (let i = 0; i < go.length; i++) if (A.data[i] > 0) ga[i] += go[i];
  });
  return out;
}

/**
 * Leaky ReLU. The plain version killed this network: with a four-block
 * residual stack the head's pre-activations grow large enough that one bad
 * step zeroes every unit at once, and a dead ReLU has no gradient to recover
 * through. A small negative slope keeps a path back.
 */
export function leakyRelu(A, slope = 0.01) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < A.data.length; i++) out.data[i] = A.data[i] > 0 ? A.data[i] : slope * A.data[i];
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    for (let i = 0; i < go.length; i++) ga[i] += go[i] * (A.data[i] > 0 ? 1 : slope);
  });
  return out;
}

export function sigmoid(A) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < A.data.length; i++) out.data[i] = 1 / (1 + Math.exp(-A.data[i]));
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    for (let i = 0; i < go.length; i++) {
      const s = out.data[i];
      ga[i] += go[i] * s * (1 - s);
    }
  });
  return out;
}

/** Row-wise layer normalisation with learned scale and shift. */
export function layerNorm(A, gain, bias, eps = 1e-5) {
  const n = A.rows;
  const m = A.cols;
  const out = new Tensor(n, m);
  const means = new Float64Array(n);
  const invStd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mean = 0;
    for (let j = 0; j < m; j++) mean += A.data[i * m + j];
    mean /= m;
    let variance = 0;
    for (let j = 0; j < m; j++) {
      const d = A.data[i * m + j] - mean;
      variance += d * d;
    }
    variance /= m;
    const inv = 1 / Math.sqrt(variance + eps);
    means[i] = mean;
    invStd[i] = inv;
    for (let j = 0; j < m; j++) {
      out.data[i * m + j] = (A.data[i * m + j] - mean) * inv * gain.data[j] + bias.data[j];
    }
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    const gg = gain.ensureGrad();
    const gb = bias.ensureGrad();
    for (let i = 0; i < n; i++) {
      const inv = invStd[i];
      let sumDy = 0;
      let sumDyXhat = 0;
      for (let j = 0; j < m; j++) {
        const xhat = (A.data[i * m + j] - means[i]) * inv;
        const dy = go[i * m + j] * gain.data[j];
        sumDy += dy;
        sumDyXhat += dy * xhat;
        if (gg) gg[j] += go[i * m + j] * xhat;
        if (gb) gb[j] += go[i * m + j];
      }
      if (!ga) continue;
      for (let j = 0; j < m; j++) {
        const xhat = (A.data[i * m + j] - means[i]) * inv;
        const dy = go[i * m + j] * gain.data[j];
        ga[i * m + j] += (inv / m) * (m * dy - sumDy - xhat * sumDyXhat);
      }
    }
  });
  return out;
}

/** Select rows of A by index — the "gather" half of message passing. */
export function gatherRows(A, indices) {
  const m = A.cols;
  const n = indices.length;
  const out = new Tensor(n, m);
  for (let i = 0; i < n; i++) {
    const src = indices[i] * m;
    const dst = i * m;
    for (let j = 0; j < m; j++) out.data[dst + j] = A.data[src + j];
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    for (let i = 0; i < n; i++) {
      const src = indices[i] * m;
      const dst = i * m;
      for (let j = 0; j < m; j++) ga[src + j] += go[dst + j];
    }
  });
  return out;
}

/**
 * Mean-aggregate message rows into their destination nodes — the "scatter"
 * half of message passing. Nodes with no in-service circuits receive zeros.
 */
export function scatterMean(messages, destinations, nodeCount) {
  const m = messages.cols;
  const out = new Tensor(nodeCount, m);
  const counts = new Float64Array(nodeCount);
  for (let i = 0; i < destinations.length; i++) counts[destinations[i]]++;
  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i] * m;
    const s = i * m;
    for (let j = 0; j < m; j++) out.data[d + j] += messages.data[s + j];
  }
  for (let v = 0; v < nodeCount; v++) {
    if (counts[v] === 0) continue;
    const d = v * m;
    for (let j = 0; j < m; j++) out.data[d + j] /= counts[v];
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const gm = messages.ensureGrad();
    for (let i = 0; i < destinations.length; i++) {
      const v = destinations[i];
      const scale = counts[v] === 0 ? 0 : 1 / counts[v];
      const d = v * m;
      const s = i * m;
      for (let j = 0; j < m; j++) gm[s + j] += go[d + j] * scale;
    }
  });
  return out;
}

/** Concatenate tensors along the feature axis. */
export function concat(tensors) {
  const rows = tensors[0].rows;
  const cols = tensors.reduce((s, t) => s + t.cols, 0);
  const out = new Tensor(rows, cols);
  let offset = 0;
  for (const t of tensors) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < t.cols; j++) out.data[i * cols + offset + j] = t.data[i * t.cols + j];
    }
    offset += t.cols;
  }
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    let off = 0;
    for (const t of tensors) {
      {
        const gt = t.ensureGrad();
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < t.cols; j++) gt[i * t.cols + j] += go[i * cols + off + j];
        }
      }
      off += t.cols;
    }
  });
  return out;
}

/** Elementwise |A - B|, used to build order-invariant circuit representations. */
export function absDiff(A, B) {
  const out = new Tensor(A.rows, A.cols);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.abs(A.data[i] - B.data[i]);
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const ga = A.ensureGrad();
    const gb = B.ensureGrad();
    for (let i = 0; i < go.length; i++) {
      const sign = A.data[i] >= B.data[i] ? 1 : -1;
      if (ga) ga[i] += go[i] * sign;
      if (gb) gb[i] -= go[i] * sign;
    }
  });
  return out;
}

/**
 * Binary cross-entropy against soft targets in [0, 1].
 *
 * Targets are continuous risk fractions rather than hard labels, so the model
 * learns a calibrated probability instead of a decision boundary — which is
 * what an operator actually needs to triage with.
 */
export function bceLoss(predictions, targets, weight = 1) {
  const n = predictions.data.length;
  const out = new Tensor(1, 1);
  let total = 0;
  const eps = 1e-7;
  for (let i = 0; i < n; i++) {
    const p = Math.min(Math.max(predictions.data[i], eps), 1 - eps);
    const t = targets[i];
    total += -(t * Math.log(p) + (1 - t) * Math.log(1 - p));
  }
  out.data[0] = (total / n) * weight;
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    const gp = predictions.ensureGrad();
    const scale = (go[0] * weight) / n;
    for (let i = 0; i < n; i++) {
      const p = Math.min(Math.max(predictions.data[i], eps), 1 - eps);
      const t = targets[i];
      gp[i] += scale * ((p - t) / (p * (1 - p)));
    }
  });
  return out;
}

export function addLoss(a, b) {
  const out = new Tensor(1, 1);
  out.data[0] = a.data[0] + b.data[0];
  if (recording) tape.push(() => {
    const go = out.grad;
    if (!go) return;
    a.ensureGrad()[0] += go[0];
    b.ensureGrad()[0] += go[0];
  });
  return out;
}

// --------------------------------------------------------------------------
// Optimiser
// --------------------------------------------------------------------------

export class Adam {
  constructor(params, { lr = 3e-3, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, weightDecay = 0 } = {}) {
    this.params = params;
    this.lr = lr;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.eps = eps;
    this.weightDecay = weightDecay;
    this.t = 0;
    this.m = params.map((p) => new Float64Array(p.size));
    this.v = params.map((p) => new Float64Array(p.size));
  }

  zeroGrad() {
    for (const p of this.params) p.zeroGrad();
  }

  /** Global gradient-norm clipping keeps early epochs from blowing up. */
  clipGradients(maxNorm) {
    let total = 0;
    for (const p of this.params) {
      if (!p.grad) continue;
      for (let i = 0; i < p.grad.length; i++) total += p.grad[i] * p.grad[i];
    }
    const norm = Math.sqrt(total);
    if (norm <= maxNorm || norm === 0) return norm;
    const scale = maxNorm / norm;
    for (const p of this.params) {
      if (!p.grad) continue;
      for (let i = 0; i < p.grad.length; i++) p.grad[i] *= scale;
    }
    return norm;
  }

  step() {
    this.t++;
    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    for (let k = 0; k < this.params.length; k++) {
      const p = this.params[k];
      if (!p.grad) continue;
      const m = this.m[k];
      const v = this.v[k];
      for (let i = 0; i < p.data.length; i++) {
        let g = p.grad[i];
        if (this.weightDecay) g += this.weightDecay * p.data[i];
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g;
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g;
        p.data[i] -= (this.lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + this.eps);
      }
    }
  }
}
