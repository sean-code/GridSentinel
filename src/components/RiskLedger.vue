<script setup>
/**
 * The risk ledger.
 *
 * A board shows you where risk is; a ledger tells you what to do first. This is
 * the worklist: buses ranked by predicted outage probability, circuits ranked
 * by how much load their failure would cost. Once the physics study has run,
 * each row also carries the study's own answer so the two can be read side by
 * side without switching views.
 */
import { computed, ref } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { riskColour, pct, mw, busLabel, lineLabel, BUS_TYPE_LABEL } from '@/lib/format.js';

const store = useGridStore();
const tab = ref('buses');
const LIMIT = 9;

const buses = computed(() => store.riskLedger.slice(0, LIMIT));
const circuits = computed(() => store.circuitLedger.slice(0, LIMIT));
</script>

<template>
  <section class="ledger card">
    <header class="ledger__head">
      <div>
        <p class="eyebrow">Worklist</p>
        <h3>Ranked by predicted risk</h3>
      </div>
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ 'tab--on': tab === 'buses' }"
          role="tab"
          :aria-selected="tab === 'buses'"
          @click="tab = 'buses'"
        >
          Buses
        </button>
        <button
          class="tab"
          :class="{ 'tab--on': tab === 'circuits' }"
          role="tab"
          :aria-selected="tab === 'circuits'"
          @click="tab = 'circuits'"
        >
          Circuits
        </button>
      </div>
    </header>

    <div v-if="tab === 'buses'" class="rows">
      <button
        v-for="row in buses"
        :key="row.id"
        class="row"
        :class="{ 'row--on': store.selectedBus === row.id }"
        @click="store.selectBus(row.id)"
      >
        <span class="row__id mono">{{ busLabel(row.id) }}</span>
        <span class="row__body">
          <span class="row__title">{{ BUS_TYPE_LABEL[row.bus.type] }}</span>
          <span class="row__meta mono">
            {{ row.bus.kv }} kV · {{ row.bus.demand > 0 ? mw(row.bus.demand) : 'no load' }}
          </span>
        </span>
        <span class="row__bar" aria-hidden="true">
          <span class="row__fill" :style="{ width: `${row.risk * 100}%`, background: riskColour(row.risk) }" />
          <span
            v-if="row.actual !== null"
            class="row__truth"
            :style="{ left: `${Math.min(row.actual * 100, 99.4)}%` }"
            :title="`Study: ${pct(row.actual)}`"
          />
        </span>
        <span class="row__value mono" :style="{ color: riskColour(row.risk) }">{{ pct(row.risk) }}</span>
      </button>
    </div>

    <div v-else class="rows">
      <button
        v-for="row in circuits"
        :key="row.id"
        class="row"
        :class="{ 'row--on': store.selectedLine === row.id }"
        @click="store.selectLine(row.id)"
      >
        <span class="row__id mono">{{ lineLabel(row.id) }}</span>
        <span class="row__body">
          <span class="row__title mono">
            {{ busLabel(row.line.from) }} — {{ busLabel(row.line.to) }}
          </span>
          <span class="row__meta mono">{{ row.line.kv }} kV · {{ pct(row.loading) }} loaded</span>
        </span>
        <span class="row__bar" aria-hidden="true">
          <span
            class="row__fill"
            :style="{ width: `${Math.min(row.criticality, 1) * 100}%`, background: riskColour(row.criticality) }"
          />
          <span
            v-if="row.actual !== null"
            class="row__truth"
            :style="{ left: `${Math.min(row.actual * 100, 99.4)}%` }"
            :title="`Study: ${pct(row.actual)} of load`"
          />
        </span>
        <span class="row__value mono" :style="{ color: riskColour(row.criticality) }">{{ pct(row.criticality) }}</span>
      </button>
    </div>

    <footer class="ledger__foot">
      <span v-if="tab === 'buses'">Probability this bus loses service in the next credible circuit outage.</span>
      <span v-else>Share of system load lost if this circuit opens.</span>
      <span v-if="store.study" class="ledger__key">
        <span class="ledger__tick" aria-hidden="true" /> physics study
      </span>
    </footer>
  </section>
</template>

<style scoped>
.ledger {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ledger__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 11px;
  border-bottom: 1px solid var(--rule);
}

.tabs {
  display: flex;
  gap: 2px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 2px;
}
.tab {
  padding: 4px 10px;
  border: none;
  background: transparent;
  border-radius: 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
}
.tab--on {
  background: var(--ink);
  color: #fff;
}

.rows {
  display: flex;
  flex-direction: column;
  padding: 5px 6px;
}

.row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 78px 46px;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius);
  text-align: left;
  transition: background 0.12s ease;
}
.row:hover {
  background: var(--paper-2);
}
.row--on {
  background: var(--paper-2);
  border-color: var(--rule);
}

.row__id {
  font-size: 11px;
  color: var(--ink-3);
  font-weight: 500;
}

.row__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.row__title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__meta {
  font-size: 10.5px;
  color: var(--ink-3);
}

.row__bar {
  position: relative;
  height: 7px;
  background: var(--rule-soft);
  border-radius: 4px;
  overflow: visible;
}
.row__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.row__truth {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--ink);
  border-radius: 1px;
}

.row__value {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.ledger__foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 16px 12px;
  border-top: 1px solid var(--rule);
  font-size: 11px;
  color: var(--ink-3);
}
.ledger__key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.ledger__tick {
  display: inline-block;
  width: 2px;
  height: 11px;
  background: var(--ink);
}
</style>
