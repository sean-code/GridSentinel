/**
 * Render the mimic board to a standalone SVG.
 *
 * Uses the same encoding rules as the Vue component so the output is a faithful
 * preview of what ships. Handy for checking the visual design without a
 * browser, and for generating a still for the repository README.
 *
 *   node scripts/render-board.js [seed] [buses] > board.svg
 */

import { generateGrid } from '../shared/grid.js';
import { reinforceGrid } from '../shared/powerflow.js';
import { extractFeatures, buildMessageIndex } from '../shared/features.js';
import { TopoRiskNet } from '../shared/model.js';
import { noGrad, resetTape } from '../shared/autograd.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const seed = Number(process.argv[2] || 20260730);
const buses = Number(process.argv[3] || 62);

const W = 1000;
const H = 660;
const PAD = 34;
const sx = (x) => PAD + x * (W - PAD * 2);
const sy = (y) => PAD + y * (H - PAD * 2);

function mix(c1, c2, t) {
  return [0, 1, 2].map((i) => Math.round(c1[i] + (c2[i] - c1[i]) * t));
}
const STOPS = [
  [0.0, [47, 179, 166]],
  [0.18, [120, 196, 130]],
  [0.4, [242, 178, 62]],
  [0.7, [235, 122, 88]],
  [1.0, [240, 87, 111]],
];
function ramp(v) {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [p0, c0] = STOPS[i];
    const [p1, c1] = STOPS[i + 1];
    if (t >= p0 && t <= p1) {
      const [r, g, b] = mix(c0, c1, p1 === p0 ? 0 : (t - p0) / (p1 - p0));
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(240,87,111)';
}

const grid = generateGrid(seed, { busCount: buses, demandScale: 1.28, weatherSeverity: 0.35 });
const base = reinforceGrid(grid);
const { nodeFeatures, edgeFeatures, n, edgeCount } = extractFeatures(grid, base);
const net = TopoRiskNet.fromJSON(JSON.parse(readFileSync(resolve(HERE, '../public/model/toporisknet.json'), 'utf8')));
let risk;
noGrad(() => {
  const out = net.forward({
    n,
    edgeCount,
    nodeFeatures,
    edgeFeatures,
    index: buildMessageIndex(grid),
    fromIndex: Int32Array.from(grid.lines, (l) => l.from),
    toIndex: Int32Array.from(grid.lines, (l) => l.to),
  });
  risk = Array.from(out.nodeRisk.data);
  resetTape();
});

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
parts.push(`<defs>
<radialGradient id="storm" cx="50%" cy="50%" r="50%">
<stop offset="0%" stop-color="#4b6f8c" stop-opacity="0.30"/>
<stop offset="55%" stop-color="#3d5f7d" stop-opacity="0.13"/>
<stop offset="100%" stop-color="#3d5f7d" stop-opacity="0"/>
</radialGradient>
<filter id="soften" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
<pattern id="gf" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a242d" stroke-width="0.6"/></pattern>
<radialGradient id="bg" cx="30%" cy="0%" r="120%"><stop offset="0%" stop-color="#131b22"/><stop offset="62%" stop-color="#0b1014"/></radialGradient>
</defs>`);
parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
parts.push(`<rect width="${W}" height="${H}" fill="url(#gf)" opacity="0.55"/>`);

for (const c of grid.weatherCells || []) {
  if (c.intensity <= 0.22) continue;
  parts.push(
    `<circle cx="${sx(c.x).toFixed(1)}" cy="${sy(c.y).toFixed(1)}" r="${(c.radius * (W - PAD * 2) * 0.82).toFixed(1)}" fill="url(#storm)" opacity="${c.intensity.toFixed(2)}"/>`
  );
}

// halos
parts.push('<g filter="url(#soften)">');
grid.buses.forEach((bus, i) => {
  if (risk[i] <= 0.04) return;
  const magnitude = bus.type === 'generation' ? bus.pmax / 180 : bus.demand / 90;
  const size = 5.4 + Math.min(Math.sqrt(Math.max(magnitude, 0)) * 4.6, 6.4);
  parts.push(
    `<circle cx="${sx(bus.x).toFixed(1)}" cy="${sy(bus.y).toFixed(1)}" r="${(size + 5 + risk[i] * 26).toFixed(1)}" fill="${ramp(risk[i])}" opacity="${Math.min(0.1 + risk[i] * 0.5, 0.55).toFixed(2)}"/>`
  );
});
parts.push('</g>');

// circuits
grid.lines.forEach((line, k) => {
  const a = grid.buses[line.from];
  const b = grid.buses[line.to];
  const loading = base.loading[k];
  const width = 1.15 + Math.min(Math.sqrt(line.capacity) / 7.5, 2.9);
  parts.push(
    `<line x1="${sx(a.x).toFixed(1)}" y1="${sy(a.y).toFixed(1)}" x2="${sx(b.x).toFixed(1)}" y2="${sy(b.y).toFixed(1)}" stroke="${ramp(Math.min(loading / 1.05, 1))}" stroke-width="${width.toFixed(2)}" opacity="0.86" stroke-linecap="round"/>`
  );
  if (Math.abs(base.flows[k]) > 1) {
    parts.push(
      `<line x1="${sx(a.x).toFixed(1)}" y1="${sy(a.y).toFixed(1)}" x2="${sx(b.x).toFixed(1)}" y2="${sy(b.y).toFixed(1)}" stroke="${ramp(Math.min(loading / 1.05, 1))}" stroke-width="${Math.max(width * 0.5, 0.9).toFixed(2)}" stroke-dasharray="1.5 13" stroke-linecap="round" opacity="0.95"/>`
    );
  }
});

// buses
grid.buses.forEach((bus, i) => {
  const x = sx(bus.x);
  const y = sy(bus.y);
  const magnitude = bus.type === 'generation' ? bus.pmax / 180 : bus.demand / 90;
  const s = 5.4 + Math.min(Math.sqrt(Math.max(magnitude, 0)) * 4.6, 6.4);
  const fill = ramp(risk[i]);
  if (bus.type === 'generation') {
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(1)}" fill="${fill}" stroke="#0b1014" stroke-width="1.4"/>`);
    if (s > 6) {
      parts.push(
        `<path d="M ${(x - s * 0.5).toFixed(1)} ${y.toFixed(1)} q ${(s * 0.25).toFixed(1)} ${(-s * 0.5).toFixed(1)} ${(s * 0.5).toFixed(1)} 0 q ${(s * 0.25).toFixed(1)} ${(s * 0.5).toFixed(1)} ${(s * 0.5).toFixed(1)} 0" fill="none" stroke="#0b1014" stroke-width="1.15" opacity="0.75"/>`
      );
    }
  } else if (bus.type === 'substation') {
    parts.push(
      `<path d="M ${x.toFixed(1)} ${(y - s).toFixed(1)} L ${(x + s).toFixed(1)} ${y.toFixed(1)} L ${x.toFixed(1)} ${(y + s).toFixed(1)} L ${(x - s).toFixed(1)} ${y.toFixed(1)} Z" fill="${fill}" stroke="#0b1014" stroke-width="1.4"/>`
    );
  } else {
    parts.push(
      `<path d="M ${(x - s).toFixed(1)} ${(y - s * 0.78).toFixed(1)} L ${(x + s).toFixed(1)} ${(y - s * 0.78).toFixed(1)} L ${x.toFixed(1)} ${(y + s * 1.05).toFixed(1)} Z" fill="${fill}" stroke="#0b1014" stroke-width="1.4"/>`
    );
  }
});

parts.push('</svg>');
process.stdout.write(parts.join('\n'));
