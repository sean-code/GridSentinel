/**
 * Presentation helpers.
 *
 * The risk colour scale lives here so that every view — board, ledger,
 * inspector, model card — encodes risk identically. If teal means secure in one
 * place it means secure everywhere.
 */

/** Risk bands, in the vocabulary an operator would use. */
export const BANDS = [
  { id: 'secure', label: 'Secure', min: 0, max: 0.05 },
  { id: 'monitor', label: 'Monitor', min: 0.05, max: 0.15 },
  { id: 'exposed', label: 'Exposed', min: 0.15, max: 0.35 },
  { id: 'critical', label: 'Critical', min: 0.35, max: 1.01 },
];

export function bandOf(risk) {
  return BANDS.find((b) => risk >= b.min && risk < b.max) || BANDS[BANDS.length - 1];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}

const LIT_STOPS = [
  [0.0, [47, 179, 166]], // secure
  [0.18, [120, 196, 130]],
  [0.4, [242, 178, 62]], // watch
  [0.7, [235, 122, 88]],
  [1.0, [240, 87, 111]], // critical
];

const INK_STOPS = [
  [0.0, [18, 120, 111]],
  [0.18, [86, 140, 82]],
  [0.4, [184, 121, 31]],
  [0.7, [172, 84, 62]],
  [1.0, [175, 47, 69]],
];

function rampColour(value, stops) {
  const t = Math.max(0, Math.min(1, value));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const local = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      const [r, g, b] = mix(c0, c1, local);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  const [r, g, b] = stops[stops.length - 1][1];
  return `rgb(${r}, ${g}, ${b})`;
}

/** Risk colour for use on the dark instrument panel. */
export function riskColourLit(value) {
  return rampColour(value, LIT_STOPS);
}

/** Risk colour for use on paper. */
export function riskColour(value) {
  return rampColour(value, INK_STOPS);
}

/** Circuit loading colour — same semantics, keyed to thermal limit. */
export function loadingColour(loading) {
  return riskColourLit(Math.min(loading / 1.05, 1));
}

// --- number formatting ----------------------------------------------------

export function pct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function mw(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} MW`;
}

export function ms(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 10) return `${value.toFixed(0)} ms`;
  return `${value.toFixed(2)} ms`;
}

export function num(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function busLabel(id) {
  return `B${String(id).padStart(2, '0')}`;
}

export function lineLabel(id) {
  return `L${String(id).padStart(3, '0')}`;
}

export const BUS_TYPE_LABEL = {
  generation: 'Generation',
  substation: 'Substation',
  load: 'Load',
};
