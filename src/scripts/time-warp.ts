import { playTimeWarp } from './audio';
import {
  ARRIVALS,
  AVATAR_FADE_MS,
  type AvatarAnim,
  EXITS,
  createAvatarController,
  pickRandom,
} from './avatar';

// ---------------------------------------------------------------------------
// Time-warp Easter egg. Click a `.resume-meta` to warp back in time. Each
// further click while already warped jumps one more era back. Dinosaurs is
// the wall — clicks at dino do nothing. Tim eventually auto-arrives to fix
// from whichever era you're in back to the present.
//
//   from dormant: 1st click → 90s
//   while warped: each click steps back through 90s → 80s → 60s → west → dino
//   at dino:      clicks ignored
//   any time:     ~FIX_DELAY_MS after the latest click, Tim arrives and fixes
//
// Each click resets Tim's auto-arrival timer so power-users have time to
// rummage through each era. Reduced-motion users get the same era-cycle
// without the avatar; click at dino toggles back to present so they're
// never stuck warped.
// ---------------------------------------------------------------------------

type Era = '90s' | '80s' | '60s' | 'west' | 'dino';

const ERA_SEQUENCE: readonly Era[] = ['90s', '80s', '60s', 'west', 'dino'];

const ROULETTE_STEPS = 4;
const ROULETTE_INTERVAL_MS = 70;
const FLASH_DURATION_MS = 500;
// Class flip lands during the dark trough of the flash so the swap is hidden.
const THEME_FLIP_DELAY_MS = 140;

// How long the page sits in the era before Tim auto-arrives.
const FIX_DELAY_MS = 2000;
const ARRIVAL_TO_CORE_MS = 200;
const CORE_TO_EXIT_MS = 320;

// 90s uses the brown-haired, flannel-wearing tim-90s variant so the sprite
// reads as a period character. The other eras use the modern Tim sprite —
// he's a time-traveler from the present arriving to fix anachronistic chaos.
const ARRIVALS_90S: AvatarAnim[] = [
  { sprite: '/sprites/tim-90s/arrivals/crt-tv-arrival.png', durationMs: 1100 },
];
const EXITS_90S: AvatarAnim[] = [
  { sprite: '/sprites/tim-90s/exits/crt-power-off-departure.png', durationMs: 1100 },
];
const CORE_90S: AvatarAnim = {
  sprite: '/sprites/tim-90s/cores/laptop-hack.png',
  durationMs: 1500,
};

// Generic fix gesture for non-90s eras — modern Tim, hammer in hand.
const CORE_GENERIC: AvatarAnim = {
  sprite: '/sprites/tim/cores/hammer-fix.png',
  durationMs: 1500,
};

// Pools for era-specific date scrambles (used during the roulette spin) and
// the final landing text. Stable per slot — each .resume-meta gets a pool
// index based on its DOM position so the rolled value doesn't shuffle on
// repeat clicks.
const WESTERN_DATES: readonly string[] = [
  "Spring of '74",
  "Winter of '82",
  "Summer of '69",
  "Fall of '85",
  "Spring of '78",
  "Autumn of '81",
  "Year of '76",
];
const DINO_ERAS: readonly string[] = [
  'Mesozoic',
  'Jurassic',
  'Cretaceous',
  'Triassic',
  'Late Cretaceous',
  'Early Jurassic',
  'Mid-Triassic',
];
const REDACTED = '████';

function shiftYears(text: string, delta: number): string {
  return text.replace(/(?:19|20)\d{2}/g, (m) => String(parseInt(m, 10) + delta));
}

function randomizeYears(text: string): string {
  return text.replace(/(?:19|20)\d{2}/g, () => String(1970 + Math.floor(Math.random() * 61)));
}

// Replace each year/"Present" with a deterministic phrase from `pool`, keyed
// by slot+token position so repeat warps land on the same string.
function phraseDates(text: string, presentLabel: string, pool: readonly string[], slot: number): string {
  let tokenIdx = 0;
  return text.replace(/(?:19|20)\d{2}|Present/g, (match) => {
    if (match === 'Present') return presentLabel;
    const value = pool[(slot * 3 + tokenIdx) % pool.length];
    tokenIdx += 1;
    return value;
  });
}

