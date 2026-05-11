// Avatar animation library + phase machine.
//
// Three slots wrap each avatar appearance: arrival → core → exit.
//   - arrival/exit are randomized from their pools (chainable, both seams
//     hit the Original pose so they swap into the core invisibly).
//   - core is the deliberate gesture for the interaction.
// All sprites are 5x5 grids of 256px frames — JS just sets the URL and
// duration, the CSS phase classes handle the rest.

export type AvatarAnim = {
  sprite: string;
  // Duration of a single play of the 5x5 grid.
  durationMs: number;
  // Number of times the sprite repeats end-to-end. Default 1. Use >1 for
  // cores where the gesture needs to keep going while something else (e.g.
  // a JS-driven translate) plays out at a different tempo.
  cycles?: number;
  // Frames to skip from the start of the sprite. Used to work around
  // generated sprites whose leading frames are dead time (e.g. character
  // standing still before the action starts). Implemented via negative
  // animation-delay so the visible animation begins mid-grid; the avatar's
  // last frame is unaffected so the seam contract still holds.
  // Only meaningful with cycles: 1 — subsequent cycles would replay the
  // skipped frames.
  skipFrames?: number;
};

// Effective on-screen duration: total grid time minus any leading frames
// the sprite is configured to skip. Callers that gate other timing on the
// core's visible end (e.g. the Greenhouse sweep translate) must use this,
// not durationMs * cycles.
export function getCoreDurationMs(anim: AvatarAnim): number {
  const total = anim.durationMs * (anim.cycles ?? 1);
  const skipMs = (anim.skipFrames ?? 0) * (anim.durationMs / 25);
  return total - skipMs;
}

export const ARRIVALS: AvatarAnim[] = [
  { sprite: '/sprites/tim/arrivals/somersault.png', durationMs: 1100 },
  { sprite: '/sprites/tim/arrivals/portal.png', durationMs: 1100 },
  { sprite: '/sprites/tim/arrivals/terminal-boot.png', durationMs: 1100 },
  { sprite: '/sprites/tim/arrivals/skydive-chute.png', durationMs: 1100 },
  { sprite: '/sprites/tim/arrivals/spawn-in.png', durationMs: 1100 },
  { sprite: '/sprites/tim/arrivals/pipe-drop.png', durationMs: 1100 },
];

export const EXITS: AvatarAnim[] = [
  { sprite: '/sprites/tim/exits/backflip.png', durationMs: 1100 },
  { sprite: '/sprites/tim/exits/curtain-drop.png', durationMs: 1100 },
  { sprite: '/sprites/tim/exits/walk-off-shrug.png', durationMs: 1100 },
  { sprite: '/sprites/tim/exits/save-and-quit.png', durationMs: 1100 },
  { sprite: '/sprites/tim/exits/beam-up.png', durationMs: 1100 },
];

const PHASE_CLASSES = [
  'is-arriving',
  'is-arrival-held',
  'is-coring',
  'is-core-held',
  'is-exiting',
  'is-fading',
];

export type Facing = 'left' | 'right';

// Final fade after the exit sprite finishes (covers any sprites that don't
// fully fade themselves out of frame).
export const AVATAR_FADE_MS = 280;

export function pickRandom<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

export type AvatarController = {
  reset(): void;
  setFacing(facing: Facing): void;
  startArrival(arrival: AvatarAnim): void;
  scheduleCore(core: AvatarAnim, startMs: number): void;
  scheduleExit(exit: AvatarAnim, startMs: number): void;
};

// Drives a single avatar element through arrival → core → exit. The caller
// composes the timeline by passing each phase's millisecond offset relative
// to the start of the sequence.
export function createAvatarController(el: HTMLElement): AvatarController {
  const timers: number[] = [];

  function clearTimers() {
    timers.forEach((t) => window.clearTimeout(t));
    timers.length = 0;
  }

  function reset() {
    clearTimers();
    el.classList.remove(...PHASE_CLASSES);
    el.classList.remove('is-facing-left');
    el.style.removeProperty('--sprite-url');
    el.style.removeProperty('--anim-duration');
    el.style.removeProperty('--anim-row-duration');
    el.style.removeProperty('--anim-delay');
  }

  // Mirrors the whole appearance horizontally. Apply BEFORE startArrival so
  // arrival/core/exit all share the orientation — flipping mid-sequence would
  // pop visibly at the seam.
  function setFacing(facing: Facing) {
    el.classList.toggle('is-facing-left', facing === 'left');
  }

  function setPhase(phaseClass: string) {
    // Remove + add in the same task so the browser never paints an in-between
    // state with no class (which would briefly drop opacity to 0).
    el.classList.remove(...PHASE_CLASSES);
    el.classList.add(phaseClass);
  }

  function loadAnim(anim: AvatarAnim) {
    const cycles = anim.cycles ?? 1;
    el.style.setProperty('--sprite-url', `url('${anim.sprite}')`);
    el.style.setProperty('--anim-duration', `${anim.durationMs}ms`);
    el.style.setProperty('--anim-row-duration', `${anim.durationMs / 5}ms`);
    // Iteration counts for the X (column) and Y (row) sub-animations. X
    // cycles cols 0→4 once per row (5 per full sprite play); Y cycles rows
    // 0→4 once per full sprite play. Multiply by `cycles` to repeat the
    // whole 5×5 grid end-to-end. Default 1 cycle leaves the previous
    // behavior unchanged.
    el.style.setProperty('--anim-x-iters', `${5 * cycles}`);
    el.style.setProperty('--anim-y-iters', `${cycles}`);
    // Negative animation-delay used by sprites with leading dead frames
    // (see AvatarAnim.skipFrames). Per-frame is durationMs/25, and the same
    // delay value advances both X and Y by the same number of frames since
    // X per-step (row_duration/5) equals Y per-step / 5 only nominally —
    // in practice both work out to the same ms-per-frame, so a single
    // delay shifts both animations consistently.
    const skipMs = (anim.skipFrames ?? 0) * (anim.durationMs / 25);
    el.style.setProperty('--anim-delay', `${-skipMs}ms`);
  }

  function startArrival(arrival: AvatarAnim) {
    loadAnim(arrival);
    setPhase('is-arriving');
    timers.push(
      window.setTimeout(() => setPhase('is-arrival-held'), arrival.durationMs)
    );
  }

  function scheduleCore(core: AvatarAnim, startMs: number) {
    const totalMs = getCoreDurationMs(core);
    timers.push(
      window.setTimeout(() => {
        loadAnim(core);
        setPhase('is-coring');
      }, startMs)
    );
    timers.push(
      window.setTimeout(() => setPhase('is-core-held'), startMs + totalMs)
    );
  }

  function scheduleExit(exit: AvatarAnim, startMs: number) {
    timers.push(
      window.setTimeout(() => {
        loadAnim(exit);
        setPhase('is-exiting');
      }, startMs)
    );
    timers.push(
      window.setTimeout(() => {
        el.classList.add('is-fading');
      }, startMs + exit.durationMs)
    );
    timers.push(
      window.setTimeout(reset, startMs + exit.durationMs + AVATAR_FADE_MS)
    );
  }

  return { reset, setFacing, startArrival, scheduleCore, scheduleExit };
}
