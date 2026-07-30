/**
 * Synthetic transmission-network generator.
 *
 * Produces grids that behave like real sub-transmission systems: a connected
 * sparse mesh with a high-voltage backbone, radial distribution fringes,
 * heavy-tailed load sizes, and generation sited away from load centres.
 *
 * Nothing here is scraped or licensed — every grid is generated from a seed,
 * which is what makes the whole project shippable as a static site.
 *
 * Units are per-unit on a 100 MVA base unless a name says otherwise.
 */

import { Rng, clamp } from './rng.js';

export const BUS_TYPES = ['generation', 'substation', 'load'];

/** Voltage classes present in the modelled system, in kV. */
export const VOLTAGE_CLASSES = [345, 230, 138, 69];

export const NODE_FEATURE_NAMES = [
  'type: generation',
  'type: substation',
  'type: load',
  'voltage class',
  'peak demand',
  'generation capacity',
  'dispatched output',
  'net injection',
  'connected lines',
  'incident line capacity',
  'worst incident line loading',
  'mean incident line loading',
  'weather stress',
  'mean line condition',
  'local import stress',
  'generation headroom',
];

export const EDGE_FEATURE_NAMES = [
  'thermal rating',
  'power flow',
  'loading',
  'reactance',
  'circuit length',
  'condition index',
  'weather stress',
  'parallel circuit',
];

export const N_NODE_FEATURES = NODE_FEATURE_NAMES.length;
export const N_EDGE_FEATURES = EDGE_FEATURE_NAMES.length;

/**
 * A weather stress field: two or three storm cells drifting over the service
 * territory. Stress raises line failure hazard, which is what makes the risk
 * surface move around between scenarios.
 */
function makeWeatherField(rng, severity) {
  const cellCount = rng.int(1, 4);
  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push({
      x: rng.range(0.05, 0.95),
      y: rng.range(0.05, 0.95),
      radius: rng.range(0.18, 0.42),
      intensity: rng.range(0.35, 1.0) * severity,
    });
  }
  return {
    cells,
    at(x, y) {
      let s = 0;
      for (const c of cells) {
        const d = Math.hypot(x - c.x, y - c.y);
        const falloff = Math.exp(-(d * d) / (2 * c.radius * c.radius));
        s = Math.max(s, c.intensity * falloff);
      }
      return clamp(s, 0, 1);
    },
  };
}

/** Euclidean minimum spanning tree (Prim, dense) — guarantees a connected grid. */
function spanningTree(points) {
  const n = points.length;
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  best[0] = 0;
  const edges = [];
  for (let it = 0; it < n; it++) {
    let u = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && best[i] < bd) {
        bd = best[i];
        u = i;
      }
    }
    if (u < 0) break;
    inTree[u] = 1;
    if (parent[u] >= 0) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(points[u].x - points[v].x, points[u].y - points[v].y);
      if (d < best[v]) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

/**
 * Build one grid.
 *
 * @param {number} seed         reproducibility key
 * @param {object} opts
 * @param {number} opts.busCount        number of buses (default: random 34–64)
 * @param {number} opts.demandScale     multiplies every load (1.0 = normal day)
 * @param {number} opts.weatherSeverity 0 = clear, 1 = severe storm
 * @param {number} opts.meshDensity     extra circuits beyond the spanning tree
 */
