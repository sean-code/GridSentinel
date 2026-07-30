<script setup>
/**
 * Summary strip.
 *
 * Four numbers that answer "how is the system doing right now", chosen so that
 * each one changes for a different reason: size, headroom, how much load is
 * exposed, and how hard the worst circuit is working.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { riskColour, pct, mw } from '@/lib/format.js';

const store = useGridStore();
const summary = computed(() => store.summary);
</script>

<template>
  <div v-if="summary" class="strip">
    <div class="metric">
      <p class="eyebrow">System</p>
      <p class="metric__value stat">{{ summary.buses }}<span class="metric__unit">buses</span></p>
      <p class="metric__note mono">{{ summary.circuits }} circuits · {{ mw(summary.demandMw) }} peak</p>
    </div>

    <div class="metric">
      <p class="eyebrow">Reserve margin</p>
      <p class="metric__value stat">
        {{ summary.reserveMarginPct.toFixed(0) }}<span class="metric__unit">%</span>
      </p>
      <p class="metric__note mono">generation above peak demand</p>
    </div>

    <div class="metric">
      <p class="eyebrow">Load at risk</p>
      <p class="metric__value stat" :style="{ color: riskColour(summary.expectedLossShare * 2.2) }">
        {{ mw(summary.expectedLossMw) }}
      </p>
      <p class="metric__note mono">{{ pct(summary.expectedLossShare, 1) }} of system, probability weighted</p>
    </div>

    <div class="metric">
      <p class="eyebrow">Worst circuit loading</p>
      <p class="metric__value stat" :style="{ color: riskColour(Math.min(summary.worstLoading / 1.05, 1)) }">
        {{ pct(summary.worstLoading) }}
      </p>
      <p class="metric__note mono">{{ summary.atRisk }} buses above 15% risk</p>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.metric {
  background: var(--card);
  padding: 12px 15px 13px;
  min-width: 0;
}

.metric__value {
  margin: 4px 0 2px;
  font-size: 25px;
  line-height: 1.05;
  color: var(--ink);
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.metric__unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
  letter-spacing: 0;
}

.metric__note {
  margin: 0;
  font-size: 10.5px;
  color: var(--ink-3);
  line-height: 1.35;
}

@media (max-width: 860px) {
  .strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
