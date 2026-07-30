<script setup>
/**
 * The mimic board.
 *
 * Named after the physical mimic panels that lined control rooms before
 * screens: a schematic of the network where every element's state is shown in
 * place. This is the one element in the product allowed to be visually loud,
 * because it is the thing an operator actually reads.
 *
 * Encoding, all of it load-bearing:
 *   glyph shape   bus role — generator, substation, load
 *   glyph size    peak demand or installed capacity
 *   halo          predicted outage risk (radius and colour)
 *   stroke width  circuit thermal rating
 *   stroke colour circuit loading against its rating
 *   dash drift    direction and magnitude of real power flow
 *   dimmed + X    bus without service in the current cascade frame
 */
import { computed } from 'vue';
import { riskColourLit, loadingColour, busLabel } from '@/lib/format.js';

const props = defineProps({
  grid: { type: Object, required: true },
  state: { type: Object, required: true },
  risk: { type: Object, default: null },
  criticality: { type: Object, default: null },
  deEnergized: { type: Object, default: null },
  trippedLines: { type: Array, default: () => [] },
  freshlyTripped: { type: Array, default: () => [] },
  selectedBus: { type: Number, default: null },
  selectedLine: { type: Number, default: null },
  showHalos: { type: Boolean, default: true },
  showFlow: { type: Boolean, default: true },
  showWeather: { type: Boolean, default: true },
  showLabels: { type: Boolean, default: false },
  interactive: { type: Boolean, default: true },
});

const emit = defineEmits(['select-bus', 'select-line', 'hover-line']);

const W = 1000;
const H = 660;
const PAD = 34;

const sx = (x) => PAD + x * (W - PAD * 2);
const sy = (y) => PAD + y * (H - PAD * 2);

const trippedSet = computed(() => new Set(props.trippedLines));
const freshSet = computed(() => new Set(props.freshlyTripped));

const nodes = computed(() =>
  props.grid.buses.map((bus, i) => {
    const risk = props.risk ? props.risk[i] : 0;
    const dark = props.deEnergized ? props.deEnergized[i] === 1 : false;
    // Glyph size tracks the quantity that matters for that role.
    const magnitude = bus.type === 'generation' ? bus.pmax / 180 : bus.demand / 90;
    const size = 5.4 + Math.min(Math.sqrt(Math.max(magnitude, 0)) * 4.6, 6.4);
    return {
      id: i,
      bus,
      x: sx(bus.x),
      y: sy(bus.y),
      risk,
      dark,
      size,
      colour: riskColourLit(risk),
      haloRadius: size + 5 + risk * 26,
    };
  })
);

const edges = computed(() =>
  props.grid.lines.map((line, k) => {
    const a = props.grid.buses[line.from];
    const b = props.grid.buses[line.to];
    const loading = props.state.loading[k];
    const flow = props.state.flows[k];
    const tripped = trippedSet.value.has(k);
    const fresh = freshSet.value.has(k);
    return {
      id: k,
      line,
      x1: sx(a.x),
      y1: sy(a.y),
      x2: sx(b.x),
      y2: sy(b.y),
      loading,
      flow,
      tripped,
      fresh,
      width: 1.15 + Math.min(Math.sqrt(line.capacity) / 7.5, 2.9),
      colour: tripped ? '#3a4a56' : loadingColour(loading),
      // Dash drift period: heavily loaded circuits visibly move faster.
      period: Math.max(0.9, 5.2 - Math.min(loading, 1.4) * 3.1),
      // Flow sign decides which way the dashes travel.
      reverse: flow < 0,
      midX: (sx(a.x) + sx(b.x)) / 2,
      midY: (sy(a.y) + sy(b.y)) / 2,
    };
  })
);

const weatherCells = computed(() => {
  if (!props.showWeather || !props.grid.weatherCells) return [];
  return props.grid.weatherCells
    .filter((c) => c.intensity > 0.22)
    .map((c, i) => ({
      id: i,
      cx: sx(c.x),
      cy: sy(c.y),
      r: c.radius * (W - PAD * 2) * 0.82,
      intensity: c.intensity,
    }));
});

