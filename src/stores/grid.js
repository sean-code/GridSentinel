/**
 * Application state.
 *
 * One store owns the whole operating picture: the grid, its solved base case,
 * the network's prediction, and — when the operator asks for it — the physics
 * study that the prediction is meant to stand in for. Views read from here and
 * never recompute physics on their own.
 */

import { defineStore } from 'pinia';
import { generateGrid } from '@shared/grid.js';
import { reinforceGrid, runCascade, solveBaseCase, solveNetwork } from '@shared/powerflow.js';
import { loadModel, toSample, benchmarkPredict, getReport } from '@/lib/inference.js';
import { runContingencyStudy, agreement, meanAbsoluteError } from '@/lib/analysis.js';

/** Named operating scenarios — the situations a control room actually plans for. */
export const SCENARIOS = [
  {
    id: 'normal',
    name: 'Normal weekday',
    detail: 'Moderate load, clear weather',
    knobs: { demandScale: 0.95, weatherSeverity: 0.1 },
  },
  {
    id: 'peak',
    name: 'Summer peak',
    detail: 'Load at annual maximum, thin reserves',
    knobs: { demandScale: 1.28, weatherSeverity: 0.2 },
  },
  {
    id: 'storm',
    name: 'Storm front',
    detail: 'Severe weather over part of the territory',
    knobs: { demandScale: 1.05, weatherSeverity: 0.85 },
  },
  {
    id: 'peak-storm',
    name: 'Peak under storm',
    detail: 'Worst credible combination',
    knobs: { demandScale: 1.3, weatherSeverity: 0.9 },
  },
  {
    id: 'light',
    name: 'Overnight minimum',
    detail: 'Light load, deep reserves',
    knobs: { demandScale: 0.72, weatherSeverity: 0.05 },
  },
];

const DEFAULT_BUS_COUNT = 62;

