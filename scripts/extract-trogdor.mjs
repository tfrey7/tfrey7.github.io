// Reads public/trogdor.svg, splits paths into "S body" vs "template" based on
// S_RECT (in post-transform viewBox space), bakes the potrace group transform
// into each path's coordinates so consumers can render them with no extra
// transform, and writes src/scripts/eggs/trogdor-art.ts.
//
// Output coords are in the trace's viewBox space (0..708 × 0..600), absolute
// commands only (M/L/C/Z), so each d-string is ready to feed to `new Path2D`.

import { readFileSync, writeFileSync } from 'node:fs';

const SVG_PATH = 'public/trogdor.svg';
const OUT_PATH = 'src/scripts/eggs/trogdor-art.ts';

// Keep this in sync with scripts/inspect-trogdor.mjs. Tuned visually.
const S_RECT = { x: 175, y: 130, w: 185, h: 280 };

// Anchors in viewBox space, eyeballed from the rendered template. Adjust if
// the visual gap between head/leg and the missing S looks off.
const ANCHOR_TOP = { x: 250, y: 190 };
const ANCHOR_BOTTOM = { x: 230, y: 390 };

const svg = readFileSync(SVG_PATH, 'utf8');

const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
const viewBox = viewBoxMatch ? viewBoxMatch[1].trim() : '0 0 708 600';
const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+/).map(Number);

const tMatch = svg.match(/<g\b[^>]*transform="([^"]+)"/);
const tStr = tMatch ? tMatch[1] : '';
const tr = tStr.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
const sc = tStr.match(/scale\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
const TX = tr ? parseFloat(tr[1]) : 0;
const TY = tr ? parseFloat(tr[2]) : 0;
const SX = sc ? parseFloat(sc[1]) : 1;
const SY = sc ? parseFloat(sc[2]) : 1;

const proj = (x, y) => ({ x: x * SX + TX, y: y * SY + TY });
const fmt = (n) => {
  // 2 decimal places, trim trailing zeros.
  let s = n.toFixed(2);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};

const pathRe = /<path\s+d="([^"]+)"\s*\/>/g;
const rawPaths = [];
let m;
while ((m = pathRe.exec(svg))) rawPaths.push(m[1]);

// Parse a potrace-style d string into absolute segments, projected to vb
// coords. Returns { d: string, bbox: {x,y,w,h} } in vb space.
function bake(d) {
  const cmds = d.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  let out = '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const emitPoint = (x, y) => {
    const p = proj(x, y);
    include(p.x, p.y);
    return p;
  };

  for (const c of cmds) {
    const cmd = c[0];
    const args = (c.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const lower = cmd.toLowerCase();
    const abs = cmd === cmd.toUpperCase();
    if (lower === 'm') {
      for (let i = 0; i + 1 < args.length; i += 2) {
        cx = abs ? args[i]     : cx + args[i];
        cy = abs ? args[i + 1] : cy + args[i + 1];
        if (i === 0) {
          startX = cx;
          startY = cy;
          const p = emitPoint(cx, cy);
          out += `M${fmt(p.x)} ${fmt(p.y)}`;
        } else {
          const p = emitPoint(cx, cy);
          out += `L${fmt(p.x)} ${fmt(p.y)}`;
        }
      }
    } else if (lower === 'l') {
      for (let i = 0; i + 1 < args.length; i += 2) {
        cx = abs ? args[i]     : cx + args[i];
        cy = abs ? args[i + 1] : cy + args[i + 1];
        const p = emitPoint(cx, cy);
        out += `L${fmt(p.x)} ${fmt(p.y)}`;
      }
    } else if (lower === 'h') {
      for (let i = 0; i < args.length; i++) {
        cx = abs ? args[i] : cx + args[i];
        const p = emitPoint(cx, cy);
        out += `L${fmt(p.x)} ${fmt(p.y)}`;
      }
    } else if (lower === 'v') {
      for (let i = 0; i < args.length; i++) {
        cy = abs ? args[i] : cy + args[i];
        const p = emitPoint(cx, cy);
        out += `L${fmt(p.x)} ${fmt(p.y)}`;
      }
    } else if (lower === 'c') {
      for (let i = 0; i + 5 < args.length; i += 6) {
        const sx = cx, sy = cy;
        const x1 = abs ? args[i]     : sx + args[i];
        const y1 = abs ? args[i + 1] : sy + args[i + 1];
        const x2 = abs ? args[i + 2] : sx + args[i + 2];
        const y2 = abs ? args[i + 3] : sy + args[i + 3];
        const ex = abs ? args[i + 4] : sx + args[i + 4];
        const ey = abs ? args[i + 5] : sy + args[i + 5];
        const p1 = emitPoint(x1, y1);
        const p2 = emitPoint(x2, y2);
        const pe = emitPoint(ex, ey);
        out += `C${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(pe.x)} ${fmt(pe.y)}`;
        cx = ex;
        cy = ey;
      }
    } else if (lower === 'z') {
      out += 'Z';
      cx = startX;
      cy = startY;
    }
    // potrace doesn't emit Q/T/S/A — skip silently.
  }
  if (!Number.isFinite(minX)) return null;
  return { d: out, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

const baked = rawPaths.map(bake).filter(Boolean);

const inside = [];
const outside = [];
for (const p of baked) {
  const cx = p.bbox.x + p.bbox.w / 2;
  const cy = p.bbox.y + p.bbox.h / 2;
  const isIn = cx >= S_RECT.x && cx <= S_RECT.x + S_RECT.w &&
               cy >= S_RECT.y && cy <= S_RECT.y + S_RECT.h;
  (isIn ? inside : outside).push(p.d);
}

const header = `// Auto-generated by scripts/extract-trogdor.mjs from public/trogdor.svg.
// Do not edit by hand — re-run the script to regenerate.
//
// All path d-strings are in the trace's viewBox space:
//   x ∈ [0, ${vbW}],  y ∈ [0, ${vbH}]
// Use absolute commands only (M/L/C/Z) so each string is safe for new Path2D().

export const TROGDOR_VIEW_W = ${vbW};
export const TROGDOR_VIEW_H = ${vbH};

// Where the missing S attaches at top (back of head/neck) and bottom (top of
// leg). Tuned visually against the template render.
export const TROGDOR_ANCHOR_TOP = { x: ${ANCHOR_TOP.x}, y: ${ANCHOR_TOP.y} };
export const TROGDOR_ANCHOR_BOTTOM = { x: ${ANCHOR_BOTTOM.x}, y: ${ANCHOR_BOTTOM.y} };

// "Everything except the S body" — drawn as the broken sketch the user has
// to complete.
export const TROGDOR_TEMPLATE_PATHS: string[] = ${JSON.stringify(outside, null, 2)};

// The S body itself — used to ink in over the user's stroke on success.
export const TROGDOR_S_PATHS: string[] = ${JSON.stringify(inside, null, 2)};
`;

writeFileSync(OUT_PATH, header);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  template paths: ${outside.length}`);
console.log(`  S body paths:   ${inside.length}`);
