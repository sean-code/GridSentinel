<script setup>
/**
 * Operations — the landing view.
 *
 * The hero is not a headline over a stock gradient; it is the board itself,
 * already scored, already live. Anyone arriving here sees a working system
 * before they read a word about it.
 */
import { computed, ref } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import MimicBoard from '@/components/MimicBoard.vue';
import RiskLedger from '@/components/RiskLedger.vue';
import BusInspector from '@/components/BusInspector.vue';
import HeadToHead from '@/components/HeadToHead.vue';
import ScenarioControls from '@/components/ScenarioControls.vue';
import MetricStrip from '@/components/MetricStrip.vue';
import { pct, ms, lineLabel, busLabel } from '@/lib/format.js';

const store = useGridStore();

const showHalos = ref(true);
const showFlow = ref(true);
const showLabels = ref(false);

const hoveredLine = computed(() => {
  if (store.hoveredLine === null || !store.grid) return null;
  const k = store.hoveredLine;
  const line = store.grid.lines[k];
  return {
    id: k,
    from: line.from,
    to: line.to,
    kv: line.kv,
    loading: store.baseState.loading[k],
    criticality: store.prediction ? store.prediction.edgeCriticality[k] ** 2 : null,
  };
});
</script>

<template>
  <div class="shell">
    <!-- Hero: a one-line thesis, then straight into the instrument. -->
    <section class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Cascading outage risk</p>
        <h1>
          A blackout is a <em>topology</em> problem.<br />
          So predict it with one.
        </h1>
        <p class="hero__lede">
          Whether a substation keeps the lights on does not depend on its own meters. It depends on whether the piece of
          network it falls into, after the failures propagate, still contains generation. GridSentinel learns that from
          the wiring — and answers in
          <strong class="mono">{{ ms(store.predictMs) }}</strong> what a full contingency study takes seconds to work
          out.
        </p>
      </div>
      <div v-if="store.summary" class="hero__readout">
        <p class="eyebrow">Right now, on this grid</p>
        <p class="hero__big stat">{{ store.summary.atRisk }}</p>
        <p class="hero__big-label">
          of {{ store.summary.buses }} buses carry meaningful outage risk under
          <strong>{{ store.scenario.name.toLowerCase() }}</strong> conditions
        </p>
      </div>
    </section>

    <div v-if="store.modelStatus === 'error'" class="notice notice--error">
      <p><strong>The model weights did not load.</strong> {{ store.modelError }}</p>
      <p class="notice__fix">
        If you are running this locally, generate them first with <code>npm run ml</code>, then reload.
      </p>
    </div>

    <div v-else-if="!store.ready" class="notice">
      <p>Loading the network and generating a grid&hellip;</p>
    </div>

    <template v-else>
      <MetricStrip class="block" />

      <div class="workspace block">
        <!-- The instrument -->
        <section class="board-wrap panel">
          <header class="board-head">
            <div>
              <p class="eyebrow eyebrow--lit">Mimic board · seed {{ store.seed }}</p>
              <h3 class="board-title">
                {{ store.grid.busCount }} buses, {{ store.grid.lines.length }} circuits
              </h3>
            </div>
            <div class="toggles">
              <button class="toggle" :class="{ 'toggle--on': showHalos }" @click="showHalos = !showHalos">
                Risk
              </button>
              <button class="toggle" :class="{ 'toggle--on': showFlow }" @click="showFlow = !showFlow">Flow</button>
              <button class="toggle" :class="{ 'toggle--on': showLabels }" @click="showLabels = !showLabels">
                Labels
              </button>
            </div>
          </header>

          <MimicBoard
            :grid="store.grid"
            :state="store.baseState"
            :risk="store.prediction.nodeRisk"
            :criticality="store.prediction.edgeCriticality"
            :selected-bus="store.selectedBus"
            :selected-line="store.selectedLine"
            :show-halos="showHalos"
            :show-flow="showFlow"
            :show-labels="showLabels"
            @select-bus="store.selectBus"
            @select-line="store.selectLine"
            @hover-line="(id) => (store.hoveredLine = id)"
          />

          <footer class="board-foot">
            <div class="legend">
              <span class="legend__item"><span class="glyph glyph--gen" />generator</span>
              <span class="legend__item"><span class="glyph glyph--sub" />substation</span>
              <span class="legend__item"><span class="glyph glyph--load" />load</span>
              <span class="legend__scale">
                <span class="legend__ramp" aria-hidden="true" />
                <span class="mono">secure &rarr; critical</span>
              </span>
            </div>
            <p v-if="hoveredLine" class="hover mono">
              {{ lineLabel(hoveredLine.id) }} · {{ busLabel(hoveredLine.from) }}–{{ busLabel(hoveredLine.to) }} ·
              {{ hoveredLine.kv }} kV · {{ pct(hoveredLine.loading) }} loaded ·
              {{ pct(hoveredLine.criticality) }} of load at stake
            </p>
            <p v-else class="hover hover--muted mono">
              hover a circuit for detail · click a bus to inspect it
            </p>
          </footer>
        </section>

        <!-- The reading surfaces -->
        <div class="side">
          <RiskLedger />
          <BusInspector />
        </div>
      </div>

      <HeadToHead class="block" />

      <section class="card block">
        <ScenarioControls />
      </section>
    </template>
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 40px;
  align-items: end;
  padding: 14px 0 30px;
}