export const useGridStore = defineStore('grid', {
  state: () => ({
    // --- model ---
    net: null,
    modelReport: null,
    modelStatus: 'idle', // idle | loading | ready | error
    modelError: null,

    // --- grid ---
    grid: null,
    baseState: null,
    sample: null,
    seed: 20260730,
    busCount: DEFAULT_BUS_COUNT,
    scenarioId: 'peak',

    // --- prediction ---
    prediction: null,
    predictMs: null,

    // --- physics reference ---
    study: null,
    studyRunning: false,
    studyProgress: null,
    studyCancelled: false,

    // --- interaction ---
    selectedBus: null,
    selectedLine: null,
    hoveredLine: null,

    // --- cascade replay ---
    cascade: null,
    cascadeRound: 0,
  }),

  getters: {
    scenario(state) {
      return SCENARIOS.find((s) => s.id === state.scenarioId) || SCENARIOS[0];
    },

    ready(state) {
      return state.modelStatus === 'ready' && Boolean(state.grid) && Boolean(state.prediction);
    },

    /** Buses ordered by predicted risk, highest first. */
    riskLedger(state) {
      if (!state.grid || !state.prediction) return [];
      return state.grid.buses
        .map((bus, i) => ({
          id: i,
          bus,
          risk: state.prediction.nodeRisk[i],
          actual: state.study ? state.study.nodeRisk[i] : null,
        }))
        .sort((a, b) => b.risk - a.risk);
    },

    /** Circuits ordered by predicted criticality, highest first. */
    circuitLedger(state) {
      if (!state.grid || !state.prediction) return [];
      return state.grid.lines
        .map((line, k) => ({
          id: k,
          line,
          // Undo the training-time square-root compression.
          criticality: state.prediction.edgeCriticality[k] ** 2,
          loading: state.baseState.loading[k],
          flow: state.baseState.flows[k],
          actual: state.study ? state.study.lineCriticality[k] : null,
        }))
        .sort((a, b) => b.criticality - a.criticality);
    },

    summary(state) {
      if (!state.grid || !state.prediction) return null;
      const risks = Array.from(state.prediction.nodeRisk);
      const atRisk = risks.filter((r) => r > 0.15).length;
      let worstLoading = 0;
      for (let k = 0; k < state.grid.lines.length; k++) {
        worstLoading = Math.max(worstLoading, state.baseState.loading[k]);
      }
      const exposedDemand = state.grid.buses.reduce(
        (sum, bus, i) => sum + bus.demand * state.prediction.nodeRisk[i],
        0
      );
      return {
        buses: state.grid.busCount,
        circuits: state.grid.lines.length,
        demandMw: state.grid.totalDemand,
        reserveMarginPct: (state.grid.reserveMargin - 1) * 100,
        atRisk,
        atRiskShare: atRisk / state.grid.busCount,
        worstLoading,
        meanRisk: risks.reduce((a, b) => a + b, 0) / risks.length,
        expectedLossMw: exposedDemand,
        expectedLossShare: exposedDemand / Math.max(state.grid.totalDemand, 1),
      };
    },

    /** How closely the model matched the study, once the study has been run. */
    comparison(state) {
      if (!state.study || !state.prediction) return null;
      const predicted = Array.from(state.prediction.nodeRisk);
      const actual = Array.from(state.study.nodeRisk);
      const predictedCircuits = Array.from(state.prediction.edgeCriticality, (v) => v * v);
      const actualCircuits = Array.from(state.study.lineCriticality);

      const topN = 6;
      const rank = (arr) =>
        arr
          .map((v, i) => i)
          .sort((a, b) => arr[b] - arr[a])
          .slice(0, topN);
      const predTop = rank(predicted);
      const trueTop = new Set(rank(actual));
      const overlap = predTop.filter((i) => trueTop.has(i)).length;

      return {
        busRankCorrelation: agreement(predicted, actual),
        busMae: meanAbsoluteError(predicted, actual),
        circuitRankCorrelation: agreement(predictedCircuits, actualCircuits),
        topBusOverlap: overlap,
        topBusOverlapOf: topN,
        surrogateMs: state.predictMs,
        studyMs: state.study.computeMs,
        speedup: state.study.computeMs / Math.max(state.predictMs, 0.001),
        contingencies: state.study.contingencies,
      };
    },

    selectedBusDetail(state) {
      if (state.selectedBus === null || !state.grid) return null;
      const i = state.selectedBus;
      const bus = state.grid.buses[i];
      const incident = state.grid.lines
        .map((line, k) => ({ line, k }))
        .filter(({ line }) => line.from === i || line.to === i)
        .map(({ line, k }) => ({
          id: k,
          other: line.from === i ? line.to : line.from,
          loading: state.baseState.loading[k],
          capacity: line.capacity,
          flow: state.baseState.flows[k],
          condition: line.condition,
          criticality: state.prediction ? state.prediction.edgeCriticality[k] ** 2 : null,
        }))
        .sort((a, b) => b.loading - a.loading);
      return {
        id: i,
        bus,
        risk: state.prediction ? state.prediction.nodeRisk[i] : null,
        actual: state.study ? state.study.nodeRisk[i] : null,
        incident,
      };
    },
  },

  actions: {
    async initialise() {
      if (this.modelStatus === 'ready' || this.modelStatus === 'loading') return;
      this.modelStatus = 'loading';
      try {
        this.net = await loadModel();
        this.modelReport = getReport();
        this.modelStatus = 'ready';
        this.buildGrid();
      } catch (error) {
        this.modelStatus = 'error';
        this.modelError = error.message || String(error);
      }
    },

    /** Generate a grid, solve it, and score it. */
    buildGrid(options = {}) {
      if (options.seed !== undefined) this.seed = options.seed;
      if (options.busCount !== undefined) this.busCount = options.busCount;
      if (options.scenarioId !== undefined) this.scenarioId = options.scenarioId;

      const knobs = this.scenario.knobs;
      const grid = generateGrid(this.seed, {
        busCount: this.busCount,
        demandScale: knobs.demandScale,
        weatherSeverity: knobs.weatherSeverity,
      });
      const baseState = reinforceGrid(grid);

      this.grid = grid;
      this.baseState = baseState;
      this.sample = toSample(grid, baseState);

      this.study = null;
      this.studyProgress = null;
      this.cascade = null;
      this.cascadeRound = 0;
      this.selectedBus = null;
      this.selectedLine = null;

      this.score();
    },

    score() {
      if (!this.net || !this.sample) return;
      const result = benchmarkPredict(this.net, this.sample);
      this.prediction = result;
      this.predictMs = result.ms;
    },

    newSeed() {
      this.buildGrid({ seed: Math.floor(Math.random() * 2_000_000_000) });
    },

    setScenario(id) {
      this.buildGrid({ scenarioId: id });
    },

    setBusCount(count) {
      this.buildGrid({ busCount: count });
    },

    /** Run the physics study the model is standing in for. */
    async runStudy() {
      if (!this.grid || this.studyRunning) return;
      this.studyRunning = true;
      this.studyCancelled = false;
      this.studyProgress = { done: 0, total: this.grid.lines.length, elapsed: 0 };
      try {
        const result = await runContingencyStudy(
          this.grid,
          this.baseState,
          (progress) => {
            this.studyProgress = progress;
          },
          () => this.studyCancelled
        );
        if (result) this.study = result;
      } finally {
        this.studyRunning = false;
      }
    },

    cancelStudy() {
      this.studyCancelled = true;
    },

    /** Trip a circuit and record the cascade round by round for replay. */
    simulateCascade(lineId) {
      if (!this.grid) return;
      const result = runCascade(this.grid, [lineId]);

      // Re-solve the network after each round so the replay shows the grid as
      // it actually looked at that moment, not just the final picture.
      const mask = new Uint8Array(this.grid.lines.length).fill(1);
      const cumulative = [];
      const frames = [
        { round: 0, tripped: [], cumulativeTripped: [], state: solveBaseCase(this.grid) },
      ];

      result.tripSequence.forEach((round, r) => {
        for (const k of round) {
          mask[k] = 0;
          cumulative.push(k);
        }
        frames.push({
          round: r + 1,
          tripped: round.slice(),
          cumulativeTripped: cumulative.slice(),
          state: solveNetwork(this.grid, mask),
        });
      });

      this.cascade = {
        trigger: lineId,
        frames,
        rounds: result.tripSequence.length,
        loadShedMw: result.loadShed,
        loadShedShare: result.loadShed / Math.max(this.grid.totalDemand, 1),
        deEnergized: result.deEnergized,
        finalIslands: result.state.islands,
      };
      this.cascadeRound = frames.length - 1;
      this.selectedLine = lineId;
    },

    setCascadeRound(round) {
      if (!this.cascade) return;
      this.cascadeRound = Math.max(0, Math.min(round, this.cascade.frames.length - 1));
    },

    clearCascade() {
      this.cascade = null;
      this.cascadeRound = 0;
    },

    selectBus(id) {
      this.selectedBus = this.selectedBus === id ? null : id;
    },

    selectLine(id) {
      this.selectedLine = this.selectedLine === id ? null : id;
    },
  },
});
