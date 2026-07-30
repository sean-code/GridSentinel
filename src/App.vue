<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed, onMounted } from 'vue';
import { useGridStore } from '@/stores/grid.js';

const store = useGridStore();
const route = useRoute();

onMounted(() => store.initialise());

const links = [
  { to: '/', label: 'Operations', hint: 'Live board' },
  { to: '/cascade', label: 'Cascade lab', hint: 'Trip a circuit' },
  { to: '/model', label: 'Model card', hint: 'How it scores' },
  { to: '/about', label: 'Method', hint: 'How it works' },
];

const statusLabel = computed(() => {
  if (store.modelStatus === 'error') return 'model unavailable';
  if (store.modelStatus !== 'ready') return 'loading model';
  return 'model ready';
});
</script>

<template>
  <header class="masthead">
    <div class="shell masthead__inner">
      <RouterLink to="/" class="brand">
        <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
          <g stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round">
            <path d="M4 24 L11 12 L18 21 L28 6" />
          </g>
          <circle cx="4" cy="24" r="2.6" fill="var(--secure)" />
          <circle cx="11" cy="12" r="2.6" fill="var(--watch)" />
          <circle cx="18" cy="21" r="2.6" fill="var(--watch)" />
          <circle cx="28" cy="6" r="2.6" fill="var(--critical)" />
        </svg>
        <span class="brand__word">GridSentinel</span>
      </RouterLink>

      <nav class="nav" aria-label="Sections">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="nav__link"
          :class="{ 'nav__link--active': route.path === link.to }"
        >
          {{ link.label }}
          <span class="nav__hint">{{ link.hint }}</span>
        </RouterLink>
      </nav>

      <div class="status" :data-state="store.modelStatus">
        <span class="status__dot" aria-hidden="true" />
        <span class="mono status__text">{{ statusLabel }}</span>
      </div>
    </div>
  </header>

  <main class="main">
    <RouterView />
  </main>

  <footer class="footer">
    <div class="shell footer__inner">
      <div>
        <p class="eyebrow">GridSentinel</p>
        <p class="footer__note">
          Every grid on this site is generated from a seed and solved in your browser. No utility data is used, and
          nothing leaves the page.
        </p>
      </div>
      <div class="footer__meta mono">
        <span>TopoRiskNet · edge-gated GraphSAGE</span>
        <span>Vue 3 · static build · no backend</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.masthead {
  border-bottom: 1px solid var(--rule);
  background: rgba(237, 239, 235, 0.86);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 40;
}

.masthead__inner {
  display: flex;
  align-items: center;
  gap: 28px;
  min-height: 62px;
  padding-top: 8px;
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--ink);
  text-decoration: none;
  flex-shrink: 0;
}
.brand__mark {
  width: 26px;
  height: 26px;
  color: var(--ink-2);
}
.brand__word {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.028em;
}

.nav {
  display: flex;
  gap: 4px;
  margin-right: auto;
  flex-wrap: wrap;
}

.nav__link {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 11px;
  border-radius: var(--radius);
  color: var(--ink-2);
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.25;
  border: 1px solid transparent;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.nav__link:hover {
  background: var(--card);
  color: var(--ink);
  border-color: var(--rule);
}
.nav__link--active {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}
.nav__link--active:hover {
  background: var(--ink);
  color: #fff;
}
.nav__hint {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  opacity: 0.62;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.status__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}
.status[data-state='ready'] .status__dot {
  background: var(--secure);
}
.status[data-state='error'] .status__dot {
  background: var(--critical);
}
.status[data-state='loading'] .status__dot {
  background: var(--watch);
  animation: pulse 1.1s ease-in-out infinite;
}
.status__text {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.main {
  flex: 1;
  padding: 30px 0 64px;
}

.footer {
  border-top: 1px solid var(--rule);
  background: var(--paper-2);
  padding: 26px 0 34px;
}
.footer__inner {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  flex-wrap: wrap;
}
.footer__note {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--ink-2);
  max-width: 52ch;
}
.footer__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-3);
  text-align: right;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

@media (max-width: 720px) {
  .nav__hint {
    display: none;
  }
  .footer__meta {
    text-align: left;
  }
}
</style>
