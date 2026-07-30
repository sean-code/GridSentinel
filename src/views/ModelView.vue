<script setup>
/**
 * Model card.
 *
 * Everything here is read from the JSON the training pipeline wrote — nothing
 * is typed in by hand. Re-run `npm run ml` and this page updates itself, which
 * is the only way a model card stays true.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { num, pct, ms } from '@/lib/format.js';

const store = useGridStore();
const report = computed(() => store.modelReport);

const ablation = computed(() => {
  const r = report.value;
  if (!r) return [];
  return [
    { label: 'Bus risk ROC-AUC', graph: r.test.graph.nodeAuc, blind: r.test.blind.nodeAuc, higher: true },
    {
      label: 'Bus risk average precision',
      graph: r.test.graph.nodeAveragePrecision,
      blind: r.test.blind.nodeAveragePrecision,
      higher: true,
    },
    { label: 'Bus risk Brier score', graph: r.test.graph.nodeBrier, blind: r.test.blind.nodeBrier, higher: false },
    { label: 'Bus risk mean absolute error', graph: r.test.graph.nodeMae, blind: r.test.blind.nodeMae, higher: false },
    {
      label: 'Circuit criticality (Spearman)',
      graph: r.test.graph.edgeSpearman,
      blind: r.test.blind.edgeSpearman,
      higher: true,
    },
    {
      label: 'Circuit top-5 precision',
      graph: r.test.graph.edgePrecisionAt5,
      blind: r.test.blind.edgePrecisionAt5,
      higher: true,
    },
  ];
});

// --- training curve -------------------------------------------------------
const CURVE_W = 640;
const CURVE_H = 170;

const curve = computed(() => {
  const r = report.value;
  if (!r) return null;
  const g = r.training.graph.history;
  const b = r.training.blind.history;
  const all = [...g, ...b].map((h) => h.valAuc).filter(Number.isFinite);
  const lo = Math.min(...all, 0.7);
  const hi = Math.max(...all, 0.9);
  const pad = (hi - lo) * 0.12 || 0.01;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const n = Math.max(g.length, b.length);

  const path = (history) =>
    history
      .map((h, i) => {
        const x = (i / Math.max(n - 1, 1)) * CURVE_W;
        const y = CURVE_H - ((h.valAuc - yMin) / (yMax - yMin)) * CURVE_H;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  const ticks = [yMin, (yMin + yMax) / 2, yMax].map((v) => ({
    value: v,
    y: CURVE_H - ((v - yMin) / (yMax - yMin)) * CURVE_H,
  }));

  return { graph: path(g), blind: path(b), ticks, epochs: n };
});

// --- scaling chart --------------------------------------------------------
const SCALE_W = 640;
const SCALE_H = 190;

const scaling = computed(() => {
  const r = report.value;
  if (!r?.benchmark?.scaling?.length) return null;
  const pts = r.benchmark.scaling;
  const maxMs = Math.max(...pts.map((p) => p.simulatorMs)) * 1.1;
  const maxBus = Math.max(...pts.map((p) => p.buses));
  const minBus = Math.min(...pts.map((p) => p.buses));
  const x = (b) => ((b - minBus) / Math.max(maxBus - minBus, 1)) * SCALE_W;
  const y = (v) => SCALE_H - (v / maxMs) * SCALE_H;
  const line = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.buses).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  return {
    points: pts.map((p) => ({ ...p, cx: x(p.buses), cySim: y(p.simulatorMs), cyNet: y(p.surrogateMs) })),
    simPath: line('simulatorMs'),
    netPath: line('surrogateMs'),
    maxMs,
  };
});

// --- calibration ----------------------------------------------------------
const calibration = computed(() => {
  const bins = report.value?.test?.graph?.reliability;
  if (!bins) return null;
  return bins.filter((b) => b.count > 0);
});
</script>

<template>
  <div class="shell">
    <header class="head">
      <p class="eyebrow">Model card</p>
      <h1>TopoRiskNet</h1>
      <p class="lede">
        An edge-gated GraphSAGE network trained to reproduce the output of a probability-weighted N-1 contingency study.
        Every figure on this page is read from the report the training run wrote, so it cannot drift away from the model
        that is actually shipping.
      </p>
    </header>

    <div v-if="!report" class="notice">
      The training report has not loaded. Run <code>npm run ml</code> to generate it.
    </div>

    <template v-else>
      <!-- Headline ablation ------------------------------------------------->
      <section class="card block hero-result">
        <div class="hero-result__copy">
          <p class="eyebrow">The result that matters</p>
          <h2>The graph is doing the work</h2>
          <p>
            The ablation is the control. Both models see identical per-bus features — voltage class, demand, dispatch,
            local circuit loadings, weather stress. Only one of them also gets to see how the buses are wired together.
            If topology were decoration, the two columns would match.
          </p>
          <p class="hero-result__note">
            Trained on {{ report.dataset.train.grids }} grids, validated on {{ report.dataset.val.grids }}, and scored
            on {{ report.dataset.test.grids }} held-out grids the model never saw. Seed ranges are disjoint, so no grid
            can leak between splits.
          </p>
        </div>
        <div class="hero-result__numbers">
          <div class="big">
            <p class="eyebrow">Graph</p>
            <p class="big__value stat">{{ num(report.test.graph.nodeAuc, 3) }}</p>
            <p class="big__label">ROC-AUC</p>
          </div>
          <div class="big big--muted">
            <p class="eyebrow">Graph-blind</p>
            <p class="big__value stat">{{ num(report.test.blind.nodeAuc, 3) }}</p>
            <p class="big__label">ROC-AUC</p>
          </div>
        </div>
      </section>

      <!-- Ablation table ---------------------------------------------------->
      <section class="card block pad">
        <p class="eyebrow">Held-out comparison</p>
        <h3 class="section-title">Every metric, both models</h3>
        <table class="ablation">
          <thead>
            <tr>
              <th>Metric</th>
              <th class="right">Graph</th>
              <th class="right">Graph-blind</th>
              <th class="right">Difference</th>
              <th class="bar-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ablation" :key="row.label">
              <td>{{ row.label }}</td>
              <td class="right mono strong">{{ num(row.graph, 3) }}</td>
              <td class="right mono">{{ num(row.blind, 3) }}</td>
              <td class="right mono" :class="(row.graph - row.blind > 0) === row.higher ? 'good' : 'bad'">
                {{ (row.graph - row.blind >= 0 ? '+' : '') + num(row.graph - row.blind, 3) }}
              </td>
              <td class="bar-col">
                <span class="delta-bar" aria-hidden="true">
                  <span
                    class="delta-bar__fill"
                    :class="(row.graph - row.blind > 0) === row.higher ? 'delta-bar__fill--good' : 'delta-bar__fill--bad'"
                    :style="{ width: `${Math.min(Math.abs(row.graph - row.blind) * 320, 100)}%` }"
                  />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="caption">
          Circuit criticality is the honest weak spot: both models rank circuits about equally well, because the circuit
          head already sees both endpoints and the circuit's own state, which is most of what that question needs. The
          graph earns its keep on the bus question, where the answer depends on structure several hops away.
        </p>
      </section>

      <!-- Training curve ---------------------------------------------------->
      <section class="card block pad">
        <p class="eyebrow">Training</p>
        <h3 class="section-title">Validation AUC by epoch</h3>
        <svg class="chart" :viewBox="`-44 -12 ${CURVE_W + 60} ${CURVE_H + 40}`" role="img" aria-label="Validation AUC by epoch">
          <g class="axis">
            <line v-for="t in curve.ticks" :key="t.value" x1="0" :y1="t.y" :x2="CURVE_W" :y2="t.y" />
            <text v-for="t in curve.ticks" :key="`l${t.value}`" x="-9" :y="t.y + 3.5" class="tick">
              {{ t.value.toFixed(2) }}
            </text>
          </g>
          <path :d="curve.blind" class="series series--blind" />
          <path :d="curve.graph" class="series series--graph" />
          <text x="0" :y="CURVE_H + 20" class="tick">epoch 1</text>
          <text :x="CURVE_W" :y="CURVE_H + 20" class="tick right-anchor">{{ curve.epochs }}</text>
        </svg>
        <div class="key">
          <span class="key__item"><span class="key__swatch key__swatch--graph" />graph</span>
          <span class="key__item"><span class="key__swatch key__swatch--blind" />graph-blind</span>
          <span class="key__note mono">
            best epoch {{ report.training.graph.bestEpoch }} · {{ report.training.graph.seconds.toFixed(0) }}s to train
          </span>
        </div>
      </section>

      <!-- Scaling ----------------------------------------------------------->
      <section class="card block pad">
        <p class="eyebrow">Why a surrogate at all</p>
        <h3 class="section-title">Cost against system size</h3>
        <p class="section-lede">
          A contingency study has to factorise the network once per contingency, so its cost climbs roughly with the
          cube of the bus count. The network's cost is linear. On a small grid the difference is unremarkable, and this
          chart says so — it is the slope that makes the case, and real transmission systems have thousands of buses,
          far to the right of anything plotted here.
        </p>
        <svg
          v-if="scaling"
          class="chart"
          :viewBox="`-46 -14 ${SCALE_W + 70} ${SCALE_H + 42}`"
          role="img"
          aria-label="Compute time against system size"
        >
          <g class="axis">
            <line x1="0" :y1="SCALE_H" :x2="SCALE_W" :y2="SCALE_H" />
            <line x1="0" y1="0" :x2="SCALE_W" y2="0" />
            <text x="-9" y="4" class="tick">{{ scaling.maxMs.toFixed(0) }} ms</text>
            <text x="-9" :y="SCALE_H + 4" class="tick">0</text>
          </g>
          <path :d="scaling.simPath" class="series series--sim" />
          <path :d="scaling.netPath" class="series series--net" />
          <g v-for="p in scaling.points" :key="p.buses">
            <circle :cx="p.cx" :cy="p.cySim" r="3.5" class="dot dot--sim" />
            <circle :cx="p.cx" :cy="p.cyNet" r="3.5" class="dot dot--net" />
            <text :x="p.cx" :y="SCALE_H + 19" class="tick mid-anchor">{{ p.buses }}</text>
            <text :x="p.cx" :y="p.cySim - 9" class="tick mid-anchor speedup">{{ p.speedup.toFixed(0) }}&times;</text>
          </g>
          <text :x="SCALE_W / 2" :y="SCALE_H + 36" class="tick mid-anchor">buses in the system</text>
        </svg>
        <div class="key">
          <span class="key__item"><span class="key__swatch key__swatch--sim" />N-1 contingency study</span>
          <span class="key__item"><span class="key__swatch key__swatch--net" />TopoRiskNet</span>
        </div>
        <p class="caption">
          Measured in Node on the machine that ran training, so the absolute numbers are not a benchmark of your
          hardware. The ratio is the transferable part. You can watch the same comparison run live in your own browser
          on the Operations page.
        </p>
      </section>

      <!-- Calibration ------------------------------------------------------->
      <section v-if="calibration" class="card block pad">
        <p class="eyebrow">Calibration</p>
        <h3 class="section-title">When it says 30%, does it happen 30% of the time?</h3>
        <p class="section-lede">
          Ranking is not enough for triage — an operator needs the number itself to mean something. Each bar is a
          predicted-probability bucket; the marker is how often those buses actually lost service in the study.
        </p>
        <div class="calib">
          <div v-for="bin in calibration" :key="bin.bin" class="calib__col">
            <div class="calib__track">
              <div class="calib__observed" :style="{ height: `${bin.observed * 100}%` }" />
              <div class="calib__predicted" :style="{ bottom: `${bin.predicted * 100}%` }" />
            </div>
            <span class="calib__label mono">{{ (bin.bin * 100).toFixed(0) }}</span>
          </div>
        </div>
        <div class="key">
          <span class="key__item"><span class="key__swatch key__swatch--observed" />observed outage rate</span>
          <span class="key__item"><span class="key__swatch key__swatch--predicted" />mean prediction</span>
          <span class="key__note mono">Brier {{ num(report.test.graph.nodeBrier, 3) }}</span>
        </div>
      </section>

      <!-- Specification ----------------------------------------------------->
      <section class="card block pad">
        <p class="eyebrow">Specification</p>
        <h3 class="section-title">Architecture and data</h3>
        <div class="spec">
          <dl>
            <div><dt>Family</dt><dd>{{ report.architecture.family }}</dd></div>
            <div><dt>Message-passing layers</dt><dd class="mono">{{ report.architecture.layers }}</dd></div>
            <div><dt>Hidden width</dt><dd class="mono">{{ report.architecture.hidden }}</dd></div>
            <div><dt>Parameters</dt><dd class="mono">{{ report.architecture.parameters.toLocaleString() }}</dd></div>
            <div><dt>Baseline parameters</dt><dd class="mono">{{ report.architecture.baselineParameters.toLocaleString() }}</dd></div>
            <div><dt>Heads</dt><dd>per-bus risk, per-circuit criticality</dd></div>
          </dl>
          <dl>
            <div><dt>Training grids</dt><dd class="mono">{{ report.dataset.train.grids }}</dd></div>
            <div><dt>Buses seen</dt><dd class="mono">{{ report.dataset.train.buses.toLocaleString() }}</dd></div>
            <div>
              <dt>Contingencies simulated</dt>
              <dd class="mono">
                {{
                  (
                    report.dataset.train.contingenciesSimulated +
                    report.dataset.val.contingenciesSimulated +
                    report.dataset.test.contingenciesSimulated
                  ).toLocaleString()
                }}
              </dd>
            </div>
            <div><dt>Positive rate</dt><dd class="mono">{{ pct(report.dataset.train.positiveRate, 1) }}</dd></div>
            <div><dt>Risk threshold</dt><dd class="mono">{{ report.riskThreshold }}</dd></div>
            <div><dt>Epochs</dt><dd class="mono">{{ report.epochs }}, batch {{ report.batchSize }}</dd></div>
          </dl>
        </div>
      </section>

      <!-- Limitations ------------------------------------------------------->
      <section class="card block pad limits">
        <p class="eyebrow">Limitations</p>
        <h3 class="section-title">What this model cannot do</h3>
        <ul>
          <li>
            <strong>It is trained on simulated grids.</strong> The generator produces networks that behave plausibly,
            but no real utility data went into this, and none of these numbers transfer to a real system without
            retraining on one.
          </li>
          <li>
            <strong>The physics is the DC approximation.</strong> Flat voltages, small angles, no reactive power, no
            resistance. That is the standard screening model, and it is the right one for contingency ranking, but it is
            not an AC solution.
          </li>
          <li>
            <strong>Single-circuit outages only.</strong> The label comes from N-1. Real operators also plan for N-1-1
            and common-mode failures, which this does not cover.
          </li>
          <li>
            <strong>It is a surrogate, not a replacement.</strong> The correct use is triage — decide which of a
            thousand cases deserves the exact study. Anything that actually gets switched should still be simulated
            properly.
          </li>
          <li>
            <strong>Only tested inside its envelope.</strong> {{ report.dataset.train.meanBuses.toFixed(0) }}-bus grids
            on average, with the load and weather ranges listed above. Push far outside that and the calibration above
            no longer applies.
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head {
  padding: 8px 0 26px;
}
.head h1 {
  margin: 9px 0 12px;
}
.lede {
  font-size: 15px;
  color: var(--ink-2);
  max-width: 76ch;
  margin: 0;
}

.block {
  margin-bottom: 18px;
}
.pad {
  padding: 17px 20px 19px;
}
.section-title {
  margin: 4px 0 12px;
}
.section-lede {
  font-size: 13.5px;
  color: var(--ink-2);
  max-width: 78ch;
  margin: 0 0 16px;
}
.caption {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--ink-3);
  max-width: 84ch;
  line-height: 1.5;
}

/* Headline ablation */
.hero-result {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 30px;
  padding: 22px 22px 24px;
  align-items: center;
}
.hero-result h2 {
  margin: 5px 0 12px;
}
.hero-result p {
  font-size: 13.8px;
  color: var(--ink-2);
}
.hero-result__note {
  font-size: 12.5px !important;
  color: var(--ink-3) !important;
  margin-bottom: 0 !important;
}
.hero-result__numbers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.big {
  padding: 14px 15px;
  border-left: 3px solid var(--secure);
  background: var(--paper-2);
}
.big--muted {
  border-left-color: var(--ink-3);
}
.big__value {
  margin: 5px 0 1px;
  font-size: 34px;
  line-height: 1;
  color: var(--ink);
}
.big--muted .big__value {
  color: var(--ink-2);
}
.big__label {
  margin: 0;
  font-size: 10.5px;
  color: var(--ink-3);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Ablation table */
.ablation .right {
  text-align: right;
}
.ablation .strong {
  font-weight: 600;
}
.ablation .good {
  color: var(--secure);
}
.ablation .bad {
  color: var(--ink-3);
}
.bar-col {
  width: 110px;
}
.delta-bar {
  display: block;
  height: 6px;
  background: var(--rule-soft);
  border-radius: 3px;
  overflow: hidden;
}
.delta-bar__fill {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.delta-bar__fill--good {
  background: var(--secure);
}
.delta-bar__fill--bad {
  background: var(--ink-3);
}

/* Charts */
.chart {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.axis line {
  stroke: var(--rule);
  stroke-width: 1;
}
.tick {
  font-family: var(--font-mono);
  font-size: 10px;
  fill: var(--ink-3);
  text-anchor: end;
}
.mid-anchor {
  text-anchor: middle;
}
.right-anchor {
  text-anchor: end;
}
.speedup {
  fill: var(--ink-2);
  font-weight: 600;
}
.series {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.series--graph {
  stroke: var(--indigo);
}
.series--blind {
  stroke: var(--ink-3);
  stroke-dasharray: 4 4;
}
.series--sim {
  stroke: var(--critical);
}
.series--net {
  stroke: var(--secure);
}
.dot--sim {
  fill: var(--critical);
}
.dot--net {
  fill: var(--secure);
}

.key {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 13px;
  flex-wrap: wrap;
}
.key__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ink-2);
}
.key__swatch {
  width: 15px;
  height: 3px;
  border-radius: 2px;
  background: var(--ink-3);
}
.key__swatch--graph {
  background: var(--indigo);
}
.key__swatch--sim {
  background: var(--critical);
}
.key__swatch--net {
  background: var(--secure);
}
.key__swatch--observed {
  background: var(--indigo);
  height: 11px;
  width: 11px;
  border-radius: 2px;
}
.key__swatch--predicted {
  background: var(--ink);
  height: 2px;
  width: 15px;
}
.key__note {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--ink-3);
}

/* Calibration */
.calib {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 165px;
}
.calib__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  height: 100%;
}
.calib__track {
  position: relative;
  flex: 1;
  width: 100%;
  background: var(--paper-2);
  border-radius: 2px;
  border: 1px solid var(--rule-soft);
}
.calib__observed {
  position: absolute;
  inset: auto 0 0 0;
  background: var(--indigo);
  border-radius: 0 0 2px 2px;
  opacity: 0.82;
}
.calib__predicted {
  position: absolute;
  left: -1px;
  right: -1px;
  height: 2px;
  background: var(--ink);
}
.calib__label {
  font-size: 9.5px;
  color: var(--ink-3);
}

/* Spec */
.spec {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 26px;
}
.spec dl {
  margin: 0;
}
.spec dl > div {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule-soft);
}
.spec dl > div:last-child {
  border-bottom: none;
}
.spec dt {
  font-size: 12.5px;
  color: var(--ink-2);
}
.spec dd {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  text-align: right;
}

/* Limits */
.limits ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.limits li {
  font-size: 13.2px;
  color: var(--ink-2);
  max-width: 84ch;
  line-height: 1.52;
}
.limits strong {
  color: var(--ink);
}

.notice {
  padding: 20px;
  border: 1px dashed var(--rule);
  border-radius: var(--radius-lg);
  color: var(--ink-2);
  font-size: 13.5px;
}

@media (max-width: 900px) {
  .hero-result,
  .spec {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .bar-col {
    display: none;
  }
}
</style>