function glyphPath(node) {
  const s = node.size;
  if (node.bus.type === 'load') {
    // Downward triangle — the schematic symbol for a load tap.
    return `M ${node.x - s} ${node.y - s * 0.78} L ${node.x + s} ${node.y - s * 0.78} L ${node.x} ${node.y + s * 1.05} Z`;
  }
  if (node.bus.type === 'substation') {
    // Diamond — a switching station.
    return `M ${node.x} ${node.y - s} L ${node.x + s} ${node.y} L ${node.x} ${node.y + s} L ${node.x - s} ${node.y} Z`;
  }
  return null; // generators are drawn as circles
}

function onBus(id) {
  if (props.interactive) emit('select-bus', id);
}
function onLine(id) {
  if (props.interactive) emit('select-line', id);
}
</script>

<template>
  <svg
    class="board"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="`Transmission network with ${grid.busCount} buses and ${grid.lines.length} circuits`"
  >
    <defs>
      <radialGradient id="storm" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#4b6f8c" stop-opacity="0.30" />
        <stop offset="55%" stop-color="#3d5f7d" stop-opacity="0.13" />
        <stop offset="100%" stop-color="#3d5f7d" stop-opacity="0" />
      </radialGradient>
      <filter id="soften" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
      <pattern id="grid-fine" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a242d" stroke-width="0.6" />
      </pattern>
    </defs>

    <rect :width="W" :height="H" fill="url(#grid-fine)" opacity="0.55" />

    <!-- Weather cells sit underneath everything: context, not content. -->
    <g class="weather">
      <circle
        v-for="cell in weatherCells"
        :key="`w${cell.id}`"
        :cx="cell.cx"
        :cy="cell.cy"
        :r="cell.r"
        fill="url(#storm)"
        :opacity="cell.intensity"
      />
    </g>

    <!-- Risk halos, blurred, beneath the schematic. -->
    <g v-if="showHalos && risk" class="halos" filter="url(#soften)">
      <circle
        v-for="node in nodes"
        v-show="node.risk > 0.04"
        :key="`h${node.id}`"
        :cx="node.x"
        :cy="node.y"
        :r="node.haloRadius"
        :fill="node.colour"
        :opacity="Math.min(0.1 + node.risk * 0.5, 0.55)"
      />
    </g>

    <!-- Circuits -->
    <g class="circuits">
      <g v-for="edge in edges" :key="`e${edge.id}`">
        <line
          v-if="interactive"
          class="circuit-hit"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          @click="onLine(edge.id)"
          @mouseenter="emit('hover-line', edge.id)"
          @mouseleave="emit('hover-line', null)"
        />
        <line
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          :stroke="edge.colour"
          :stroke-width="edge.width"
          :stroke-dasharray="edge.tripped ? '5 6' : undefined"
          :opacity="edge.tripped ? 0.4 : selectedLine === edge.id ? 1 : 0.86"
          stroke-linecap="round"
          class="circuit"
          :class="{ 'circuit--selected': selectedLine === edge.id, 'circuit--fresh': edge.fresh }"
        />
        <!-- Power flow: dashes drift the way the power does. -->
        <line
          v-if="showFlow && !edge.tripped && Math.abs(edge.flow) > 1"
          :x1="edge.reverse ? edge.x2 : edge.x1"
          :y1="edge.reverse ? edge.y2 : edge.y1"
          :x2="edge.reverse ? edge.x1 : edge.x2"
          :y2="edge.reverse ? edge.y1 : edge.y2"
          class="flow"
          :stroke="edge.colour"
          :stroke-width="Math.max(edge.width * 0.5, 0.9)"
          :style="{ animationDuration: `${edge.period}s` }"
        />
        <g v-if="edge.tripped" class="trip-mark">
          <line
            :x1="edge.midX - 5"
            :y1="edge.midY - 5"
            :x2="edge.midX + 5"
            :y2="edge.midY + 5"
            stroke="#f0576f"
            stroke-width="1.9"
            stroke-linecap="round"
          />
          <line
            :x1="edge.midX + 5"
            :y1="edge.midY - 5"
            :x2="edge.midX - 5"
            :y2="edge.midY + 5"
            stroke="#f0576f"
            stroke-width="1.9"
            stroke-linecap="round"
          />
        </g>
      </g>
    </g>

    <!-- Buses -->
    <g class="buses">
      <g
        v-for="node in nodes"
        :key="`n${node.id}`"
        :class="{ 'bus--dark': node.dark, 'bus--selected': selectedBus === node.id, 'bus--interactive': interactive }"
        class="bus"
        :tabindex="interactive ? 0 : undefined"
        :role="interactive ? 'button' : undefined"
        :aria-label="`${busLabel(node.id)}, ${node.bus.type}, risk ${(node.risk * 100).toFixed(0)} percent`"
        @click="onBus(node.id)"
        @keydown.enter.prevent="onBus(node.id)"
        @keydown.space.prevent="onBus(node.id)"
      >
        <circle
          v-if="selectedBus === node.id"
          :cx="node.x"
          :cy="node.y"
          :r="node.size + 9"
          fill="none"
          stroke="#dbe4ea"
          stroke-width="1.2"
          stroke-dasharray="3 3"
          class="select-ring"
        />
        <circle
          v-if="node.bus.type === 'generation'"
          :cx="node.x"
          :cy="node.y"
          :r="node.size"
          :fill="node.dark ? '#212c35' : node.colour"
          :stroke="node.dark ? '#3a4a56' : '#0b1014'"
          stroke-width="1.4"
        />
        <path
          v-else
          :d="glyphPath(node)"
          :fill="node.dark ? '#212c35' : node.colour"
          :stroke="node.dark ? '#3a4a56' : '#0b1014'"
          stroke-width="1.4"
        />
        <!-- Generator sine, the standard one-line symbol. -->
        <path
          v-if="node.bus.type === 'generation' && node.size > 6"
          :d="`M ${node.x - node.size * 0.5} ${node.y} q ${node.size * 0.25} ${-node.size * 0.5} ${node.size * 0.5} 0 q ${node.size * 0.25} ${node.size * 0.5} ${node.size * 0.5} 0`"
          fill="none"
          stroke="#0b1014"
          stroke-width="1.15"
          opacity="0.75"
        />
        <g v-if="node.dark" class="dark-mark">
          <line
            :x1="node.x - node.size * 0.62"
            :y1="node.y - node.size * 0.62"
            :x2="node.x + node.size * 0.62"
            :y2="node.y + node.size * 0.62"
            stroke="#7e8f9c"
            stroke-width="1.3"
          />
          <line
            :x1="node.x + node.size * 0.62"
            :y1="node.y - node.size * 0.62"
            :x2="node.x - node.size * 0.62"
            :y2="node.y + node.size * 0.62"
            stroke="#7e8f9c"
            stroke-width="1.3"
          />
        </g>
        <text
          v-if="showLabels || selectedBus === node.id"
          :x="node.x"
          :y="node.y - node.size - 7"
          class="bus-label"
        >
          {{ busLabel(node.id) }}
        </text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.board {
  display: block;
  width: 100%;
  height: auto;
  background: radial-gradient(120% 90% at 30% 0%, #131b22 0%, #0b1014 62%);
}

.circuit {
  transition: opacity 0.18s ease, stroke 0.3s ease;
}
.circuit--selected {
  filter: drop-shadow(0 0 4px rgba(219, 228, 234, 0.55));
}
.circuit--fresh {
  animation: trip-flash 0.85s ease-out;
}

.circuit-hit {
  stroke: transparent;
  stroke-width: 13;
  cursor: pointer;
}

.flow {
  stroke-dasharray: 1.5 13;
  stroke-linecap: round;
  opacity: 0.95;
  animation: drift linear infinite;
  pointer-events: none;
}

.bus--interactive {
  cursor: pointer;
}
.bus--interactive:hover circle,
.bus--interactive:hover path {
  filter: brightness(1.18);
}
.bus--dark {
  opacity: 0.62;
}

.select-ring {
  animation: spin 9s linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}

.bus-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  fill: #9db0bd;
  text-anchor: middle;
  paint-order: stroke;
  stroke: #0b1014;
  stroke-width: 3px;
  pointer-events: none;
}

.trip-mark,
.dark-mark {
  pointer-events: none;
}

@keyframes drift {
  to {
    stroke-dashoffset: -29;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes trip-flash {
  0% {
    stroke: #ffffff;
    stroke-width: 6;
  }
  100% {
    stroke-width: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow,
  .select-ring,
  .circuit--fresh {
    animation: none;
  }
  .flow {
    opacity: 0.5;
  }
}
</style>
