/**
 * Feature extraction.
 *
 * Turns a grid and its solved base state into the tensors the model consumes.
 * The identical function runs in the training pipeline and in the browser, so
 * there is no train/serve skew — a whole class of bugs designed out rather than
 * tested for.
 *
 * Design note: every feature here is *local* to a bus (its own measurements and
 * those of the circuits touching it). Nothing encodes the wider topology. That
 * restriction is deliberate — it is what makes the comparison against the
 * graph-blind baseline honest. The baseline sees exactly the same numbers; only
 * the graph network gets to see how the buses are wired together.
 */

import { buildAdjacency, N_NODE_FEATURES, N_EDGE_FEATURES } from './grid.js';

export { N_NODE_FEATURES, N_EDGE_FEATURES };

/** Squash an unbounded positive quantity into roughly [0, 1]. */
function soft(x, scale) {
  return x / (x + scale);
}

export function extractFeatures(grid, state) {
  const n = grid.busCount;
  const lines = grid.lines;
  const neighbours = buildAdjacency(grid, null);
  const totalDemand = Math.max(grid.totalDemand, 1);

  const nodeFeatures = new Float64Array(n * N_NODE_FEATURES);

  for (let i = 0; i < n; i++) {
    const bus = grid.buses[i];
    const inc = neighbours[i];

    let incidentCapacity = 0;
    let maxLoading = 0;
    let sumLoading = 0;
    let sumCondition = 0;
    for (const { line: k } of inc) {
      incidentCapacity += lines[k].capacity;
      maxLoading = Math.max(maxLoading, state.loading[k]);
      sumLoading += state.loading[k];
      sumCondition += lines[k].condition;
    }
    const deg = Math.max(inc.length, 1);

    const dispatch = grid.totalCapacity > 0 ? (bus.pmax / grid.totalCapacity) * totalDemand : 0;
    const netInjection = dispatch - bus.demand;

    const f = i * N_NODE_FEATURES;
    nodeFeatures[f + 0] = bus.type === 'generation' ? 1 : 0;
    nodeFeatures[f + 1] = bus.type === 'substation' ? 1 : 0;
    nodeFeatures[f + 2] = bus.type === 'load' ? 1 : 0;
    nodeFeatures[f + 3] = bus.kv / 345;
    nodeFeatures[f + 4] = soft(bus.demand, 60);
    nodeFeatures[f + 5] = soft(bus.pmax, 120);
    nodeFeatures[f + 6] = soft(Math.max(dispatch, 0), 120);
    nodeFeatures[f + 7] = Math.tanh(netInjection / 80);
    nodeFeatures[f + 8] = Math.min(inc.length, 8) / 8;
    nodeFeatures[f + 9] = soft(incidentCapacity, 300);
    nodeFeatures[f + 10] = Math.min(maxLoading, 1.5) / 1.5;
    nodeFeatures[f + 11] = Math.min(sumLoading / deg, 1.5) / 1.5;
    nodeFeatures[f + 12] = bus.weather;
    nodeFeatures[f + 13] = sumCondition / deg;
    nodeFeatures[f + 14] = incidentCapacity > 0 ? Math.min(bus.demand / incidentCapacity, 2) / 2 : 1;
    nodeFeatures[f + 15] = soft(Math.max(bus.pmax - dispatch, 0), 120);
  }

  const edgeFeatures = new Float64Array(lines.length * N_EDGE_FEATURES);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const e = k * N_EDGE_FEATURES;
    edgeFeatures[e + 0] = soft(line.capacity, 200);
    edgeFeatures[e + 1] = soft(Math.abs(state.flows[k]), 200);
    edgeFeatures[e + 2] = Math.min(state.loading[k], 1.5) / 1.5;
    edgeFeatures[e + 3] = Math.min(line.reactance, 0.6) / 0.6;
    edgeFeatures[e + 4] = Math.min(line.length, 0.6) / 0.6;
    edgeFeatures[e + 5] = line.condition;
    edgeFeatures[e + 6] = line.weather;
    edgeFeatures[e + 7] = line.parallel;
  }

  return { nodeFeatures, edgeFeatures, n, edgeCount: lines.length };
}

/**
 * Message-passing index arrays.
 *
 * Circuits are undirected, so each one becomes two directed messages. Self
 * loops are handled by the model's own residual path rather than added here,
 * which keeps the aggregation statistics clean.
 */
export function buildMessageIndex(grid) {
  const src = [];
  const dst = [];
  const edgeRef = [];
  grid.lines.forEach((line, k) => {
    src.push(line.from);
    dst.push(line.to);
    edgeRef.push(k);
    src.push(line.to);
    dst.push(line.from);
    edgeRef.push(k);
  });
  return {
    src: Int32Array.from(src),
    dst: Int32Array.from(dst),
    edgeRef: Int32Array.from(edgeRef),
    count: src.length,
  };
}
