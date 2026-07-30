<script setup>
/**
 * Scenario controls.
 *
 * Operators do not think in "seed 47132". They think in situations: a summer
 * peak, a storm front, an overnight minimum. The named scenarios are the
 * primary control; the seed is exposed underneath for anyone who wants to
 * reproduce a specific grid, which is most of the point of a seeded simulator.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { SCENARIOS } from '@/stores/grid.js';

const store = useGridStore();

const sizes = [
  { label: 'Small', value: 38 },
  { label: 'Medium', value: 62 },
  { label: 'Large', value: 88 },
  { label: 'Very large', value: 120 },
];

const seedText = computed(() => String(store.seed));

function onSeedInput(event) {
  const value = Number(event.target.value.replace(/\D/g, '').slice(0, 10));
  if (Number.isFinite(value) && value > 0) store.buildGrid({ seed: value });
}
</script>

<template>
  <div class="controls">
    <div class="controls__group controls__group--scenarios">
      <p class="eyebrow">Operating scenario</p>
      <div class="chips">
        <button
          v-for="scenario in SCENARIOS"
          :key="scenario.id"
          class="chip"
          :class="{ 'chip--on': store.scenarioId === scenario.id }"
          :aria-pressed="store.scenarioId === scenario.id"
          :title="scenario.detail"
          @click="store.setScenario(scenario.id)"
        >
          {{ scenario.name }}
        </button>
      </div>
      <p class="controls__detail">{{ store.scenario.detail }}</p>
    </div>

    <div class="controls__group">
      <p class="eyebrow">System size</p>
      <div class="chips">
        <button
          v-for="size in sizes"
          :key="size.value"
          class="chip"
          :class="{ 'chip--on': store.busCount === size.value }"
          :aria-pressed="store.busCount === size.value"
          @click="store.setBusCount(size.value)"
        >
          {{ size.label }}
          <span class="chip__sub mono">{{ size.value }}</span>
        </button>
      </div>
      <p class="controls__detail">Larger systems take the physics study longer. The network does not slow down.</p>
    </div>

    <div class="controls__group controls__group--seed">
      <p class="eyebrow">Grid seed</p>
      <div class="seed-row">
        <input
          class="seed mono"
          type="text"
          inputmode="numeric"
          :value="seedText"
          aria-label="Grid seed"
          @change="onSeedInput"
        />
        <button class="btn btn--primary" @click="store.newSeed()">New grid</button>
      </div>
      <p class="controls__detail">Same seed, same grid, every time and on every machine.</p>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 0.9fr);
  gap: 22px;
  padding: 16px 18px;
}

.controls__group {
  min-width: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
  border-radius: var(--radius);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-2);
  transition: all 0.14s ease;
}
.chip:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.chip--on {
  background: var(--indigo);
  border-color: var(--indigo);
  color: #fff;
}
.chip--on:hover {
  color: #fff;
}
.chip__sub {
  font-size: 10px;
  opacity: 0.65;
}

.controls__detail {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.4;
  max-width: 40ch;
}

.seed-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.seed {
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-2);
  font-size: 12.5px;
  color: var(--ink);
}

@media (max-width: 940px) {
  .controls {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
