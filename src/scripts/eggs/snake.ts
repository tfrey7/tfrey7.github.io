import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';
import { isJournalOpen } from './journal';

// Self-contained Snake game. Pops up as a CRT-styled modal — green-on-black
// classic Snake. Built standalone so the launcher (e.g. clicking the
// supercomputer's keyboard mid-Greenhouse-egg) can be wired up later without
// reworking the game itself. While the modal is open it holds the global
// interaction lock so other easter eggs sit out.

const LOCK_ID = 'snake';

const COLS = 24;
const ROWS = 18;
const CELL = 18;
const CANVAS_W = COLS * CELL;
const CANVAS_H = ROWS * CELL;

// Tick cadence (ms between snake moves). Floor keeps the game playable —
// faster than ~70ms outpaces input on most keyboards.
const TICK_START_MS = 140;
const TICK_FLOOR_MS = 70;
const TICK_SPEEDUP_PER_FOOD_MS = 2;

const POINTS_PER_FOOD = 1;

// localStorage key for the persisted high score.
const HISCORE_KEY = 'snake-hiscore';

// Phosphor palette. Two greens — bright for snake/food, dim for grid.
const COLOR_BG = '#050a05';
const COLOR_GRID = '#0c1f0c';
const COLOR_SNAKE = '#7dff6b';
const COLOR_SNAKE_HEAD = '#b8ff9e';
const COLOR_FOOD = '#ff5f5f';

type Dir = 'up' | 'down' | 'left' | 'right';
type Cell = { x: number; y: number };
type Phase = 'start' | 'playing' | 'gameover';

const DIR_VEC: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

let openInstance: { close: () => void } | null = null;

