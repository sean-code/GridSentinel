/**
 * TopoRiskNet — the outage-risk surrogate.
 *
 * Architecture: an edge-gated GraphSAGE variant. Each layer builds a message
 * from every neighbouring bus, multiplies it by a gate computed from the
 * connecting circuit's own state, mean-aggregates the gated messages, and
 * combines them with the bus's own representation through a residual,
 * layer-normalised block.
 *
 * Why the gate matters here: in a power system a neighbour only matters to the
 * extent that the circuit between you can actually carry power to you. A
 * heavily loaded, storm-exposed, poor-condition circuit is a weak coupling; a
 * lightly loaded double circuit is a strong one. Plain neighbourhood averaging
 * cannot express that, so the gate is conditioned on the eight per-circuit
 * features. It is the inductive bias that matches the physics.
 *
 * Two heads share the trunk:
 *   - per bus: probability of losing service in the next credible contingency
 *   - per circuit: fraction of system load lost if that circuit opens
 *
 * The same class, with `useGraph: false`, becomes the ablation baseline: an MLP
 * over identical per-bus features with the message-passing path removed. That
 * is the control that tells us whether the graph is doing real work.
 */

import {
  Tensor,
  matmul,
  addBias,
  add,
  mul,
  leakyRelu,
  sigmoid,
  layerNorm,
  gatherRows,
  scatterMean,
  concat,
  absDiff,
} from './autograd.js';
import { N_NODE_FEATURES, N_EDGE_FEATURES } from './grid.js';

const DEFAULTS = {
  hidden: 48,
  // Four rounds of message passing. A bus's fate depends on whether the island
  // it lands in still contains generation, which is a question about a
  // neighbourhood several hops wide — three layers left buses at the end of
  // long radial chains systematically underscored.
  layers: 4,
  headHidden: 32,
  useGraph: true,
};

function kaiming(rows, cols, rng) {
  const t = new Tensor(rows, cols, null, true);
  const std = Math.sqrt(2 / rows);
  for (let i = 0; i < t.data.length; i++) t.data[i] = rng.normal(0, std);
  return t;
}

function zerosParam(rows, cols) {
  return new Tensor(rows, cols, null, true);
}

function onesParam(cols) {
  const t = new Tensor(1, cols, null, true);
  t.data.fill(1);
  return t;
}

export class TopoRiskNet {
  constructor(config = {}, rng = null) {
    this.config = { ...DEFAULTS, ...config };
    const { hidden, layers, headHidden, useGraph } = this.config;
    const F = N_NODE_FEATURES;
    const EF = N_EDGE_FEATURES;

    if (rng) {
      this.encoderW = kaiming(F, hidden, rng);
      this.encoderB = zerosParam(1, hidden);
      this.encoderGain = onesParam(hidden);
      this.encoderShift = zerosParam(1, hidden);

      this.blocks = [];
      for (let l = 0; l < layers; l++) {
        this.blocks.push({
          selfW: kaiming(hidden, hidden, rng),
          neighW: useGraph ? kaiming(hidden, hidden, rng) : null,
          msgW: useGraph ? kaiming(hidden, hidden, rng) : null,
          gateW: useGraph ? kaiming(EF, hidden, rng) : null,
          gateB: useGraph ? zerosParam(1, hidden) : null,
          bias: zerosParam(1, hidden),
          gain: onesParam(hidden),
          shift: zerosParam(1, hidden),
        });
      }

      this.outGain = onesParam(hidden);
      this.outShift = zerosParam(1, hidden);

      this.nodeHeadW1 = kaiming(hidden + F, headHidden, rng);
      this.nodeHeadB1 = zerosParam(1, headHidden);
      this.nodeHeadW2 = kaiming(headHidden, 1, rng);
      this.nodeHeadB2 = zerosParam(1, 1);

      this.edgeHeadW1 = kaiming(hidden * 2 + EF, headHidden, rng);
      this.edgeHeadB1 = zerosParam(1, headHidden);
      this.edgeHeadW2 = kaiming(headHidden, 1, rng);
      this.edgeHeadB2 = zerosParam(1, 1);
    }
  }

  parameters() {
    const out = [
      this.encoderW,
      this.encoderB,
      this.encoderGain,
      this.encoderShift,
      this.outGain,
      this.outShift,
      this.nodeHeadW1,
      this.nodeHeadB1,
      this.nodeHeadW2,
      this.nodeHeadB2,
      this.edgeHeadW1,
      this.edgeHeadB1,
      this.edgeHeadW2,
      this.edgeHeadB2,
    ];
    for (const b of this.blocks) {
      out.push(b.selfW, b.bias, b.gain, b.shift);
      if (b.neighW) out.push(b.neighW, b.msgW, b.gateW, b.gateB);
    }
    return out;
  }

  parameterCount() {
    return this.parameters().reduce((s, p) => s + p.size, 0);
  }

