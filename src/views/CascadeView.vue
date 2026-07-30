<script setup>
/**
 * Cascade lab.
 *
 * The operations board shows risk as a number. This view shows where the number
 * comes from: pick a circuit, open it, and watch the consequences propagate.
 * Each round re-solves the whole network, so what you are stepping through is
 * the actual physics, not a scripted animation.
 */
import { computed, ref, watch } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import MimicBoard from '@/components/MimicBoard.vue';
import { pct, mw, riskColour, busLabel, lineLabel } from '@/lib/format.js';

const store = useGridStore();
const playing = ref(false);
let timer = null;

const frame = computed(() => {
  if (!store.cascade) return null;
  return store.cascade.frames[store.cascadeRound];
});

const candidates = computed(() => store.circuitLedger.slice(0, 12));

/** Buses without service in the frame currently on screen. */
const darkNow = computed(() => (frame.value ? frame.value.state.deEnergized : null));

const shedNow = computed(() => (frame.value ? frame.value.state.loadShed : 0));

function trip(lineId) {
  stop();
  store.simulateCascade(lineId);
  store.setCascadeRound(0);
  play();
}

function play() {
  if (!store.cascade) return;
  stop();
  playing.value = true;
  store.setCascadeRound(0);
  timer = setInterval(() => {
    if (!store.cascade || store.cascadeRound >= store.cascade.frames.length - 1) {
      stop();
      return;
    }
    store.setCascadeRound(store.cascadeRound + 1);
  }, 1100);
}

function stop() {
  playing.value = false;
  if (timer) clearInterval(timer);
  timer = null;
}

watch(
  () => store.seed,
  () => {
    stop();
  }
);

const worstCandidate = computed(() => (candidates.value.length ? candidates.value[0] : null));
</script>

<template>
  <div class="shell">
    <header class="head">
      <div>
        <p class="eyebrow">Cascade lab</p>
        <h1>Open a circuit. Watch what follows.</h1>
        <p class="lede">
          A single outage rarely stops at one circuit. Power redistributes, the next circuit exceeds its rating, its
          protection opens, and the network can split into islands that no longer have enough generation to serve what
          is left. Each round below is a full re-solve of the system.
        </p>
      </div>
    </header>

    <div v-if="!store.ready" class="notice">Loading the network and generating a grid&hellip;</div>

    <template v-else>
      <div class="layout">
        <section class="board-wrap panel">
          <header class="board-head">
            <div>
              <p class="eyebrow eyebrow--lit">
                <template v-if="store.cascade">
                  Triggered by {{ lineLabel(store.cascade.trigger) }} · round
                  {{ store.cascadeRound }} of {{ store.cascade.frames.length - 1 }}
                </template>
                <template v-else>Intact network</template>
              </p>
              <h3 class="board-title">
                <template v-if="frame && shedNow > 0">
                  {{ mw(shedNow) }} of load lost
                </template>
                <template v-else-if="store.cascade">System holding</template>
                <template v-else>Select a circuit to open</template>
              </h3>
            </div>
            <div v-if="store.cascade" class="transport">
              <button class="toggle" :disabled="store.cascadeRound === 0" @click="store.setCascadeRound(store.cascadeRound - 1)">
                Back
              </button>
              <button class="toggle toggle--on" @click="playing ? stop() : play()">
                {{ playing ? 'Pause' : 'Replay' }}
              </button>
              <button
                class="toggle"
                :disabled="store.cascadeRound >= store.cascade.frames.length - 1"
                @click="store.setCascadeRound(store.cascadeRound + 1)"
              >
                Next
              </button>
            </div>
          </header>

          <MimicBoard
            :grid="store.grid"
            :state="frame ? frame.state : store.baseState"
            :risk="store.cascade ? null : store.prediction.nodeRisk"
            :de-energized="darkNow"
            :tripped-lines="frame ? frame.cumulativeTripped : []"
            :freshly-tripped="frame ? frame.tripped : []"
            :selected-line="store.selectedLine"
            :show-halos="!store.cascade"
            :show-flow="true"
            @select-line="trip"
          />

          <footer class="board-foot">
            <p class="hint mono">click any circuit on the board to open it</p>
            <div v-if="store.cascade" class="rounds">
              <button
                v-for="f in store.cascade.frames"
                :key="f.round"
                class="round-dot"
                :class="{ 'round-dot--on': f.round === store.cascadeRound }"
                :aria-label="`Round ${f.round}`"
                @click="store.setCascadeRound(f.round)"
              >
                {{ f.round }}
              </button>
            </div>
          </footer>
        </section>

        <aside class="side">
          <section class="card pick">
            <header class="pick__head">
              <p class="eyebrow">Circuits the model flags first</p>
            </header>
            <ul class="pick__list">
              <li v-for="c in candidates" :key="c.id">
                <button class="pick__row" :class="{ 'pick__row--on': store.cascade?.trigger === c.id }" @click="trip(c.id)">
                  <span class="mono pick__id">{{ lineLabel(c.id) }}</span>
                  <span class="mono pick__ends">{{ busLabel(c.line.from) }}–{{ busLabel(c.line.to) }}</span>
                  <span class="pick__bar" aria-hidden="true">
                    <span
                      class="pick__fill"
                      :style="{ width: `${Math.min(c.criticality, 1) * 100}%`, background: riskColour(c.criticality) }"
                    />
                  </span>
                  <span class="mono pick__val">{{ pct(c.criticality) }}</span>
                </button>
              </li>
            </ul>
            <p class="pick__note">
              Predicted share of system load lost if that circuit opens. Open one and compare against what actually
              happens.
            </p>
          </section>

          <section v-if="store.cascade" class="card outcome">
            <p class="eyebrow">Outcome</p>
            <div class="outcome__grid">
              <div>
                <p class="outcome__value stat" :style="{ color: riskColour(store.cascade.loadShedShare * 2.2) }">
                  {{ pct(store.cascade.loadShedShare, 1) }}
                </p>
                <p class="outcome__label">of system load lost</p>
              </div>
              <div>
                <p class="outcome__value stat">{{ store.cascade.rounds }}</p>
                <p class="outcome__label">cascade rounds</p>
              </div>
              <div>
                <p class="outcome__value stat">{{ store.cascade.finalIslands }}</p>
                <p class="outcome__label">islands at rest</p>
              </div>
              <div>
                <p class="outcome__value stat">{{ mw(store.cascade.loadShedMw) }}</p>
                <p class="outcome__label">demand not served</p>
              </div>
            </div>
            <p class="outcome__compare">
              The model predicted
              <strong>{{ pct(store.prediction.edgeCriticality[store.cascade.trigger] ** 2, 1) }}</strong>
              for this circuit before anything was simulated.
            </p>
            <button class="btn btn--ghost outcome__reset" @click="stop(); store.clearCascade()">
              Back to the intact network
            </button>
          </section>

          <section v-else-if="worstCandidate" class="card prompt">
            <p class="eyebrow">Start here</p>
            <p class="prompt__text">
              {{ lineLabel(worstCandidate.id) }} carries the highest predicted consequence on this grid. Open it and see
              whether the model was right.
            </p>
            <button class="btn btn--primary" @click="trip(worstCandidate.id)">
              Open {{ lineLabel(worstCandidate.id) }}
            </button>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  padding: 8px 0 24px;
}
.head h1 {
  margin: 9px 0 12px;
}
.lede {
  font-size: 15px;
  color: var(--ink-2);
  max-width: 74ch;
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
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

.transport {
  display: flex;
  gap: 3px;
}
.toggle {
  padding: 4px 10px;
  border: 1px solid var(--panel-rule);
  background: transparent;
  border-radius: var(--radius);
  font-size: 11px;
  font-weight: 500;
  color: var(--panel-ink-2);
  transition: all 0.14s ease;
}
.toggle:hover:not(:disabled) {
  color: var(--panel-ink);
  border-color: #3a4a56;
}
.toggle:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
  gap: 14px;
  padding: 9px 15px 11px;
  border-top: 1px solid var(--panel-rule);
  flex-wrap: wrap;
}
.hint {
  margin: 0;
  font-size: 10.5px;
  color: #5d6f7c;
}