export function generateGrid(seed, opts = {}) {
  const rng = new Rng(seed);
  const n = opts.busCount ?? rng.int(34, 64);
  const demandScale = opts.demandScale ?? 1.0;
  const weatherSeverity = opts.weatherSeverity ?? rng.range(0.0, 0.85);
  const meshDensity = opts.meshDensity ?? rng.range(0.35, 0.75);

  // --- Geography: a few population centres plus scattered rural buses -------
  const centreCount = rng.int(2, 5);
  const centres = [];
  for (let i = 0; i < centreCount; i++) {
    centres.push({ x: rng.range(0.15, 0.85), y: rng.range(0.15, 0.85), pull: rng.range(0.06, 0.16) });
  }

  const buses = [];
  for (let i = 0; i < n; i++) {
    let x;
    let y;
    if (rng.bool(0.68)) {
      const c = rng.pick(centres);
      x = clamp(c.x + rng.normal(0, c.pull), 0.03, 0.97);
      y = clamp(c.y + rng.normal(0, c.pull), 0.03, 0.97);
    } else {
      x = rng.range(0.03, 0.97);
      y = rng.range(0.03, 0.97);
    }
    buses.push({ id: i, x, y });
  }

  const weather = makeWeatherField(rng, weatherSeverity);

  // --- Topology: spanning tree backbone, then redundant circuits ------------
  const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const present = new Set();
  const pairs = [];
  for (const [a, b] of spanningTree(buses)) {
    present.add(edgeKey(a, b));
    pairs.push([a, b]);
  }

  // Candidate extra circuits, shortest first — real utilities reinforce
  // between neighbours, not across the territory.
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (present.has(edgeKey(i, j))) continue;
      const d = Math.hypot(buses[i].x - buses[j].x, buses[i].y - buses[j].y);
      if (d > 0.34) continue;
      candidates.push({ i, j, d: d * rng.range(0.75, 1.45) });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const extra = Math.round(meshDensity * n);
  for (let k = 0; k < candidates.length && pairs.length < n - 1 + extra; k++) {
    const { i, j } = candidates[k];
    if (present.has(edgeKey(i, j))) continue;
    present.add(edgeKey(i, j));
    pairs.push([i, j]);
  }

  // --- Bus roles ------------------------------------------------------------
  const degree = new Int32Array(n);
  for (const [a, b] of pairs) {
    degree[a]++;
    degree[b]++;
  }

  const byDegree = [...buses.keys()].sort((a, b) => degree[b] - degree[a]);
  const hubCount = Math.max(2, Math.round(n * 0.16));
  const hubs = new Set(byDegree.slice(0, hubCount));

  const genCount = Math.max(3, Math.round(n * 0.17));
  const genCandidates = [...buses.keys()].filter((i) => !hubs.has(i));
  rng.shuffle(genCandidates);
  const gens = new Set(genCandidates.slice(0, genCount));

  for (const bus of buses) {
    if (gens.has(bus.id)) bus.type = 'generation';
    else if (hubs.has(bus.id)) bus.type = 'substation';
    else bus.type = 'load';

    // Voltage class tracks role and connectivity.
    if (bus.type === 'substation') bus.kv = degree[bus.id] >= 5 ? 345 : 230;
    else if (bus.type === 'generation') bus.kv = rng.bool(0.5) ? 345 : 230;
    else bus.kv = degree[bus.id] >= 3 ? 138 : 69;

    bus.weather = weather.at(bus.x, bus.y);
    bus.degree = degree[bus.id];
  }

  // --- Demand ---------------------------------------------------------------
  let totalDemand = 0;
  for (const bus of buses) {
    if (bus.type === 'load') {
      // Heavy tail: a handful of buses carry industrial load.
      const base = rng.logNormal(Math.log(38), 0.62);
      bus.demand = clamp(base, 4, 260) * demandScale;
    } else if (bus.type === 'substation') {
      bus.demand = rng.bool(0.4) ? rng.range(3, 18) * demandScale : 0;
    } else {
      bus.demand = rng.bool(0.25) ? rng.range(2, 10) * demandScale : 0;
    }
    totalDemand += bus.demand;
  }

  // --- Generation sizing ----------------------------------------------------
  // Total capacity carries a reserve margin over peak demand, as required by
  // reliability standards. Margin varies by scenario, which is a big driver of
  // how survivable each grid is.
  const reserveMargin = rng.range(1.14, 1.48);
  const genList = [...gens];
  const weights = genList.map(() => rng.logNormal(0, 0.55));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const targetCapacity = totalDemand * reserveMargin;
  genList.forEach((id, k) => {
    buses[id].pmax = Math.max(20, (weights[k] / wSum) * targetCapacity);
  });
  for (const bus of buses) {
    if (bus.pmax === undefined) bus.pmax = 0;
  }

  // --- Circuits -------------------------------------------------------------
  const lines = pairs.map(([a, b], idx) => {
    const A = buses[a];
    const B = buses[b];
    const length = Math.hypot(A.x - B.x, A.y - B.y);
    const kv = Math.min(A.kv, B.kv);
    // Reactance rises with length, falls with voltage class.
    const reactance = clamp((length * 0.34 + 0.012) * (345 / kv) ** 0.55 * rng.range(0.82, 1.22), 0.008, 0.55);
    const parallel = kv >= 230 && rng.bool(0.22) ? 1 : 0;
    // Thermal rating scales roughly with the square of voltage class.
    const baseRating = 26 * (kv / 69) ** 1.75;
    const capacity = baseRating * rng.range(0.85, 1.45) * (parallel ? 1.9 : 1);
    return {
      id: idx,
      from: a,
      to: b,
      length,
      kv,
      reactance,
      capacity,
      parallel,
      condition: clamp(rng.range(0.45, 1.0) - 0.18 * rng.float() ** 2, 0.2, 1),
      weather: (A.weather + B.weather) / 2,
      inService: true,
    };
  });

  return {
    seed,
    busCount: n,
    buses,
    lines,
    totalDemand,
    totalCapacity: genList.reduce((s, id) => s + buses[id].pmax, 0),
    reserveMargin,
    weatherSeverity,
    weatherCells: weather.cells,
    demandScale,
    meta: {
      generation: genList.length,
      substations: hubs.size,
      load: n - genList.length - hubs.size,
    },
  };
}

/** Adjacency in CSR-ish form; rebuilt whenever lines are switched out. */
export function buildAdjacency(grid, activeMask = null) {
  const n = grid.busCount;
  const neighbours = Array.from({ length: n }, () => []);
  grid.lines.forEach((line, k) => {
    if (activeMask && !activeMask[k]) return;
    neighbours[line.from].push({ bus: line.to, line: k });
    neighbours[line.to].push({ bus: line.from, line: k });
  });
  return neighbours;
}

/** Connected components over in-service circuits. Returns an island id per bus. */
export function findIslands(grid, activeMask = null, prebuiltAdjacency = null) {
  const n = grid.busCount;
  const neighbours = prebuiltAdjacency || buildAdjacency(grid, activeMask);
  const island = new Int32Array(n).fill(-1);
  let count = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (island[s] !== -1) continue;
    island[s] = count;
    stack.length = 0;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop();
      for (const { bus: v } of neighbours[u]) {
        if (island[v] === -1) {
          island[v] = count;
          stack.push(v);
        }
      }
    }
    count++;
  }
  return { island, count };
}
