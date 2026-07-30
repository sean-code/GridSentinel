<script setup>
/**
 * Surrogate versus simulator.
 *
 * This is the argument the whole project exists to make, so it is made
 * literally rather than claimed in prose: the network's answer is already on
 * screen, and pressing the button makes the physics study grind through every
 * contingency in real time next to it. When the study finishes, the two answers
 * are scored against each other.
 *
 * The study is the real thing, not a stand-in — same code that produced the
 * training labels, running at full fidelity in the tab.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';
import { ms, pct, num } from '@/lib/format.js';

const store = useGridStore();

const progressShare = computed(() => {
  if (!store.studyProgress) return 0;
  return store.studyProgress.done / Math.max(store.studyProgress.total, 1);
});

const comparison = computed(() => store.comparison);
</script>

<template>
  <section class="race card">
    <header class="race__head">
      <div>
        <p class="eyebrow">Surrogate versus simulator</p>
        <h3>Same question, two ways of answering it</h3>
      </div>
      <button
        v-if="!store.studyRunning"
        class="btn btn--primary"
        :disabled="!store.ready"
        @click="store.runStudy()"
      >
        {{ store.study ? 'Run study again' : 'Run the physics study' }}
      </button>
      <button v-else class="btn" @click="store.cancelStudy()">Stop</button>
    </header>

    <div class="lanes">
      <!-- Lane 1: the network -->
      <div class="lane lane--net">
        <div class="lane__label">
          <span class="lane__name">TopoRiskNet</span>
          <span class="lane__sub mono">graph neural network</span>
        </div>
        <div class="lane__track">
          <div class="lane__fill lane__fill--done" />
        </div>
        <div class="lane__time mono">{{ ms(store.predictMs) }}</div>
      </div>

      <!-- Lane 2: the physics -->
      <div class="lane">
        <div class="lane__label">
          <span class="lane__name">N-1 contingency study</span>
          <span class="lane__sub mono">
            {{ store.grid ? `${store.grid.lines.length} outages, cascade resolved` : 'physics' }}
          </span>
        </div>
        <div class="lane__track">
          <div
            class="lane__fill"
            :class="{ 'lane__fill--done': Boolean(store.study) && !store.studyRunning }"
            :style="{ width: `${(store.study && !store.studyRunning ? 1 : progressShare) * 100}%` }"
          />
        </div>
        <div class="lane__time mono">
          <template v-if="store.studyRunning">{{ ms(store.studyProgress?.elapsed) }}</template>
          <template v-else-if="store.study">{{ ms(store.study.computeMs) }}</template>
          <template v-else>not run</template>
        </div>
      </div>
    </div>

    <p v-if="store.studyRunning" class="race__status mono">
      contingency {{ store.studyProgress?.done }} of {{ store.studyProgress?.total }}
    </p>

    <div v-else-if="comparison" class="verdict">
      <div class="verdict__grid">
        <div class="verdict__cell">
          <p class="eyebrow">Speedup</p>
          <p class="verdict__value stat">{{ comparison.speedup.toFixed(0) }}&times;</p>
          <p class="verdict__note">on this grid, this run</p>
        </div>
        <div class="verdict__cell">
          <p class="eyebrow">Bus rank agreement</p>
          <p class="verdict__value stat">{{ num(comparison.busRankCorrelation, 2) }}</p>
          <p class="verdict__note">Spearman against the study</p>
        </div>
        <div class="verdict__cell">
          <p class="eyebrow">Top six buses</p>
          <p class="verdict__value stat">{{ comparison.topBusOverlap }}/{{ comparison.topBusOverlapOf }}</p>
          <p class="verdict__note">matched the study's top six</p>
        </div>
        <div class="verdict__cell">
          <p class="eyebrow">Mean error</p>
          <p class="verdict__value stat">{{ pct(comparison.busMae, 1) }}</p>
          <p class="verdict__note">absolute, per bus</p>
        </div>
      </div>
      <p class="verdict__prose">
        The study resolved {{ comparison.contingencies }} circuit outages and every cascade that followed. The network
        answered from the intact grid alone, without simulating anything. Black ticks in the worklist now mark where the
        study landed.
      </p>
    </div>

    <p v-else class="race__hint">
      The network has already scored this grid. Run the study to see what it would have cost to get the same answer
      honestly, and how close the network got.
    </p>
  </section>
</template>

<style scoped>
.race {
  padding: 15px 18px 17px;
}

.race__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}

.lanes {
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.lane {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 74px;
  align-items: center;
  gap: 13px;
}

.lane__label {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.lane__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.lane__sub {
  font-size: 10px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lane__track {
  position: relative;
  height: 9px;
  background: var(--rule-soft);
  border-radius: 5px;
  overflow: hidden;
}
.lane__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: var(--indigo);
  border-radius: 5px;
  transition: width 0.14s linear;
}
.lane--net .lane__fill {
  width: 100%;
}
.lane__fill--done {
  background: var(--secure);
}

.lane__time {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  color: var(--ink);
}

.race__status {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--ink-3);
  letter-spacing: 0.05em;
}

.race__hint {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--ink-2);
  max-width: 70ch;
}

.verdict {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
}

.verdict__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.verdict__cell {
  min-width: 0;
}
.verdict__value {
  margin: 3px 0 1px;
  font-size: 25px;
  line-height: 1;
  color: var(--ink);
}
.verdict__note {
  margin: 0;
  font-size: 10.5px;
  color: var(--ink-3);
}

.verdict__prose {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--ink-2);
  max-width: 78ch;
}

@media (max-width: 780px) {
  .lane {
    grid-template-columns: 1fr 64px;
    grid-template-areas: 'label time' 'track track';
    gap: 6px 10px;
  }
  .lane__label {
    grid-area: label;
  }
  .lane__track {
    grid-area: track;
  }
  .lane__time {
    grid-area: time;
  }
  .verdict__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