export function openSnake() {
  if (openInstance) return;
  if (!tryStart(LOCK_ID)) return;
  markDiscovered('snake');

  const root = buildModal();
  document.body.appendChild(root);
  // Lock body scroll so arrow keys don't double as page scroll while playing.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const canvas = root.querySelector<HTMLCanvasElement>('.snake-canvas')!;
  const overlay = root.querySelector<HTMLElement>('.snake-overlay')!;
  const scoreEl = root.querySelector<HTMLElement>('.snake-score')!;
  const hiEl = root.querySelector<HTMLElement>('.snake-hi')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('.snake-close')!;
  const ctx = canvas.getContext('2d')!;

  // Scale canvas for HiDPI so the pixel art stays crisp.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  let snake: Cell[] = [];
  let dir: Dir = 'right';
  // Buffered direction — applied at the next tick so two quick keypresses in
  // one tick (e.g., up then right for a 90° turn) both register and the second
  // doesn't get overwritten before the first takes effect.
  let pendingDir: Dir = 'right';
  let food: Cell = { x: 0, y: 0 };
  let score = 0;
  let hiScore = readHiScore();
  let phase: Phase = 'start';
  let tickMs = TICK_START_MS;
  let tickTimer: number | null = null;

  const audio = createAudio();

  function reset() {
    snake = [
      { x: 6, y: ROWS >> 1 },
      { x: 5, y: ROWS >> 1 },
      { x: 4, y: ROWS >> 1 },
      { x: 3, y: ROWS >> 1 },
    ];
    dir = 'right';
    pendingDir = 'right';
    score = 0;
    tickMs = TICK_START_MS;
    food = spawnFood(snake);
    updateScoreUI();
  }

  function startGame() {
    reset();
    phase = 'playing';
    overlay.style.display = 'none';
    audio.start();
    scheduleTick();
    render();
  }

  function endGame() {
    phase = 'gameover';
    if (tickTimer !== null) {
      window.clearTimeout(tickTimer);
      tickTimer = null;
    }
    const beatHi = score > hiScore;
    if (beatHi) {
      hiScore = score;
      writeHiScore(hiScore);
      updateScoreUI();
    }
    audio.death();
    if (beatHi && score > 0) {
      window.setTimeout(() => audio.hiScore(), 520);
    }
    showOverlay(
      `<div class="snake-overlay-title">GAME OVER</div>` +
        `<div class="snake-overlay-score">SCORE ${pad(score)}</div>` +
        `<div class="snake-overlay-hint">SPACE to restart &nbsp;·&nbsp; ESC to quit</div>`,
    );
    render();
  }

  function showStart() {
    phase = 'start';
    showOverlay(
      `<div class="snake-overlay-title">SNAKE</div>` +
        `<div class="snake-overlay-hint">SPACE or any arrow to start</div>`,
    );
  }

  function showOverlay(html: string) {
    overlay.innerHTML = html;
    overlay.style.display = 'flex';
  }

  function scheduleTick() {
    tickTimer = window.setTimeout(tick, tickMs);
  }

  function tick() {
    tickTimer = null;
    if (phase !== 'playing') return;

    dir = pendingDir;
    const head = snake[0];
    const v = DIR_VEC[dir];
    const next: Cell = { x: head.x + v.x, y: head.y + v.y };

    // Wall collision.
    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      endGame();
      return;
    }
    // Self collision. The tail tip is about to move out of its cell, so it's
    // safe to step into — only check segments 0..length-2.
    for (let i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === next.x && snake[i].y === next.y) {
        endGame();
        return;
      }
    }

    snake.unshift(next);
    if (next.x === food.x && next.y === food.y) {
      const picked = score;
      score += POINTS_PER_FOOD;
      tickMs = Math.max(TICK_FLOOR_MS, tickMs - TICK_SPEEDUP_PER_FOOD_MS);
      food = spawnFood(snake);
      updateScoreUI();
      audio.eat(picked);
    } else {
      snake.pop();
    }

    render();
    scheduleTick();
  }

  function render() {
    // Background + faint grid (only behind playfield, not over snake).
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, CANVAS_H);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(CANVAS_W, y * CELL + 0.5);
    }
    ctx.stroke();

    // Food — solid square, slightly inset.
    ctx.fillStyle = COLOR_FOOD;
    ctx.fillRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4);

    // Snake — head brighter than body, segments inset by 1px so the grid
    // shows through and you can count the body.
    for (let i = 0; i < snake.length; i++) {
      ctx.fillStyle = i === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE;
      const s = snake[i];
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  function updateScoreUI() {
    scoreEl.textContent = `SCORE ${pad(score)}`;
    hiEl.textContent = `HI ${pad(hiScore)}`;
  }

  // --- Input ---

  function turn(next: Dir) {
    // Disallow 180° reversals — would instantly self-collide on the next tick.
    if (OPPOSITE[next] === dir) return;
    pendingDir = next;
  }

  function onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (phase === 'playing') {
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { turn('up'); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { turn('down'); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { turn('left'); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { turn('right'); e.preventDefault(); }
      return;
    }

    // start / gameover — any arrow or space starts a fresh run.
    if (
      k === ' ' || k === 'Enter' ||
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' ||
      k === 'w' || k === 'a' || k === 's' || k === 'd' ||
      k === 'W' || k === 'A' || k === 'S' || k === 'D'
    ) {
      e.preventDefault();
      startGame();
      // If the starting key was a directional, honor it as the first turn.
      if (k === 'ArrowUp' || k === 'w' || k === 'W') turn('up');
      else if (k === 'ArrowDown' || k === 's' || k === 'S') turn('down');
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') turn('left');
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') turn('right');
    }
  }

  // Touch input — single-finger swipe on the canvas. Threshold keeps tiny
  // drags from registering as a turn.
  let touchStart: { x: number; y: number } | null = null;
  const SWIPE_MIN_PX = 24;

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: TouchEvent) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    if (!t) { touchStart = null; return; }
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) {
      // Treat tap as start/restart.
      if (phase !== 'playing') startGame();
      return;
    }
    let next: Dir;
    if (Math.abs(dx) > Math.abs(dy)) next = dx > 0 ? 'right' : 'left';
    else next = dy > 0 ? 'down' : 'up';
    if (phase !== 'playing') {
      startGame();
    }
    turn(next);
    e.preventDefault();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === root) close();
  }

  // --- Lifecycle ---

  function close() {
    if (tickTimer !== null) {
      window.clearTimeout(tickTimer);
      tickTimer = null;
    }
    window.removeEventListener('keydown', onKeyDown, true);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchend', onTouchEnd);
    closeBtn.removeEventListener('click', close);
    root.removeEventListener('click', onBackdropClick);
    audio.close();
    root.remove();
    document.body.style.overflow = prevOverflow;
    openInstance = null;
    end(LOCK_ID);
  }

  window.addEventListener('keydown', onKeyDown, true);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', onBackdropClick);

  reset();
  render();
  showStart();
  updateScoreUI();

  openInstance = { close };
}

