// Snake-drawing launcher for the Snake game. The user enters this mode by
// clicking the pencil on the interview clipboard; an overlay appears with
// most of "Trogdor the Burninator" already sketched out — head, wings,
// beefy arm, leg, fire breath, label — leaving only the S-shaped body for
// the user to finish. Two anchor dots mark where the body's missing ends
// attach to the head and the leg. When the user draws an S-like stroke
// bridging the two anchors, the Snake game opens.
//
// Self-contained. Other code triggers it by importing `startSnakeDrawMode`
// or by calling `window.__drawSnake()` (set up by initDrawSnake).
//
// Holds the global interaction lock under id 'snake-draw' while active, and
// releases it just before handing off to openSnake() so the game can take
// its own 'snake' lock.

import { startPencilScratch } from '../lib/audio';
import { end, tryStart } from '../lib/interaction-lock';
import { openSnake } from './snake';
import {
  TROGDOR_TEMPLATE_PATHS,
  TROGDOR_S_PATHS,
  TROGDOR_ANCHOR_TOP,
  TROGDOR_ANCHOR_BOTTOM,
  TROGDOR_VIEW_W,
  TROGDOR_VIEW_H,
} from './trogdor-art';

const LOCK_ID = 'snake-draw';

// Trogdor template — the traced potrace doodle minus its S-body, rendered
// into a rectangle centered in the surface. All coordinates inside the
// template functions below live in this design space (the trace's viewBox);
// computeTemplateTransform fits it to the actual canvas size.
const TEMPLATE_W = TROGDOR_VIEW_W;
const TEMPLATE_H = TROGDOR_VIEW_H;

// Where the S-body attaches to the rest of Trogdor. The user's stroke must
// start near one of these and end near the other.
const ANCHOR_TOP = TROGDOR_ANCHOR_TOP;       // back-of-neck (top of S)
const ANCHOR_BOTTOM = TROGDOR_ANCHOR_BOTTOM; // top of leg (bottom of S)
const ANCHOR_TOLERANCE = 110;                // design-space px around each anchor

// Path2D instances for the template + S body. Built lazily once so we don't
// re-parse the d-strings on every redraw.
let templatePath2Ds: Path2D[] | null = null;
let sBodyPath2Ds: Path2D[] | null = null;
function getTemplatePath2Ds(): Path2D[] {
  if (!templatePath2Ds) templatePath2Ds = TROGDOR_TEMPLATE_PATHS.map((d) => new Path2D(d));
  return templatePath2Ds;
}
function getSBodyPath2Ds(): Path2D[] {
  if (!sBodyPath2Ds) sBodyPath2Ds = TROGDOR_S_PATHS.map((d) => new Path2D(d));
  return sBodyPath2Ds;
}

// Detection thresholds. Permissive — any S-like wiggle bridging the two
// anchors should pass.
const MIN_POINT_COUNT = 8;
const MIN_PATH_LENGTH = 80;     // total ink, in CSS px
const MIN_WIGGLE_RATIO = 1.25;  // pathLen / start-to-end straight distance
const MIN_REVERSALS = 1;        // direction sign-changes along the path

const SUCCESS_INK_MS = 520;     // cross-fade duration: user's stroke → real S
const SUCCESS_HOLD_MS = 240;    // beat to admire the inked S before the game opens
const FAIL_RESET_MS = 700;

let activeInstance: { close: () => void } | null = null;

type Point = { x: number; y: number };
type Transform = { scale: number; ox: number; oy: number };

