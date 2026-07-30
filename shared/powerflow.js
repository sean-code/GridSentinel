/**
 * Physics layer: linearised (DC) power flow, economic dispatch, under-frequency
 * load shedding, and cascading-outage simulation.
 *
 * The DC approximation is the standard screening model used for contingency
 * analysis in the industry: it assumes flat voltage magnitudes, small angle
 * differences and negligible resistance, which reduces the load flow to a
 * sparse linear system  B·θ = P  and makes thousands of contingencies
 * tractable. It is exactly the model a real N-1 screening tool would run.
 *
 * This module is the "ground truth" the graph network is trained to imitate.
 */

import { buildAdjacency, findIslands } from './grid.js';

/** Solve A x = b in place by Gaussian elimination with partial pivoting. */
function solveDense(A, b, m) {
  for (let col = 0; col < m; col++) {
    let pivot = col;
    let best = Math.abs(A[col * m + col]);
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(A[r * m + col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-12) continue; // singular row — leave angle at zero
    if (pivot !== col) {
      for (let c = col; c < m; c++) {
        const t = A[col * m + c];
        A[col * m + c] = A[pivot * m + c];
        A[pivot * m + c] = t;
      }
      const t = b[col];
      b[col] = b[pivot];
      b[pivot] = t;
    }
    const diag = A[col * m + col];
    for (let r = col + 1; r < m; r++) {
      const factor = A[r * m + col] / diag;
      if (factor === 0) continue;
      A[r * m + col] = 0;
      for (let c = col + 1; c < m; c++) A[r * m + c] -= factor * A[col * m + c];
      b[r] -= factor * b[col];
    }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < m; c++) s -= A[r * m + c] * x[c];
    const d = A[r * m + r];
    x[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

/**
 * Dispatch generation against demand inside one island and shed load if the
 * island is generation-deficient.
 *
 * Shedding order mirrors real under-frequency schemes: the lowest voltage
 * class, least interconnected feeders drop first; transmission-connected
 * industrial load is held to last.
 */
function dispatchIsland(grid, members) {
  const buses = grid.buses;
  let demand = 0;
  let capacity = 0;
  for (const i of members) {
    demand += buses[i].demand;
    capacity += buses[i].pmax;
  }

  const deEnergized = [];
  const output = new Map();
  const served = new Map();

  if (capacity <= 1e-9 || members.length === 0) {
    // No generation in this island: it goes dark.
    for (const i of members) {
      deEnergized.push(i);
      served.set(i, 0);
      output.set(i, 0);
    }
    return { demand, capacity, shed: demand, deEnergized, output, served, blackout: true };
  }

  let shed = 0;
  const live = new Set(members);

  if (capacity + 1e-9 < demand) {
    // Deficit: shed whole buses until the island balances.
    const shedOrder = members
      .filter((i) => buses[i].demand > 0)
      .sort((a, b) => buses[a].kv - buses[b].kv || buses[a].demand - buses[b].demand || a - b);
    let remaining = demand;
    for (const i of shedOrder) {
      if (remaining <= capacity + 1e-9) break;
      remaining -= buses[i].demand;
      shed += buses[i].demand;
      deEnergized.push(i);
      live.delete(i);
    }
    demand = remaining;
    if (demand <= 1e-9) {
      // Everything shed — treat as a dark island.
      const already = new Set(deEnergized);
      for (const i of members) if (!already.has(i)) deEnergized.push(i);
      return { demand: 0, capacity, shed, deEnergized, output, served, blackout: true };
    }
  }

  // Proportional dispatch across available units.
  for (const i of members) {
    output.set(i, capacity > 0 ? (buses[i].pmax / capacity) * demand : 0);
    served.set(i, live.has(i) ? buses[i].demand : 0);
  }

  return { demand, capacity, shed, deEnergized, output, served, blackout: false };
}

/**
 * Full network state for a given set of in-service circuits.
 *
 * @returns {{flows: Float64Array, loading: Float64Array, deEnergized: Uint8Array,
 *            loadShed: number, islands: number, angles: Float64Array}}
 */
export function solveNetwork(grid, activeMask) {
  const n = grid.busCount;
  const lines = grid.lines;
  const flows = new Float64Array(lines.length);
  const loading = new Float64Array(lines.length);
  const angles = new Float64Array(n);
  const deEnergized = new Uint8Array(n);
  let loadShed = 0;

  const neighbours = buildAdjacency(grid, activeMask);
  const { island, count } = findIslands(grid, activeMask, neighbours);
  const groups = Array.from({ length: count }, () => []);
  for (let i = 0; i < n; i++) groups[island[i]].push(i);

  const injection = new Float64Array(n);

  for (const members of groups) {
    const res = dispatchIsland(grid, members);
    loadShed += res.shed;
    for (const i of res.deEnergized) deEnergized[i] = 1;
    if (res.blackout) continue;

    for (const i of members) {
      injection[i] = (res.output.get(i) || 0) - (res.served.get(i) || 0);
    }

    // Slack bus: the largest unit in the island, or the best-connected bus.
    let slack = members[0];
    let bestScore = -1;
    for (const i of members) {
      const score = grid.buses[i].pmax * 1000 + grid.buses[i].degree;
      if (score > bestScore) {
        bestScore = score;
        slack = i;
      }
    }

    const localIndex = new Map();
    let k = 0;
    for (const i of members) {
      if (i === slack) continue;
      localIndex.set(i, k++);
    }
    const m = k;
    if (m === 0) continue;

    const B = new Float64Array(m * m);
    const P = new Float64Array(m);
    for (const i of members) {
      const li = localIndex.get(i);
      if (li !== undefined) P[li] = injection[i] / 100; // per unit on 100 MVA
    }

    for (const i of members) {
      const li = localIndex.get(i);
      for (const { bus: j, line: lk } of neighbours[i]) {
        const susceptance = 1 / lines[lk].reactance;
        if (li !== undefined) B[li * m + li] += susceptance;
        const lj = localIndex.get(j);
        if (li !== undefined && lj !== undefined) B[li * m + lj] -= susceptance;
      }
    }

    const theta = solveDense(B, P, m);
    for (const i of members) {
      const li = localIndex.get(i);
      angles[i] = li === undefined ? 0 : theta[li];
    }
  }

  for (let k = 0; k < lines.length; k++) {
    if (activeMask && !activeMask[k]) {
      flows[k] = 0;
      loading[k] = 0;
      continue;
    }
    const line = lines[k];
    if (island[line.from] !== island[line.to]) continue;
    const f = ((angles[line.from] - angles[line.to]) / line.reactance) * 100; // MW
    flows[k] = f;
    loading[k] = Math.abs(f) / line.capacity;
  }

  return { flows, loading, deEnergized, loadShed, islands: count, angles, islandOf: island };
}

/** Base case: every circuit in service. */
export function solveBaseCase(grid) {
  const mask = new Uint8Array(grid.lines.length).fill(1);
  return solveNetwork(grid, mask);
}

/**
 * Size circuits so the intact network is secure, the way a planning study
 * would. Without this, generated grids start out already overloaded and the
 * risk labels degenerate.
 */
export function reinforceGrid(grid, targetLoading = 0.72, passes = 4) {
  for (let p = 0; p < passes; p++) {
    const state = solveBaseCase(grid);
    let worst = 0;
    for (let k = 0; k < grid.lines.length; k++) {
      worst = Math.max(worst, state.loading[k]);
      if (state.loading[k] > targetLoading) {
        grid.lines[k].capacity = Math.abs(state.flows[k]) / targetLoading;
      }
    }
    if (worst <= targetLoading + 1e-6) break;
  }
  return solveBaseCase(grid);
}

const OVERLOAD_TRIP = 1.08; // relays tolerate a short-term emergency rating

/**
 * Simulate a cascade seeded by an initial circuit outage.
 *
 * Each round: re-island the network, redispatch, shed load where generation is
 * short, resolve flows, and trip any circuit beyond its emergency rating. Real
 * blackouts (2003 Northeast, 2021 Texas) follow exactly this loop.
 */
export function runCascade(grid, initialTrips, maxRounds = 6) {
  const active = new Uint8Array(grid.lines.length).fill(1);
  for (const k of initialTrips) active[k] = 0;

  const tripSequence = [initialTrips.slice()];
  let state = solveNetwork(grid, active);

  for (let round = 0; round < maxRounds; round++) {
    const newlyTripped = [];
    for (let k = 0; k < grid.lines.length; k++) {
      if (!active[k]) continue;
      if (state.loading[k] > OVERLOAD_TRIP) newlyTripped.push(k);
    }
    if (newlyTripped.length === 0) break;
    for (const k of newlyTripped) active[k] = 0;
    tripSequence.push(newlyTripped);
    state = solveNetwork(grid, active);
  }

  return {
    active,
    state,
    tripSequence,
    rounds: tripSequence.length,
    loadShed: state.loadShed,
    deEnergized: state.deEnergized,
  };
}

/**
 * Probability that a given circuit is the one that fails next.
 *
 * Combines the three drivers utilities actually track: how hard the circuit is
 * being worked, its physical condition, and the weather over its right-of-way.
 */
export function failureHazard(line, loadingValue) {
  const stress = Math.exp(1.9 * Math.min(loadingValue, 1.6));
  const wear = Math.exp(1.5 * (1 - line.condition));
  const storm = Math.exp(2.3 * line.weather);
  const exposure = 0.35 + line.length; // longer rights-of-way see more faults
  return stress * wear * storm * exposure;
}

/**
 * Probability-weighted N-1 contingency analysis — the label generator.
 *
 * For every credible single-circuit outage we run the cascade to completion and
 * record which buses ended up without service. A bus's risk score is the
 * hazard-weighted fraction of contingencies in which it goes dark; a circuit's
 * criticality is the share of system load lost when it opens.
 *
 * This is the expensive computation the neural surrogate replaces: it is
 * O(circuits x cascade rounds x n^3) and does not fit in an operator's decision
 * window on a real system.
 */
export function contingencyAnalysis(grid, opts = {}) {
  const sampleLimit = opts.sampleLimit ?? Infinity;
  const base = opts.baseState ?? solveBaseCase(grid);
  const lines = grid.lines;
  const n = grid.busCount;

  const hazards = lines.map((line, k) => failureHazard(line, base.loading[k]));

  let order = [...lines.keys()];
  if (order.length > sampleLimit) {
    // Keep the most credible outages — that is where the risk mass lives.
    order.sort((a, b) => hazards[b] - hazards[a]);
    order = order.slice(0, sampleLimit);
  }

  const nodeRisk = new Float64Array(n);
  const lineCriticality = new Float64Array(lines.length);
  const lineIslanding = new Uint8Array(lines.length);
  let hazardSum = 0;
  let expectedShed = 0;
  let worstShed = 0;
  let worstLine = -1;

  for (const k of order) {
    const h = hazards[k];
    hazardSum += h;
    const result = runCascade(grid, [k]);
    const shedFraction = grid.totalDemand > 0 ? result.loadShed / grid.totalDemand : 0;
    lineCriticality[k] = shedFraction;
    lineIslanding[k] = result.state.islands > 1 ? 1 : 0;
    expectedShed += h * shedFraction;
    if (shedFraction > worstShed) {
      worstShed = shedFraction;
      worstLine = k;
    }
    for (let i = 0; i < n; i++) {
      if (result.deEnergized[i]) nodeRisk[i] += h;
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
    hazards,
    expectedShed,
    worstShed,
    worstLine,
    contingenciesRun: order.length,
    baseState: base,
  };
}