  /**
   * @param {object} sample  { nodeFeatures, edgeFeatures, n, edgeCount, index }
   * @returns {{ nodeRisk: Tensor, edgeCriticality: Tensor, embedding: Tensor }}
   */
  forward(sample) {
    const { hidden, useGraph } = this.config;
    const n = sample.n;
    const X = new Tensor(n, N_NODE_FEATURES, sample.nodeFeatures);
    const E = new Tensor(sample.edgeCount, N_EDGE_FEATURES, sample.edgeFeatures);

    let h = layerNorm(addBias(matmul(X, this.encoderW), this.encoderB), this.encoderGain, this.encoderShift);
    h = leakyRelu(h);

    for (const block of this.blocks) {
      let combined = matmul(h, block.selfW);

      if (useGraph && block.neighW) {
        const { src, dst, edgeRef } = sample.index;
        // Message from each neighbour, gated by the connecting circuit.
        const neighbourStates = gatherRows(h, src);
        const rawMessages = matmul(neighbourStates, block.msgW);
        const edgeStates = gatherRows(E, edgeRef);
        const gate = sigmoid(addBias(matmul(edgeStates, block.gateW), block.gateB));
        const gated = mul(rawMessages, gate);
        const aggregated = scatterMean(gated, dst, n);
        combined = add(combined, matmul(aggregated, block.neighW));
      }

      const normed = layerNorm(addBias(combined, block.bias), block.gain, block.shift);
      h = add(leakyRelu(normed), h); // residual keeps deep stacks trainable
    }

    // Residual stacks let activation scale drift upwards layer by layer, which
    // pushed the heads into saturation. One normalisation at the end fixes the
    // scale the heads see without constraining the trunk.
    h = layerNorm(h, this.outGain, this.outShift);

    // Node head sees the learned embedding alongside the raw measurements, so
    // local evidence is never lost through the message-passing stack.
    const nodeInput = concat([h, X]);
    const nodeHidden = leakyRelu(addBias(matmul(nodeInput, this.nodeHeadW1), this.nodeHeadB1));
    const nodeRisk = sigmoid(addBias(matmul(nodeHidden, this.nodeHeadW2), this.nodeHeadB2));

    // Circuit head is symmetric in its endpoints: a circuit has no direction,
    // so the representation must not have one either.
    const fromIdx = sample.fromIndex;
    const toIdx = sample.toIndex;
    const hu = gatherRows(h, fromIdx);
    const hv = gatherRows(h, toIdx);
    const edgeInput = concat([add(hu, hv), absDiff(hu, hv), E]);
    const edgeHidden = leakyRelu(addBias(matmul(edgeInput, this.edgeHeadW1), this.edgeHeadB1));
    const edgeCriticality = sigmoid(addBias(matmul(edgeHidden, this.edgeHeadW2), this.edgeHeadB2));

    return { nodeRisk, edgeCriticality, embedding: h, hidden };
  }

  toJSON(precision = 5) {
    const round = (t) => Array.from(t.data, (v) => Number(v.toFixed(precision)));
    const shape = (t) => [t.rows, t.cols];
    const pack = (t) => ({ shape: shape(t), data: round(t) });
    return {
      format: 'toporisknet/1',
      config: this.config,
      nodeFeatures: N_NODE_FEATURES,
      edgeFeatures: N_EDGE_FEATURES,
      tensors: {
        encoderW: pack(this.encoderW),
        encoderB: pack(this.encoderB),
        encoderGain: pack(this.encoderGain),
        encoderShift: pack(this.encoderShift),
        outGain: pack(this.outGain),
        outShift: pack(this.outShift),
        nodeHeadW1: pack(this.nodeHeadW1),
        nodeHeadB1: pack(this.nodeHeadB1),
        nodeHeadW2: pack(this.nodeHeadW2),
        nodeHeadB2: pack(this.nodeHeadB2),
        edgeHeadW1: pack(this.edgeHeadW1),
        edgeHeadB1: pack(this.edgeHeadB1),
        edgeHeadW2: pack(this.edgeHeadW2),
        edgeHeadB2: pack(this.edgeHeadB2),
        blocks: this.blocks.map((b) => ({
          selfW: pack(b.selfW),
          bias: pack(b.bias),
          gain: pack(b.gain),
          shift: pack(b.shift),
          neighW: b.neighW ? pack(b.neighW) : null,
          msgW: b.msgW ? pack(b.msgW) : null,
          gateW: b.gateW ? pack(b.gateW) : null,
          gateB: b.gateB ? pack(b.gateB) : null,
        })),
      },
    };
  }

  static fromJSON(json) {
    const net = new TopoRiskNet(json.config);
    const unpack = (p) => (p ? new Tensor(p.shape[0], p.shape[1], Float64Array.from(p.data), false) : null);
    const t = json.tensors;
    net.encoderW = unpack(t.encoderW);
    net.encoderB = unpack(t.encoderB);
    net.encoderGain = unpack(t.encoderGain);
    net.encoderShift = unpack(t.encoderShift);
    net.outGain = unpack(t.outGain);
    net.outShift = unpack(t.outShift);
    net.nodeHeadW1 = unpack(t.nodeHeadW1);
    net.nodeHeadB1 = unpack(t.nodeHeadB1);
    net.nodeHeadW2 = unpack(t.nodeHeadW2);
    net.nodeHeadB2 = unpack(t.nodeHeadB2);
    net.edgeHeadW1 = unpack(t.edgeHeadW1);
    net.edgeHeadB1 = unpack(t.edgeHeadB1);
    net.edgeHeadW2 = unpack(t.edgeHeadW2);
    net.edgeHeadB2 = unpack(t.edgeHeadB2);
    net.blocks = t.blocks.map((b) => ({
      selfW: unpack(b.selfW),
      bias: unpack(b.bias),
      gain: unpack(b.gain),
      shift: unpack(b.shift),
      neighW: unpack(b.neighW),
      msgW: unpack(b.msgW),
      gateW: unpack(b.gateW),
      gateB: unpack(b.gateB),
    }));
    return net;
  }
}