.rounds {
  display: flex;
  gap: 4px;
}
.round-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--panel-rule);
  background: transparent;
  color: var(--panel-ink-2);
  font-family: var(--font-mono);
  font-size: 10px;
  transition: all 0.14s ease;
}
.round-dot--on {
  background: var(--watch-lit);
  border-color: var(--watch-lit);
  color: #0b1014;
  font-weight: 600;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 18px;
  position: sticky;
  top: 78px;
}

.pick {
  padding: 13px 14px 14px;
}
.pick__list {
  list-style: none;
  margin: 9px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pick__row {
  width: 100%;
  display: grid;
  grid-template-columns: 40px 62px minmax(0, 1fr) 38px;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius);
  font-size: 11px;
  text-align: left;
}
.pick__row:hover {
  background: var(--paper-2);
}
.pick__row--on {
  background: var(--paper-2);
  border-color: var(--rule);
}
.pick__id {
  color: var(--ink-3);
}
.pick__ends {
  color: var(--ink-2);
}
.pick__bar {
  position: relative;
  height: 5px;
  background: var(--rule-soft);
  border-radius: 3px;
  overflow: hidden;
}
.pick__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
}
.pick__val {
  text-align: right;
  font-weight: 600;
  color: var(--ink);
}
.pick__note {
  margin: 11px 0 0;
  font-size: 11px;
  color: var(--ink-3);
  line-height: 1.45;
}

.outcome,
.prompt {
  padding: 13px 14px 14px;
}
.outcome__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
  margin-top: 9px;
}
.outcome__value {
  margin: 0;
  font-size: 21px;
  line-height: 1.1;
  color: var(--ink);
}
.outcome__label {
  margin: 1px 0 0;
  font-size: 10.5px;
  color: var(--ink-3);
}
.outcome__compare {
  margin: 13px 0 11px;
  font-size: 12px;
  color: var(--ink-2);
  padding-top: 11px;
  border-top: 1px solid var(--rule);
}
.outcome__reset {
  width: 100%;
  justify-content: center;
}

.prompt__text {
  margin: 7px 0 11px;
  font-size: 12.5px;
  color: var(--ink-2);
}

.notice {
  padding: 20px;
  border: 1px dashed var(--rule);
  border-radius: var(--radius-lg);
  color: var(--ink-2);
  font-size: 13.5px;
}

@media (max-width: 1120px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .side {
    position: static;
  }
}
</style>
