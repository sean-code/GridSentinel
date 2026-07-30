<script setup>
/**
 * Bus inspector.
 *
 * Shows the evidence behind one bus's score: what it is, what it draws, what it
 * is connected by, and how hard those connections are working. The point is not
 * to explain the network's internals — it is to give an engineer the same facts
 * the network had, so they can disagree with it.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { riskColour, pct, mw, busLabel, lineLabel, bandOf, BUS_TYPE_LABEL } from '@/lib/format.js';

const store = useGridStore();
const detail = computed(() => store.selectedBusDetail);
const band = computed(() => (detail.value ? bandOf(detail.value.risk) : null));
</script>

<template>
  <section class="inspector card">
    <template v-if="detail">
      <header class="inspector__head">
        <div>
          <p class="eyebrow">{{ busLabel(detail.id) }} · {{ BUS_TYPE_LABEL[detail.bus.type] }}</p>
          <h3>{{ detail.bus.kv }} kV bus</h3>
        </div>
        <button class="btn btn--ghost" aria-label="Close inspector" @click="store.selectBus(detail.id)">Close</button>
      </header>

      <div class="score" :style="{ '--tone': riskColour(detail.risk) }">
        <div class="score__main">
          <span class="score__value stat">{{ pct(detail.risk, 1) }}</span>
          <span class="score__band">{{ band.label }}</span>
        </div>
        <p class="score__caption">
          Predicted probability of losing service in the next credible circuit outage.
          <template v-if="detail.actual !== null">
            The physics study put it at <strong>{{ pct(detail.actual, 1) }}</strong>.
          </template>
        </p>
      </div>

      <dl class="facts">
        <div class="fact">
          <dt>Peak demand</dt>
          <dd class="mono">{{ detail.bus.demand > 0 ? mw(detail.bus.demand, 1) : 'none' }}</dd>
        </div>
        <div class="fact">
          <dt>Installed capacity</dt>
          <dd class="mono">{{ detail.bus.pmax > 0 ? mw(detail.bus.pmax, 1) : 'none' }}</dd>
        </div>
        <div class="fact">
          <dt>Circuits</dt>
          <dd class="mono">{{ detail.incident.length }}</dd>
        </div>
        <div class="fact">
          <dt>Weather stress</dt>
          <dd class="mono">{{ pct(detail.bus.weather) }}</dd>
        </div>
      </dl>

      <div class="circuits">
        <p class="eyebrow">Incident circuits, worst loaded first</p>
        <ul class="circuit-list">
          <li v-for="c in detail.incident" :key="c.id" class="circuit-row">
            <span class="mono circuit-row__id">{{ lineLabel(c.id) }}</span>
            <span class="mono circuit-row__to">to {{ busLabel(c.other) }}</span>
            <span class="circuit-row__bar" aria-hidden="true">
              <span
                class="circuit-row__fill"
                :style="{ width: `${Math.min(c.loading, 1.2) / 1.2 * 100}%`, background: riskColour(Math.min(c.loading / 1.05, 1)) }"
              />
            </span>
            <span class="mono circuit-row__val">{{ pct(c.loading) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <div v-else class="empty">
      <p class="eyebrow">Inspector</p>
      <p class="empty__text">
        Pick a bus on the board or in the worklist to see what it is, what it draws, and which circuits it depends on.
      </p>
    </div>
  </section>
</template>

<style scoped>
.inspector {
  padding: 14px 16px 16px;
  min-height: 180px;
}

.inspector__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.score {
  padding: 11px 13px;
  border-left: 3px solid var(--tone);
  background: var(--paper-2);
  border-radius: 0 var(--radius) var(--radius) 0;
}
.score__main {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.score__value {
  font-size: 27px;
  line-height: 1;
  color: var(--tone);
}
.score__band {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.score__caption {
  margin: 7px 0 0;
  font-size: 11.5px;
  color: var(--ink-2);
  line-height: 1.45;
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 14px;
  margin: 14px 0 0;
}
.fact {
  min-width: 0;
}
.fact dt {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.fact dd {
  margin: 1px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.circuits {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
}

.circuit-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 168px;
  overflow-y: auto;
}

.circuit-row {
  display: grid;
  grid-template-columns: 40px 54px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.circuit-row__id {
  color: var(--ink-3);
}
.circuit-row__to {
  color: var(--ink-2);
}
.circuit-row__bar {
  position: relative;
  height: 5px;
  background: var(--rule-soft);
  border-radius: 3px;
  overflow: hidden;
}
.circuit-row__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
}
.circuit-row__val {
  text-align: right;
  color: var(--ink);
  font-weight: 600;
}

.empty__text {
  margin: 7px 0 0;
  font-size: 12.5px;
  color: var(--ink-3);
  max-width: 42ch;
}
</style>
