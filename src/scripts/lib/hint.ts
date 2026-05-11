// On-demand discovery hint. The user clicks a still-locked entry in the
// journal, and we glow the corresponding trigger element on the page for
// a few seconds so they know where to look. No idle scheduler, no passive
// nag — the help only fires when the user invites it.
//
// CONFIG maps each journal/manifest egg id to a DOM target. Ids that have
// no DOM-clickable trigger (e.g. `snake`, which is keyboard-only) are
// intentionally absent — hintFor on them is a silent no-op and the
// interviewer-voiced text in the journal does all the hinting.

const HINT_CLASS = 'is-hinting';
const HINT_DURATION_MS = 3300;
// Animation is 1.1s × 3 iterations = 3.3s; matches HINT_DURATION_MS so the
// .is-hinting class strips off exactly when the keyframes finish.

type Config = {
  // What counts as the discovery target — the element the user is meant
  // to click. Defaults double as the glow target when no `hintSelector`
  // is provided.
  triggerSelector: string;
  // Override the visual glow target when the trigger isn't a good fit
  // (e.g. a big stage container) — falls back to the trigger element.
  hintSelector?: string;
  // True when there are multiple matching triggers (year ranges, etc.);
  // only the first match drives the glow. Kept for future-proofing —
  // hintFor itself just resolves to a single hintEl.
  multi?: boolean;
};

const CONFIG: Record<string, Config> = {
  name: { triggerSelector: '.resume-name-inner' },
  skills: { triggerSelector: '#skills-heading' },
  // .ts-trigger is applied at runtime by initTsSquiggle to the lone
  // .skill-item whose text is "TypeScript".
  'ts-squiggle': { triggerSelector: '.skill-item.ts-trigger' },
  'many-hats': { triggerSelector: '.role-cycle' },
  greenhouse: { triggerSelector: '.greenhouse-trigger' },
  'time-warp': { triggerSelector: '.resume-meta', multi: true },
  // snake is keyboard-only ("press S") — no DOM element to glow, so no
  // entry. hintFor('snake') falls through to a no-op.
};

// Whether a given egg has a DOM trigger we can glow. Callers (the journal)
// use this to decide whether to render the locked item as an interactive
// button vs. plain text — so the cursor/hover affordance never lies.
export function hasHint(id: string): boolean {
  return id in CONFIG;
}

export function hintFor(id: string): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cfg = CONFIG[id];
  if (!cfg) return;
  const selector = cfg.hintSelector ?? cfg.triggerSelector;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;

  // Center the trigger in the viewport so the glow lands somewhere the
  // user is already looking — without this the highlight can fire on an
  // offscreen element after the journal tucks down.
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Re-trigger if already mid-glow: strip and re-add on the next frame so
  // the animation restarts instead of continuing partway through.
  el.classList.remove(HINT_CLASS);
  void el.offsetWidth;
  el.classList.add(HINT_CLASS);
  window.setTimeout(() => {
    el.classList.remove(HINT_CLASS);
  }, HINT_DURATION_MS);
}
