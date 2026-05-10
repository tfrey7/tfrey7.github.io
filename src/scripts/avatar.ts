// Avatar animation library + phase machine.
//
// Three slots wrap each avatar appearance: arrival → core → exit.
//   - arrival/exit are randomized from their pools (chainable, both seams
//     hit the Original pose so they swap into the core invisibly).
//   - core is the deliberate gesture for the interaction.
// All sprites are 5x5 grids of 256px frames — JS just sets the URL and
// duration, the CSS phase classes handle the rest.

export type AvatarAnim = { sprite: string; durationMs: number };

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

// Final fade after the exit sprite finishes (covers any sprites that don't
// fully fade themselves out of frame).
const AVATAR_FADE_MS = 280;

export function pickRandom<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

export type AvatarController = {
  reset(): void;
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
    el.style.removeProperty('--sprite-url');
    el.style.removeProperty('--anim-duration');
    el.style.removeProperty('--anim-row-duration');
  }

  function setPhase(phaseClass: string) {
    // Remove + add in the same task so the browser never paints an in-between
    // state with no class (which would briefly drop opacity to 0).
    el.classList.remove(...PHASE_CLASSES);
    el.classList.add(phaseClass);
  }

  function loadAnim(anim: AvatarAnim) {
    el.style.setProperty('--sprite-url', `url('${anim.sprite}')`);
    el.style.setProperty('--anim-duration', `${anim.durationMs}ms`);
    el.style.setProperty('--anim-row-duration', `${anim.durationMs / 5}ms`);
  }

  function startArrival(arrival: AvatarAnim) {
    loadAnim(arrival);
    setPhase('is-arriving');
    timers.push(
      window.setTimeout(() => setPhase('is-arrival-held'), arrival.durationMs)
    );
  }

  function scheduleCore(core: AvatarAnim, startMs: number) {
    timers.push(
      window.setTimeout(() => {
        loadAnim(core);
        setPhase('is-coring');
      }, startMs)
    );
    timers.push(
      window.setTimeout(() => setPhase('is-core-held'), startMs + core.durationMs)
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

  return { reset, startArrival, scheduleCore, scheduleExit };
}