function redactDates(text: string): string {
  return text.replace(/(?:19|20)\d{2}|Present/g, (m) => (m === 'Present' ? 'ACTIVE' : REDACTED));
}

// Roulette scrambles — what flashes through during the spin before the date
// lands. Numeric eras spin random years; phrase eras spin random pool entries.
function scrambleNumeric(text: string): string {
  return randomizeYears(text);
}
function scramblePhrase(text: string, presentLabel: string, pool: readonly string[]): string {
  return text.replace(/(?:19|20)\d{2}|Present/g, (m) =>
    m === 'Present' ? presentLabel : pool[Math.floor(Math.random() * pool.length)]
  );
}
function scrambleRedact(text: string): string {
  return text.replace(/(?:19|20)\d{2}|Present/g, () => REDACTED);
}

interface EraConfig {
  bodyClass: string;
  marquee: string;
  topBanner?: string;
  bottomBanner?: string;
  arrivals: AvatarAnim[];
  exits: AvatarAnim[];
  core: AvatarAnim;
  transform: (original: string, slot: number) => string;
  scramble: (original: string) => string;
}

const ERA_CONFIGS: Record<Era, EraConfig> = {
  '90s': {
    bodyClass: 'era-90s',
    marquee: "★ Welcome to Tim Frey's Homepage ★ Last updated 03/15/95 ★ You are visitor #00042 ★ Sign my guestbook! ★",
    arrivals: ARRIVALS_90S,
    exits: EXITS_90S,
    core: CORE_90S,
    transform: (orig) => shiftYears(orig, -30),
    scramble: scrambleNumeric,
  },
  '80s': {
    bodyClass: 'era-80s',
    marquee: '▼ Q3 SYNERGY ↑ 320% ▼ MAGNIFICENT GROWTH ▼ EXECUTIVE BONUS UNLOCKED ▼ PARADIGM SHIFT IN PROGRESS ▼',
    topBanner: 'QUARTERLY EARNINGS REPORT — CONFIDENTIAL',
    bottomBanner: 'A SYNERGY DYNAMICS INC. PRODUCTION',
    arrivals: ARRIVALS,
    exits: EXITS,
    core: CORE_GENERIC,
    transform: (orig) => shiftYears(orig, -40),
    scramble: scrambleNumeric,
  },
  '60s': {
    bodyClass: 'era-60s',
    marquee: '■ DECLASSIFIED PER DIRECTIVE 12-B ■ EYES ONLY ■ DO NOT REPRODUCE ■ RETURN TO ARCHIVES ■',
    topBanner: 'TOP SECRET // EYES ONLY',
    bottomBanner: 'FILE NO. 7720-A · ARCHIVED',
    arrivals: ARRIVALS,
    exits: EXITS,
    core: CORE_GENERIC,
    transform: (orig) => redactDates(orig),
    scramble: scrambleRedact,
  },
  west: {
    bodyClass: 'era-west',
    marquee: '★ WANTED ★ FOR DEEDS OF EXCELLENT CODE ★ REWARD: $500 IN GOLD ★ INQUIRE AT THE SALOON ★',
    topBanner: 'WANTED — ALIVE AND HIRING',
    bottomBanner: 'TELEGRAPH THE OFFICE OF MR. FREY',
    arrivals: ARRIVALS,
    exits: EXITS,
    core: CORE_GENERIC,
    transform: (orig, slot) => phraseDates(orig, 'the Present Day', WESTERN_DATES, slot),
    scramble: (orig) => scramblePhrase(orig, 'the Present Day', WESTERN_DATES),
  },
  dino: {
    bodyClass: 'era-dino',
    marquee: '◆ UGH ROCK ◆ TIM HUNT BUG ◆ FIRE GOOD ◆ STACK TRACE IN CAVE ◆ ROAR ◆',
    topBanner: 'CAVE WALL OF TIM-OG, MIGHTY FIXER',
    bottomBanner: 'PAINTED IN OCHRE · LATE CRETACEOUS',
    arrivals: ARRIVALS,
    exits: EXITS,
    core: CORE_GENERIC,
    transform: (orig, slot) => phraseDates(orig, 'Now', DINO_ERAS, slot),
    scramble: (orig) => scramblePhrase(orig, 'Now', DINO_ERAS),
  },
};