function buildModal(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'snake-modal-backdrop';
  root.innerHTML = `
    <div class="snake-modal" role="dialog" aria-label="Snake game">
      <div class="snake-modal-header">
        <span class="snake-title">SNAKE</span>
        <span class="snake-score">SCORE 000</span>
        <span class="snake-hi">HI 000</span>
        <button class="snake-close" aria-label="Close">×</button>
      </div>
      <div class="snake-stage">
        <canvas class="snake-canvas"></canvas>
        <div class="snake-overlay"></div>
      </div>
      <div class="snake-modal-footer">
        <span>&larr; &uarr; &darr; &rarr; MOVE</span>
        <span>SPACE START</span>
        <span>ESC QUIT</span>
      </div>
    </div>
  `;
  return root;
}

function spawnFood(snake: Cell[]): Cell {
  // Reject sampling — fine at 24x18=432 cells; collisions are rare even with
  // a long snake. Avoids enumerating empty cells every spawn.
  for (let tries = 0; tries < 200; tries++) {
    const c: Cell = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
    if (!snake.some((s) => s.x === c.x && s.y === c.y)) return c;
  }
  // Fallback: linear scan in the impossibly-full case.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function pad(n: number): string {
  // 3-digit minimum for visual rhythm in the header; grows past that if the
  // score gets there (max possible is COLS*ROWS*POINTS_PER_FOOD).
  return String(Math.max(0, n)).padStart(3, '0');
}

function readHiScore(): number {
  try {
    const v = window.localStorage.getItem(HISCORE_KEY);
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeHiScore(v: number) {
  try {
    window.localStorage.setItem(HISCORE_KEY, String(v));
  } catch {
    // Private mode / disabled storage — silently skip.
  }
}

// Tiny self-contained synth — short blips for eat + death. Kept here rather
// than added to lib/audio.ts because these are game-internal beats nothing
// else on the site shares.
function createAudio() {
  let ctx: AudioContext | null = null;
  function getCtx() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch { return null; }
    return ctx;
  }
  function ready() {
    const c = getCtx();
    if (!c) return null;
    if (c.state === 'suspended') c.resume().catch(() => {});
    return c;
  }
  // C major pentatonic ladder — each eat lands on the next rung so the
  // pickups sound like a climb instead of a uniform blip. Cycles around
  // up the octave so long runs keep rising in tone.
  const EAT_LADDER = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

  // Plays a quick square-wave blip. Helper keeps the bleeps consistent.
  function blip(c: AudioContext, freq: number, dur: number, peak: number, sweep?: number) {
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(freq * sweep, now + dur * 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  return {
    start() {
      const c = ready();
      if (!c) return;
      // Low → high two-step "ready, go!" power-on.
      blip(c, 392, 0.08, 0.05);
      window.setTimeout(() => {
        const c2 = ready();
        if (c2) blip(c2, 587.33, 0.1, 0.05, 1.15);
      }, 90);
    },
    eat(picked: number) {
      const c = ready();
      if (!c) return;
      const freq = EAT_LADDER[picked % EAT_LADDER.length];
      blip(c, freq, 0.09, 0.06, 1.5);
    },
    death() {
      const c = ready();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.45);
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(filter).connect(g).connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.55);
    },
    hiScore() {
      const c = ready();
      if (!c) return;
      // Quick arcade-fanfare: ascending arpeggio with a doubled top note.
      const notes = [523.25, 659.25, 783.99, 1046.5, 1046.5];
      notes.forEach((f, i) => {
        window.setTimeout(() => {
          const c2 = ready();
          if (c2) blip(c2, f, i === notes.length - 1 ? 0.22 : 0.1, 0.06);
        }, i * 95);
      });
    },
    close() {
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
      ctx = null;
    },
  };
}

// Launcher. Two paths in:
//   - press S anywhere on the page (the keyboard shortcut), or
//   - call window.__snake() from the console (still useful for poking).
// The shortcut bails on modifier combos (Cmd+S, Ctrl+S etc. are browser
// commands) and on focused inputs, so it never hijacks normal typing. The
// global interaction lock means it also no-ops if another egg is currently
// running its animation.
export function initSnake() {
  (window as any).__snake = openSnake;

  window.addEventListener('keydown', (e) => {
    if (e.key !== 's' && e.key !== 'S') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Don't pop snake up over the journal panel.
    if (isJournalOpen()) return;
    e.preventDefault();
    openSnake();
  });
}
