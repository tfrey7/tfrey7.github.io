// Idle-discovery hints. When the user goes a while without clicking, we
// quietly pulse one of the interactive Easter-egg triggers they haven't
// found yet. One nudge at a time, cycles through, and stops once every
// trigger has been clicked at least once in this session.

const IDLE_BEFORE_FIRST_HINT_MS = 6000;
const IDLE_BETWEEN_HINTS_MS = 9000;
const HINT_DURATION_MS = 3300;
const HINT_CLASS = 'is-hinting';

type Config = {
  id: string;
  // What counts as "discovered" — a click anywhere in here marks it found.
  triggerSelector: string;
  // What visually pulses. Defaults to the trigger element.
  hintSelector?: string;
  // If true, query all matches; any click on any match discovers the group.
  // Only the first match is used as the hint target.
  multi?: boolean;
};

const CONFIG: Config[] = [
  { id: 'name', triggerSelector: '.resume-name-inner' },
  { id: 'skills', triggerSelector: '.skills-stage', hintSelector: '#skills-heading' },
  { id: 'role', triggerSelector: '.role-cycle' },
  { id: 'greenhouse', triggerSelector: '.greenhouse-trigger' },
  { id: 'time-warp', triggerSelector: '.resume-meta', multi: true },
];

type Target = {
  id: string;
  hintEl: HTMLElement;
  discovered: boolean;
};

export function initHint() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const targets: Target[] = [];

  for (const cfg of CONFIG) {
    const trigEls = cfg.multi
      ? Array.from(document.querySelectorAll<HTMLElement>(cfg.triggerSelector))
      : [document.querySelector<HTMLElement>(cfg.triggerSelector)].filter(
          (el): el is HTMLElement => el !== null,
        );
    if (trigEls.length === 0) continue;

    const hintEl = cfg.hintSelector
      ? document.querySelector<HTMLElement>(cfg.hintSelector)
      : trigEls[0];
    if (!hintEl) continue;

    const target: Target = { id: cfg.id, hintEl, discovered: false };
    trigEls.forEach((el) => {
      el.addEventListener('click', () => {
        target.discovered = true;
      });
    });
    targets.push(target);
  }

  if (targets.length === 0) return;

  let idleTimer: number | null = null;
  let hintEndTimer: number | null = null;
  let activeHintEl: HTMLElement | null = null;
  let hasFiredOnce = false;

  function clearActiveHint() {
    if (activeHintEl) {
      activeHintEl.classList.remove(HINT_CLASS);
      activeHintEl = null;
    }
    if (hintEndTimer !== null) {
      window.clearTimeout(hintEndTimer);
      hintEndTimer = null;
    }
  }

  function schedule(delay: number) {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(fire, delay);
  }

  function fire() {
    idleTimer = null;
    if (document.hidden) {
      schedule(IDLE_BETWEEN_HINTS_MS);
      return;
    }
    const undiscovered = targets.filter((t) => !t.discovered);
    if (undiscovered.length === 0) return;

    const pick = undiscovered[Math.floor(Math.random() * undiscovered.length)];
    pick.hintEl.classList.add(HINT_CLASS);
    activeHintEl = pick.hintEl;
    hasFiredOnce = true;

    hintEndTimer = window.setTimeout(() => {
      hintEndTimer = null;
      clearActiveHint();
      schedule(IDLE_BETWEEN_HINTS_MS);
    }, HINT_DURATION_MS);
  }

  function onActivity() {
    clearActiveHint();
    schedule(hasFiredOnce ? IDLE_BETWEEN_HINTS_MS : IDLE_BEFORE_FIRST_HINT_MS);
  }

  document.addEventListener('click', onActivity);
  document.addEventListener('keydown', onActivity);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      clearActiveHint();
    } else if (idleTimer === null) {
      schedule(hasFiredOnce ? IDLE_BETWEEN_HINTS_MS : IDLE_BEFORE_FIRST_HINT_MS);
    }
  });

  schedule(IDLE_BEFORE_FIRST_HINT_MS);
}