export function startSnakeDrawMode(): void {
  if (activeInstance) return;
  if (!tryStart(LOCK_ID)) return;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const surface = overlay.querySelector<HTMLDivElement>('.draw-snake-surface')!;
  const canvas = overlay.querySelector<HTMLCanvasElement>('.draw-snake-canvas')!;
  const statusEl = overlay.querySelector<HTMLElement>('.draw-snake-status')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('.draw-snake-cancel')!;
  const ctx = canvas.getContext('2d')!;

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let points: Point[] = [];
  let drawing = false;
  let evaluating = false;
  let scratch: ReturnType<typeof startPencilScratch> | null = null;
  let lastMoveTime = 0;

  function stopScratch() {
    if (scratch) {
      scratch.stop();
      scratch = null;
    }
  }
  let cssWidth = 0;
  let cssHeight = 0;
  let templateTransform: Transform = { scale: 1, ox: 0, oy: 0 };
  let canvasAnchorTop: Point = { x: 0, y: 0 };
  let canvasAnchorBottom: Point = { x: 0, y: 0 };
  let canvasAnchorTolerance = ANCHOR_TOLERANCE;

  function sizeCanvas() {
    const rect = surface.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    templateTransform = computeTemplateTransform(cssWidth, cssHeight);
    canvasAnchorTop = templateToCanvas(ANCHOR_TOP, templateTransform);
    canvasAnchorBottom = templateToCanvas(ANCHOR_BOTTOM, templateTransform);
    canvasAnchorTolerance = ANCHOR_TOLERANCE * templateTransform.scale;
  }

  // Wait one frame so the overlay's transition has actually laid out before
  // we measure. Without this, getBoundingClientRect can return 0×0.
  requestAnimationFrame(() => {
    sizeCanvas();
    clearCanvas();
  });

  function onResize() {
    // A resize mid-stroke is rare and rescaling the polyline isn't worth the
    // complexity. Clear and let the user redraw.
    sizeCanvas();
    clearCanvas();
    points = [];
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    drawTrogdorTemplate(ctx, templateTransform);
  }

  function strokeSegment(a: Point, b: Point, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function strokeFullPath(color: string, alpha = 1) {
    if (points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawSBody(alpha: number) {
    const t = templateTransform;
    ctx.save();
    ctx.translate(t.ox, t.oy);
    ctx.scale(t.scale, t.scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#2a1a0a';
    for (const p of getSBodyPath2Ds()) ctx.fill(p);
    ctx.restore();
  }

  function animateSuccessInk(durationMs: number, onDone: () => void) {
    // Cross-fade: the user's wobbly green stroke fades out as the real S body
    // (in the template's ink color) fades in, so it reads as the page "fixing"
    // the user's draft into the canonical Trogdor S.
    const t0 = performance.now();
    const tick = (now: number) => {
      const raw = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - raw, 3); // ease-out cubic
      clearCanvas();
      if (eased < 1) strokeFullPath('#7dff6b', 1 - eased);
      if (eased > 0) drawSBody(eased);
      if (raw < 1) requestAnimationFrame(tick);
      else onDone();
    };
    requestAnimationFrame(tick);
  }

  function localPoint(e: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: PointerEvent) {
    if (evaluating) return;
    // Ignore right/middle mouse buttons.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drawing = true;
    points = [localPoint(e)];
    clearCanvas();
    statusEl.textContent = '';
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    // Tip touching paper — a soft initial tick that the velocity ramp will
    // take over from on the first real move.
    stopScratch();
    scratch = startPencilScratch();
    scratch.setIntensity(0.25);
    lastMoveTime = performance.now();
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing) return;
    const p = localPoint(e);
    const last = points[points.length - 1];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    // De-dup samples within 2px — keeps the polyline manageable and reduces
    // jitter contributing spurious reversals in detection.
    if (dx * dx + dy * dy < 4) return;
    points.push(p);
    strokeSegment(last, p, '#2a1a0a');

    // Velocity → scratch intensity. ~0.3 px/ms (slow drag) lands near 0.45;
    // ~1.5 px/ms (a brisk scribble) saturates near 1.0. The audio side
    // ramps back to 0 within ~320ms, so a paused cursor quickly goes
    // silent without any timer here.
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveTime);
    const dist = Math.hypot(dx, dy);
    const velocity = dist / dt; // px/ms
    const intensity = Math.min(1, 0.35 + velocity * 0.55);
    scratch?.setIntensity(intensity);
    lastMoveTime = now;
  }

  function onPointerUp(e: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    stopScratch();
    evaluate();
  }

  function evaluate() {
    if (evaluating) return;
    evaluating = true;
    if (isSnakeLike(points, canvasAnchorTop, canvasAnchorBottom, canvasAnchorTolerance)) {
      // Pass: cross-fade the user's wobbly stroke into the real S body, hold
      // for a beat, then hand off to the game.
      overlay.classList.add('is-success');
      statusEl.textContent = 'TROGDOOOOR!';
      animateSuccessInk(SUCCESS_INK_MS, () => {
        window.setTimeout(() => {
          // Tear down (releasing the lock) before openSnake tries to take its
          // own lock.
          cleanup();
          openSnake();
        }, SUCCESS_HOLD_MS);
      });
      return;
    }

    overlay.classList.add('is-fail');
    statusEl.textContent = 'Almost — connect the dots with an S.';
    window.setTimeout(() => {
      overlay.classList.remove('is-fail');
      clearCanvas();
      points = [];
      statusEl.textContent = '';
      evaluating = false;
    }, FAIL_RESET_MS);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  }

  function cleanup() {
    stopScratch();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    cancelBtn.removeEventListener('click', cleanup);
    overlay.remove();
    document.body.style.overflow = prevOverflow;
    activeInstance = null;
    end(LOCK_ID);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  cancelBtn.addEventListener('click', cleanup);

  activeInstance = { close: cleanup };
}

// Exposes window.__drawSnake so the clipboard pencil (added separately) can
// trigger this without an import dependency. Importers can still use
// startSnakeDrawMode directly.
export function initDrawSnake(): void {
  (window as any).__drawSnake = startSnakeDrawMode;
}

// ---- Detection ----

function isSnakeLike(points: Point[], anchorA: Point, anchorB: Point, tolerance: number): boolean {
  if (points.length < MIN_POINT_COUNT) return false;

  // Path length — sum of segment distances.
  let pathLen = 0;
  for (let i = 1; i < points.length; i++) {
    pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (pathLen < MIN_PATH_LENGTH) return false;

  // Must start near one anchor and end near the other (either direction).
  const start = points[0];
  const end = points[points.length - 1];
  const dStartA = Math.hypot(start.x - anchorA.x, start.y - anchorA.y);
  const dStartB = Math.hypot(start.x - anchorB.x, start.y - anchorB.y);
  const dEndA = Math.hypot(end.x - anchorA.x, end.y - anchorA.y);
  const dEndB = Math.hypot(end.x - anchorB.x, end.y - anchorB.y);
  const forwardOK = dStartA <= tolerance && dEndB <= tolerance;
  const reverseOK = dStartB <= tolerance && dEndA <= tolerance;
  if (!forwardOK && !reverseOK) return false;

  // Wiggle: path length vs straight-line start-to-end. A straight line is
  // ~1.0; any meaningful bend pushes this up.
  const startEndDist = Math.hypot(end.x - start.x, end.y - start.y);
  const wiggleRatio = startEndDist > 1 ? pathLen / startEndDist : Infinity;

  // Reversals: sample at a stride to smooth out hand tremor, then count
  // sign changes in x and y deltas. An S-curve gets at least 1; a single
  // arc gets 0 here but typically passes the wiggle check.
  const stride = Math.max(1, Math.floor(points.length / 24));
  let reversals = 0;
  let lastSignX = 0;
  let lastSignY = 0;
  for (let i = stride; i < points.length; i += stride) {
    const dx = points[i].x - points[i - stride].x;
    const dy = points[i].y - points[i - stride].y;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    if (sx !== 0) {
      if (lastSignX !== 0 && sx !== lastSignX) reversals++;
      lastSignX = sx;
    }
    if (sy !== 0) {
      if (lastSignY !== 0 && sy !== lastSignY) reversals++;
      lastSignY = sy;
    }
  }

  return wiggleRatio >= MIN_WIGGLE_RATIO || reversals >= MIN_REVERSALS;
}

// ---- Template ----

function computeTemplateTransform(cssW: number, cssH: number): Transform {
  const padding = 24;
  const availW = Math.max(1, cssW - 2 * padding);
  const availH = Math.max(1, cssH - 2 * padding);
  const scale = Math.min(availW / TEMPLATE_W, availH / TEMPLATE_H, 1.3);
  const drawnW = TEMPLATE_W * scale;
  const drawnH = TEMPLATE_H * scale;
  return {
    scale,
    ox: (cssW - drawnW) / 2,
    oy: (cssH - drawnH) / 2,
  };
}

function templateToCanvas(p: Point, t: Transform): Point {
  return { x: p.x * t.scale + t.ox, y: p.y * t.scale + t.oy };
}

function drawTrogdorTemplate(ctx: CanvasRenderingContext2D, t: Transform) {
  ctx.save();
  ctx.translate(t.ox, t.oy);
  ctx.scale(t.scale, t.scale);
  // The traced paths are filled regions (potrace traces ink shapes, not
  // strokes), so we fill rather than stroke. fillStyle is the only color we
  // need — strokeStyle is reserved for the anchor marks below.
  ctx.fillStyle = '#2a1a0a';

  for (const p of getTemplatePath2Ds()) {
    ctx.fill(p);
  }

  drawAnchorMarks(ctx, t.scale);

  ctx.restore();
}

function drawAnchorMarks(ctx: CanvasRenderingContext2D, scale: number) {
  // Dashed open circles mark where the user's stroke should start/end; a
  // small filled dot at each center makes the target unambiguous.
  ctx.save();
  ctx.strokeStyle = '#b48b4a';
  ctx.fillStyle = '#b48b4a';
  ctx.lineWidth = 1.8 / scale;
  ctx.setLineDash([4 / scale, 4 / scale]);

  ctx.beginPath();
  ctx.arc(ANCHOR_TOP.x, ANCHOR_TOP.y, 14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ANCHOR_BOTTOM.x, ANCHOR_BOTTOM.y, 14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(ANCHOR_TOP.x, ANCHOR_TOP.y, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ANCHOR_BOTTOM.x, ANCHOR_BOTTOM.y, 3.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---- DOM ----

function buildOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'draw-snake-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Finish the snake to launch the game');
  root.innerHTML = `
    <div class="draw-snake-frame">
      <div class="draw-snake-header">
        <span class="draw-snake-title">Finish the rest of the Trogdor</span>
        <button class="draw-snake-cancel" type="button" aria-label="Cancel">×</button>
      </div>
      <div class="draw-snake-surface">
        <canvas class="draw-snake-canvas"></canvas>
      </div>
      <div class="draw-snake-footer">
        <span class="draw-snake-status"></span>
        <span class="draw-snake-hint">Esc to cancel</span>
      </div>
    </div>
  `;
  return root;
}
