// Idle peek Easter egg. After a stretch of no user activity, Tim quietly
// pokes out from one of the page's edges, leans away from the content as if
// hiding behind the edge, holds for a beat, then ducks back out of sight.
// Inspired by Andy Hertzfeld's Mr. Macintosh — most short visits never see
// it, which is the charm.
//
// Visual: a single held frame (the Original/standing pose, at the
// bottom-right cell of any 5x5 grid sprite) sliding in from the chosen edge.
// We don't run the full sprite animation — the peek is intentionally still,
// so the slide-in carries the motion.
//
// Defers to the shared interaction lock: it only fires when nothing else is
// playing, and yields immediately if any activity happens.

import { ARRIVALS } from '../lib/avatar';
import { end, isLocked, onLockChange, tryStart } from '../lib/interaction-lock';
import { isJournalOpen } from './journal';

const LOCK_ID = 'idle-peek';

// How long the page has to be quiet before the peek becomes eligible. After
// a peek finishes, the lock-change listener resets this countdown, so the
// gap between peeks is at least IDLE_BEFORE_PEEK_MS + expected-tick-wait.
const IDLE_BEFORE_PEEK_MS = 14000;
// Once eligible, we roll the dice every tick. Low probability + frequent
// ticks = scattered firings that feel random rather than scheduled.
const TICK_INTERVAL_MS = 3500;
const FIRE_PROBABILITY = 0.22;

// Peek animation timings.
const SLIDE_IN_MS = 380;
const HOLD_MS = 1500;
const SLIDE_OUT_MS = 340;
// Hard ceiling on viewport size below which we don't peek (mobile crops
// the playful gutter out anyway, and a stranger appearing from below a
// thumb-sized resume reads as broken).
const MIN_VIEWPORT_WIDTH = 720;

type Edge = 'left' | 'right' | 'bottom';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pickEdge(): Edge {
  const r = Math.random();
  if (r < 0.45) return 'left';
  if (r < 0.9) return 'right';
  return 'bottom';
}

// Randomize the vertical anchor for side peeks so successive firings don't
// stamp on the exact same spot — that uniformity made the sides feel
// invisible compared to the bottom peek.
function pickSideAnchor(): number {
  return 14 + Math.random() * 28;
}

function buildAvatar(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'idle-peek-avatar';
  el.setAttribute('aria-hidden', 'true');
  // Any seam-locked sprite works — we lock the background to the bottom-right
  // cell (the Original/standing frame) via CSS, so the sprite source choice
  // only matters for the held pose, not for motion. Picking an arrival keeps
  // us in the same sprite family the rest of the page uses.
  const source = ARRIVALS[0]?.sprite ?? '/sprites/tim/arrivals/somersault.png';
  el.style.setProperty('--sprite-url', `url('${source}')`);
  return el;
}

export function initIdlePeek() {
  if (prefersReducedMotion()) return;

  let idleTimer: number | null = null;
  let tickTimer: number | null = null;
  let activePeek: { el: HTMLElement; timers: number[] } | null = null;

  function clearTimers() {
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (tickTimer !== null) {
      window.clearTimeout(tickTimer);
      tickTimer = null;
    }
  }

  // Abruptly tear down an in-flight peek. Used when the user becomes active —
  // we don't owe them a graceful slide-out, the goal is to get out of the way
  // before they notice anything.
  function abortPeek() {
    if (!activePeek) return;
    activePeek.timers.forEach((t) => window.clearTimeout(t));
    activePeek.el.classList.add('is-peek-aborting');
    const el = activePeek.el;
    window.setTimeout(() => el.remove(), 220);
    activePeek = null;
    end(LOCK_ID);
  }

  function tick() {
    tickTimer = null;
    // Bail if anything else holds the lock — and don't reschedule yet; the
    // lock-change listener will restart us when the page is quiet again.
    // Same goes for the journal: it doesn't hold the lock (it's a pure UI
    // overlay), so we have to check it explicitly. User-driven close fires
    // a keydown which restarts the idle countdown via onActivity.
    if (isLocked() || isJournalOpen()) return;
    if (document.hidden) {
      tickTimer = window.setTimeout(tick, TICK_INTERVAL_MS);
      return;
    }
    if (window.innerWidth < MIN_VIEWPORT_WIDTH) {
      tickTimer = window.setTimeout(tick, TICK_INTERVAL_MS);
      return;
    }

    if (Math.random() < FIRE_PROBABILITY) {
      firePeek();
    } else {
      tickTimer = window.setTimeout(tick, TICK_INTERVAL_MS);
    }
  }

  function firePeek() {
    if (!tryStart(LOCK_ID)) {
      tickTimer = window.setTimeout(tick, TICK_INTERVAL_MS);
      return;
    }

    const edge = pickEdge();
    const el = buildAvatar();
    el.classList.add(`is-peek-${edge}`);
    if (edge === 'left' || edge === 'right') {
      el.style.bottom = `${pickSideAnchor()}vh`;
    }
    document.body.appendChild(el);
    // Force reflow so the initial offscreen position paints before we add
    // the .is-peeking class that animates the slide-in.
    void el.offsetWidth;
    el.classList.add('is-peeking');

    const timers: number[] = [];
    activePeek = { el, timers };

    timers.push(
      window.setTimeout(() => {
        el.classList.remove('is-peeking');
        el.classList.add('is-leaving');
      }, SLIDE_IN_MS + HOLD_MS),
    );
    timers.push(
      window.setTimeout(() => {
        el.remove();
        activePeek = null;
        // Releasing the lock fires onLockChange, which schedules the next
        // idle countdown from IDLE_BEFORE_PEEK_MS — no manual reschedule.
        end(LOCK_ID);
      }, SLIDE_IN_MS + HOLD_MS + SLIDE_OUT_MS),
    );
  }

  function scheduleFromIdle(delay: number) {
    clearTimers();
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      tick();
    }, delay);
  }

  function onActivity() {
    abortPeek();
    scheduleFromIdle(IDLE_BEFORE_PEEK_MS);
  }

  // Throttled mousemove — raw movement fires hundreds of times per second
  // and the page is full of hover-active elements, so we don't want every
  // micro-move to reset the timer.
  let lastMoveAt = 0;
  function onMove() {
    const now = performance.now();
    if (now - lastMoveAt < 600) return;
    lastMoveAt = now;
    onActivity();
  }

  // Capture-phase for input events so we release the lock BEFORE the click
  // bubbles to a trigger's own handler — otherwise the trigger's tryStart()
  // would see the idle-peek lock still held and silently drop the click.
  document.addEventListener('click', onActivity, true);
  document.addEventListener('keydown', onActivity, true);
  document.addEventListener('touchstart', onActivity, { passive: true, capture: true });
  document.addEventListener('scroll', onActivity, { passive: true });
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimers();
      abortPeek();
    } else {
      scheduleFromIdle(IDLE_BEFORE_PEEK_MS);
    }
  });
  // When another interaction releases the lock, restart the idle countdown —
  // we don't want to start "idle" while a cascade is still running.
  onLockChange(() => {
    if (!isLocked()) scheduleFromIdle(IDLE_BEFORE_PEEK_MS);
  });

  scheduleFromIdle(IDLE_BEFORE_PEEK_MS);
}