// Avatar frame is 192×192. We anchor the frame so the avatar's feet land
// near the clicked element (head extends upward from the click line), then
// clamp to keep the frame fully on-screen with an 8px viewport gutter.
const AVATAR_SIZE = 192;
const AVATAR_FOOT_OFFSET = 8;
const VIEWPORT_GUTTER = 8;

function placeAvatarAt(el: HTMLElement, clickX: number, clickY: number) {
  const maxLeft = window.innerWidth - AVATAR_SIZE - VIEWPORT_GUTTER;
  const maxTop = window.innerHeight - AVATAR_SIZE - VIEWPORT_GUTTER;
  const rawLeft = clickX - AVATAR_SIZE / 2;
  const rawTop = clickY - AVATAR_SIZE + AVATAR_FOOT_OFFSET;
  const left = Math.max(VIEWPORT_GUTTER, Math.min(maxLeft, rawLeft));
  const top = Math.max(VIEWPORT_GUTTER, Math.min(maxTop, rawTop));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Button =
  | { variant: string; image: true }
  | { variant: string; title: string; sub: string };

const BUTTONS_90S: ReadonlyArray<Button> = [
  { variant: 'netscape', image: true },
  { variant: 'ie',       image: true },
  { variant: 'html',     title: 'HTML 3.2',  sub: 'COMPLIANT' },
  { variant: 'res',      title: '800 × 600', sub: 'BEST VIEWED' },
];

// 90s gets its full webring + UNDER CONSTRUCTION caution tape. Other eras get
// the lighter top-banner / bottom-banner / marquee trio. All decor lives
// outside the resume so the static markup stays clean when no era is active.
function buildDecor(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('.timewarp-avatar');
  if (existing) return existing;

  const construction = document.createElement('div');
  construction.className = 'era-90s-construction';
  construction.setAttribute('aria-hidden', 'true');
  const cLabel = document.createElement('span');
  cLabel.textContent = 'UNDER CONSTRUCTION';
  construction.appendChild(cLabel);
  document.body.appendChild(construction);

  const buttons = document.createElement('div');
  buttons.className = 'era-90s-buttons';
  buttons.setAttribute('aria-hidden', 'true');
  for (const b of BUTTONS_90S) {
    const btn = document.createElement('div');
    btn.className = `era-90s-button era-90s-button--${b.variant}`;
    if (!('image' in b)) {
      const sub = document.createElement('div');
      sub.className = 'era-90s-button-sub';
      sub.textContent = b.sub;
      const title = document.createElement('div');
      title.className = 'era-90s-button-title';
      title.textContent = b.title;
      btn.appendChild(sub);
      btn.appendChild(title);
    }
    buttons.appendChild(btn);
  }
  document.body.appendChild(buttons);

  // Top / bottom banners — content swaps per era. Hidden via CSS unless an
  // era class is on the body (and the era's CSS opts the banner in).
  const topBanner = document.createElement('div');
  topBanner.className = 'era-top-banner';
  topBanner.setAttribute('aria-hidden', 'true');
  document.body.appendChild(topBanner);

  const bottomBanner = document.createElement('div');
  bottomBanner.className = 'era-bottom-banner';
  bottomBanner.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bottomBanner);

  // Shared marquee — content swaps per era; CSS skin per era.
  const marquee = document.createElement('div');
  marquee.className = 'era-marquee';
  marquee.setAttribute('aria-hidden', 'true');
  const marqueeText = document.createElement('span');
  marquee.appendChild(marqueeText);
  document.body.appendChild(marquee);

  const avatarEl = document.createElement('div');
  avatarEl.className = 'timewarp-avatar';
  avatarEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(avatarEl);
  return avatarEl;
}