.hero h1 {
  margin: 9px 0 14px;
}
.hero h1 em {
  font-style: normal;
  color: var(--indigo);
  /* A single underline that reads as a conductor, not a highlighter. */
  box-shadow: inset 0 -0.14em 0 rgba(43, 58, 103, 0.18);
}

.hero__lede {
  font-size: 15.5px;
  color: var(--ink-2);
  max-width: 62ch;
  margin: 0;
}
.hero__lede strong {
  color: var(--ink);
}

.hero__readout {
  padding: 16px 18px;
  border-left: 2px solid var(--ink);
  background: var(--paper-2);
}
.hero__big {
  margin: 5px 0 3px;
  font-size: 58px;
  line-height: 0.94;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.hero__big-label {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-2);
  max-width: 34ch;
}

.block {
  margin-bottom: 18px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 356px;
  gap: 18px;
  align-items: start;
}

.board-wrap {
  overflow: hidden;
}

.board-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 15px 11px;
  border-bottom: 1px solid var(--panel-rule);
  flex-wrap: wrap;
}
.board-title {
  margin: 2px 0 0;
  font-size: 15px;
  color: var(--panel-ink);
}

.toggles {
  display: flex;
  gap: 3px;
}
.toggle {
  padding: 4px 9px;
  border: 1px solid var(--panel-rule);
  background: transparent;
  border-radius: var(--radius);
  font-size: 11px;
  font-weight: 500;
  color: var(--panel-ink-2);
  transition: all 0.14s ease;
}
.toggle:hover {
  color: var(--panel-ink);
  border-color: #3a4a56;
}
.toggle--on {
  background: var(--panel-3);
  color: var(--panel-ink);
  border-color: #3a4a56;
}

.board-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 15px 11px;
  border-top: 1px solid var(--panel-rule);
  flex-wrap: wrap;
}

.legend {
  display: flex;
  align-items: center;
  gap: 13px;
  flex-wrap: wrap;
}
.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--panel-ink-2);
  font-family: var(--font-mono);
}
.glyph {
  width: 9px;
  height: 9px;
  background: #7e8f9c;
  display: inline-block;
}
.glyph--gen {
  border-radius: 50%;
}
.glyph--sub {
  transform: rotate(45deg);
}
.glyph--load {
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
.legend__scale {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--panel-ink-2);
}
.legend__ramp {
  width: 62px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #2fb3a6, #f2b23e 45%, #f0576f);
}

.hover {
  margin: 0;
  font-size: 10.5px;
  color: var(--panel-ink);
}
.hover--muted {
  color: #5d6f7c;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 18px;
  position: sticky;
  top: 78px;
}

.notice {
  padding: 20px;
  border: 1px dashed var(--rule);
  border-radius: var(--radius-lg);
  color: var(--ink-2);
  font-size: 13.5px;
  margin-bottom: 18px;
}
.notice p {
  margin: 0;
}
.notice--error {
  border-color: var(--critical);
  border-style: solid;
  background: rgba(175, 47, 69, 0.05);
}
.notice__fix {
  margin-top: 7px !important;
  font-size: 12.5px;
}

@media (max-width: 1120px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  .side {
    position: static;
  }
  .hero {
    grid-template-columns: 1fr;
    gap: 22px;
    align-items: start;
  }
}
</style>