function applyEraDecor(era: Era | null) {
  const top = document.querySelector<HTMLElement>('.era-top-banner');
  const bottom = document.querySelector<HTMLElement>('.era-bottom-banner');
  const marquee = document.querySelector<HTMLElement>('.era-marquee > span');
  if (era === null) {
    if (top) top.textContent = '';
    if (bottom) bottom.textContent = '';
    if (marquee) marquee.textContent = '';
    return;
  }
  const cfg = ERA_CONFIGS[era];
  if (top) top.textContent = cfg.topBanner ?? '';
  if (bottom) bottom.textContent = cfg.bottomBanner ?? '';
  if (marquee) marquee.textContent = cfg.marquee;
}

function removeAllEraClasses(body: HTMLElement) {
  for (const era of ERA_SEQUENCE) body.classList.remove(ERA_CONFIGS[era].bodyClass);
}

type State = 'dormant' | 'warped' | 'fixing';

export function initTimeWarp() {
  const metas = Array.from(document.querySelectorAll<HTMLElement>('.resume-meta'));
  if (metas.length === 0) return;

  const avatarEl = buildDecor();
  const avatar = createAvatarController(avatarEl);

  // Stash originals up front so the transform never operates on already-warped text.
  metas.forEach((el) => {
    if (el.dataset.original === undefined) el.dataset.original = el.textContent ?? '';
  });

  const body = document.body;
  let state: State = 'dormant';
  // Index of the era we're CURRENTLY in (-1 = present). Each click while
  // warped advances this until it hits ERA_SEQUENCE.length - 1 (dino).
  let currentEraIndex = -1;
  let currentEra: Era | null = null;
  let fixTimer: number | null = null;
  let stateResetTimer: number | null = null;
  // Stashed at every click so the auto-fix timer (firing later, out of band)
  // can position the avatar at the user's most recent click.
  let pendingClickX = 0;
  let pendingClickY = 0;
  // Owned by flip(): roulette + flash-clear. Cleared on every flip so a fresh
  // call can re-spin the dates without two passes racing each other.
  const flipTimers: number[] = [];
  // Owned by runFix(): the un-warp callback only. Kept separate from
  // flipTimers so flip()'s clearTimers doesn't wipe it.
  const fixSequenceTimers: number[] = [];

  function clearFlipTimers() {
    flipTimers.forEach((t) => window.clearTimeout(t));
    flipTimers.length = 0;
  }

  function clearFixSequenceTimers() {
    fixSequenceTimers.forEach((t) => window.clearTimeout(t));
    fixSequenceTimers.length = 0;
  }

  function clearFixTimer() {
    if (fixTimer !== null) {
      window.clearTimeout(fixTimer);
      fixTimer = null;
    }
  }

  function clearStateResetTimer() {
    if (stateResetTimer !== null) {
      window.clearTimeout(stateResetTimer);
      stateResetTimer = null;
    }
  }

  // Slot-machine the date through a few scrambled values before landing on the
  // final value. Sells the "scrubbing through time" feel.
  function spinTo(el: HTMLElement, finalText: string, scramble: (s: string) => string) {
    const original = el.dataset.original ?? '';
    for (let i = 0; i < ROULETTE_STEPS; i++) {
      const at = (i + 1) * ROULETTE_INTERVAL_MS;
      flipTimers.push(window.setTimeout(() => { el.textContent = scramble(original); }, at));
    }
    flipTimers.push(
      window.setTimeout(() => { el.textContent = finalText; }, (ROULETTE_STEPS + 1) * ROULETTE_INTERVAL_MS)
    );
  }

  function snapTo(el: HTMLElement, finalText: string) {
    el.textContent = finalText;
  }

  // Drives the visual flip: flash overlay, date scramble, theme swap. Passing
  // `targetEra: null` reverts to the present (original text + no era class).
  // Idempotent — rapid successive calls re-trigger the flash and scramble
  // (we restart the CSS animation by removing + re-adding the class with a
  // forced reflow in between).
  function flip(targetEra: Era | null) {
    clearFlipTimers();

    const reduced = prefersReducedMotion();
    if (!reduced) {
      body.classList.remove('is-time-warping');
      void body.offsetWidth;
      body.classList.add('is-time-warping');
    }
    playTimeWarp();

    const cfg = targetEra ? ERA_CONFIGS[targetEra] : null;
    metas.forEach((el, slot) => {
      const original = el.dataset.original ?? '';
      const target = cfg ? cfg.transform(original, slot) : original;
      const scramble = cfg ? cfg.scramble : (s: string) => s;
      if (reduced) snapTo(el, target);
      else spinTo(el, target, scramble);
    });

    const flipTheme = () => {
      removeAllEraClasses(body);
      if (cfg) body.classList.add(cfg.bodyClass);
      applyEraDecor(targetEra);
      currentEra = targetEra;
    };
    if (reduced) {
      flipTheme();
    } else {
      flipTimers.push(window.setTimeout(flipTheme, THEME_FLIP_DELAY_MS));
      flipTimers.push(
        window.setTimeout(() => {
          body.classList.remove('is-time-warping');
        }, FLASH_DURATION_MS)
      );
    }
  }

  // Avatar arrives at the click point → core fix gesture plays out fully →
  // un-warp fires as the core completes → exit. Advances eraIndex on completion.
  function runFix(clickX: number, clickY: number) {
    clearFixTimer();
    clearFixSequenceTimers();
    clearStateResetTimer();
    state = 'fixing';
    avatar.reset();
    placeAvatarAt(avatarEl, clickX, clickY);

    // Use the era we warped INTO for sprite selection — that's the era Tim is
    // arriving in. currentEra is set by flip() and is non-null in this branch.
    const cfg = currentEra ? ERA_CONFIGS[currentEra] : ERA_CONFIGS['90s'];
    const arrival = pickRandom(cfg.arrivals);
    const exit = pickRandom(cfg.exits);
    const core = cfg.core;

    const T_CORE_START = arrival.durationMs + ARRIVAL_TO_CORE_MS;
    const T_CORE_END = T_CORE_START + core.durationMs;
    const T_EXIT_START = T_CORE_END + CORE_TO_EXIT_MS;
    const T_DONE = T_EXIT_START + exit.durationMs + AVATAR_FADE_MS;

    avatar.startArrival(arrival);
    avatar.scheduleCore(core, T_CORE_START);
    avatar.scheduleExit(exit, T_EXIT_START);

    // Un-warp at the end of the core — audience watches the full fix gesture,
    // THEN the page snaps back. The flash overlaps the held standing pose
    // between core and exit.
    fixSequenceTimers.push(window.setTimeout(() => flip(null), T_CORE_END));
    stateResetTimer = window.setTimeout(() => {
      state = 'dormant';
      currentEraIndex = -1;
      stateResetTimer = null;
    }, T_DONE);
  }

  function scheduleAutoFix(clickX: number, clickY: number) {
    clearFixTimer();
    pendingClickX = clickX;
    pendingClickY = clickY;
    fixTimer = window.setTimeout(() => runFix(pendingClickX, pendingClickY), FIX_DELAY_MS);
  }

  metas.forEach((el) => {
    el.addEventListener('click', (e) => {
      const lastIndex = ERA_SEQUENCE.length - 1;

      if (prefersReducedMotion()) {
        // Reduced-motion: no avatar, no auto-fix. Each click steps further
        // back; clicking at dino toggles back to present so user isn't stuck.
        if (state === 'fixing') return;
        if (currentEraIndex === lastIndex) {
          flip(null);
          currentEraIndex = -1;
          state = 'dormant';
        } else {
          currentEraIndex += 1;
          flip(ERA_SEQUENCE[currentEraIndex]);
          state = 'warped';
        }
        return;
      }

      if (state === 'fixing') return;

      if (state === 'dormant') {
        currentEraIndex = 0;
        flip(ERA_SEQUENCE[0]);
        state = 'warped';
        scheduleAutoFix(e.clientX, e.clientY);
        return;
      }

      // state === 'warped'
      if (currentEraIndex >= lastIndex) {
        // At dino — clicks do nothing. Tim's auto-fix timer is still running
        // from the last advance, so the page will recover on its own.
        return;
      }
      currentEraIndex += 1;
      flip(ERA_SEQUENCE[currentEraIndex]);
      scheduleAutoFix(e.clientX, e.clientY);
    });
  });
}
