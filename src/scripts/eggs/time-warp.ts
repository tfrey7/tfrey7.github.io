import { playTimeWarp } from '../lib/audio';
import {
  AVATAR_FADE_MS,
  type AvatarAnim,
  createAvatarController,
  pickRandom,
} from '../lib/avatar';
import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';
import { hideJournal, peekJournal } from './journal';

const LOCK_ID = 'time-warp';

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

// Each era has its own Tim sprite — canonical body and green flannel, with an
// era-specific accessory (90s hair, 80s aviators+sweatband, 60s horn-rims, west
// cowboy hat, dino bone necklace + fur shawl). Arrivals and exits are also
// per-era so the accessory tracks across the whole appearance.
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

const ARRIVALS_80S: AvatarAnim[] = [
  { sprite: '/sprites/tim-80s/arrivals/vhs-static-arrival.png', durationMs: 1100 },
];
const EXITS_80S: AvatarAnim[] = [
  { sprite: '/sprites/tim-80s/exits/vhs-rewind-departure.png', durationMs: 1100 },
];
const CORE_80S: AvatarAnim = {
  sprite: '/sprites/tim-80s/cores/hammer-fix.png',
  durationMs: 1500,
};

const ARRIVALS_60S: AvatarAnim[] = [
  { sprite: '/sprites/tim-60s/arrivals/punch-card-arrival.png', durationMs: 1100 },
];
const EXITS_60S: AvatarAnim[] = [
  { sprite: '/sprites/tim-60s/exits/punch-card-departure.png', durationMs: 1100 },
];
const CORE_60S: AvatarAnim = {
  sprite: '/sprites/tim-60s/cores/hammer-fix.png',
  durationMs: 1500,
};

const ARRIVALS_WEST: AvatarAnim[] = [
  { sprite: '/sprites/tim-west/arrivals/tumbleweed-arrival.png', durationMs: 1100 },
];
const EXITS_WEST: AvatarAnim[] = [
  { sprite: '/sprites/tim-west/exits/tumbleweed-departure.png', durationMs: 1100 },
];
const CORE_WEST: AvatarAnim = {
  sprite: '/sprites/tim-west/cores/hammer-fix.png',
  durationMs: 1500,
};

const ARRIVALS_DINO: AvatarAnim[] = [
  { sprite: '/sprites/tim-dino/arrivals/meteor-arrival.png', durationMs: 1100 },
];
const EXITS_DINO: AvatarAnim[] = [
  { sprite: '/sprites/tim-dino/exits/volcano-departure.png', durationMs: 1100 },
];
const CORE_DINO: AvatarAnim = {
  sprite: '/sprites/tim-dino/cores/hammer-fix.png',
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

interface EraConfig {
  bodyClass: string;
  marquee: string;
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
    marquee: '> CONNECT 2400 BAUD ▌ LOGIN: TFREY ▌ ACCESS GRANTED ▌ LOADING PROFILE.DAT ▌ PARSING RECORDS... ▌ EOF',
    bottomBanner: 'IBM PC/AT · DOS 2.11 · 640K RAM · READY_',
    arrivals: ARRIVALS_80S,
    exits: EXITS_80S,
    core: CORE_80S,
    transform: (orig) => shiftYears(orig, -40),
    scramble: scrambleNumeric,
  },
  '60s': {
    bodyClass: 'era-60s',
    marquee: '▌ JOB 0742 ▌ IBM SYSTEM/360 MODEL 65 ▌ BATCH COMPLETE ▌ RUN TIME 00:04:17 ▌ PAGES 0001 ▌ EOJ ▌',
    bottomBanner: 'IBM 1403 LINE PRINTER · JOB 0742 · PAGE 0001 OF 0001',
    arrivals: ARRIVALS_60S,
    exits: EXITS_60S,
    core: CORE_60S,
    transform: (orig) => shiftYears(orig, -60),
    scramble: scrambleNumeric,
  },
  west: {
    bodyClass: 'era-west',
    marquee: '★ WANTED ★ FOR DEEDS OF EXCELLENT CODE ★ REWARD: $500 IN GOLD ★ INQUIRE AT THE SALOON ★',
    bottomBanner: 'TELEGRAPH THE OFFICE OF MR. FREY',
    arrivals: ARRIVALS_WEST,
    exits: EXITS_WEST,
    core: CORE_WEST,
    transform: (orig, slot) => phraseDates(orig, 'the Present Day', WESTERN_DATES, slot),
    scramble: (orig) => scramblePhrase(orig, 'the Present Day', WESTERN_DATES),
  },
  dino: {
    bodyClass: 'era-dino',
    marquee: '◆ UGH ROCK ◆ TIM HUNT BUG ◆ FIRE GOOD ◆ STACK TRACE IN CAVE ◆ ROAR ◆',
    bottomBanner: 'PAINTED IN OCHRE · LATE CRETACEOUS',
    arrivals: ARRIVALS_DINO,
    exits: EXITS_DINO,
    core: CORE_DINO,
    transform: (orig, slot) => phraseDates(orig, 'Now', DINO_ERAS, slot),
    scramble: (orig) => scramblePhrase(orig, 'Now', DINO_ERAS),
  },
};

// Dino-era scenery: cave-painting silhouettes (palms, volcano, brontosaurus,
// pterodactyl). One palm SVG is used for both sides — the right copy is flipped
// via CSS transform. Shapes fill via currentColor so era CSS controls the
// palette; volcano lava and smoke are styled separately by class.
const DINO_PALM_INNER =
  `<g fill="currentColor">` +
  `<path d="M 82 600 C 92 560 76 510 88 460 C 96 410 80 360 90 300 C 96 250 80 200 90 160 L 110 160 C 120 200 104 250 110 300 C 120 360 104 410 112 460 C 124 510 108 560 118 600 Z" />` +
  `<path d="M 102 165 C 145 158 178 175 198 215 C 168 192 130 178 100 168 Z" />` +
  `<path d="M 100 165 C 57 158 24 175 4 215 C 34 192 72 178 102 168 Z" />` +
  `<path d="M 102 162 C 150 142 178 110 196 70 C 168 110 130 150 100 168 Z" />` +
  `<path d="M 100 162 C 52 142 24 110 6 70 C 34 110 72 150 102 168 Z" />` +
  `<path d="M 103 160 C 125 110 132 60 132 10 C 118 60 105 130 100 165 Z" />` +
  `<path d="M 99 160 C 77 110 70 60 70 10 C 84 60 97 130 102 165 Z" />` +
  `<path d="M 101 160 C 100 110 100 60 101 5 C 102 60 102 110 101 165 Z" />` +
  `<circle cx="96" cy="178" r="5" />` +
  `<circle cx="108" cy="175" r="5" />` +
  `<circle cx="94" cy="170" r="4" />` +
  `</g>`;

// Volcano body is now a Lascaux-fresco PNG. The animation layer (crater
// glow, lava bombs, smoke) lives in an overlay SVG positioned identically.
// viewBox is 480×480 matching the PNG's natural pixel space; crater notch
// in the PNG lands at approximately (210, 100) with the V-dip at (210, 140).
const DINO_VOLCANO_FX =
  `<ellipse class="dino-crater-glow" cx="210" cy="135" rx="22" ry="13" />` +
  `<g class="dino-lava-bombs">` +
  `<circle class="lb1" cx="210" cy="108" r="6" />` +
  `<circle class="lb2" cx="210" cy="108" r="5" />` +
  `<circle class="lb3" cx="210" cy="108" r="7" />` +
  `</g>` +
  `<g class="dino-smoke">` +
  `<ellipse class="s1" cx="205" cy="72" rx="22" ry="13" />` +
  `<ellipse class="s2" cx="225" cy="44" rx="18" ry="11" />` +
  `<ellipse class="s3" cx="200" cy="20" rx="20" ry="10" />` +
  `</g>`;

// Bronto, ptero, and stego are now raster cave-fresco PNGs (gpt-image-1).
// The hand-coded SVGs read as cheap geometric silhouettes; the PNGs carry
// pigment texture and warmth. Volcano + palms + mountains stay SVG so the
// volcano animations (crater glow, lava bombs) overlay cleanly.

// Distant mountain horizon — full-width irregular ridgeline, stretched via
// preserveAspectRatio="none". Lives behind everything at very low opacity.
const DINO_MOUNTAINS_INNER =
  `<g fill="currentColor">` +
  `<path d="M 0 200 L 0 132 L 68 78 L 122 112 L 178 48 L 250 104 L 298 72 L 360 122 L 422 60 L 494 104 L 562 38 L 642 114 L 702 80 L 774 130 L 840 58 L 922 112 L 1000 70 L 1000 200 Z" />` +
  `</g>`;

// DOM order = depth order (later = on top). Volcano is deepest, mountain
// horizon cuts across in front of it, then palms, then ground-plane dinos,
// then ptero overhead.
const DINO_DECOR_HTML =
  `<div class="dino-decor-volcano" aria-hidden="true">` +
    `<img class="dino-volcano-img" src="/dino-decor/volcano.png" alt="" />` +
    `<svg viewBox="0 0 480 480" preserveAspectRatio="none" class="dino-volcano-fx">${DINO_VOLCANO_FX}</svg>` +
  `</div>` +
  `<svg viewBox="0 0 1000 200" preserveAspectRatio="none" class="dino-decor-mountains" aria-hidden="true">${DINO_MOUNTAINS_INNER}</svg>` +
  `<svg viewBox="0 0 200 600" class="dino-decor-palm dino-decor-palm--left" aria-hidden="true">${DINO_PALM_INNER}</svg>` +
  `<svg viewBox="0 0 200 600" class="dino-decor-palm dino-decor-palm--right" aria-hidden="true">${DINO_PALM_INNER}</svg>` +
  `<img class="dino-decor-bronto" src="/dino-decor/bronto.png" alt="" aria-hidden="true" />` +
  `<img class="dino-decor-stego" src="/dino-decor/stego.png" alt="" aria-hidden="true" />` +
  `<img class="dino-decor-ptero" src="/dino-decor/ptero.png" alt="" aria-hidden="true" />`;

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

// Inline-SVG vintage clock face: brass bezel, parchment face with radial
// gradient, Roman numerals, hour-tick marks, tapered spear hands. Static
// markup; the hands rotate via CSS, so the whole asset is GPU-cheap.
function buildWarpClock(): HTMLElement {
  const clock = document.createElement('div');
  clock.className = 'warp-clock';
  clock.setAttribute('aria-hidden', 'true');

  // Roman numerals on a r=32 ring around (50, 50); XII top, III right.
  const numerals: Array<[string, number, number]> = [
    ['XII',  50.0, 19.0],
    ['I',    64.6, 22.9],
    ['II',   76.1, 34.4],
    ['III',  80.0, 50.0],
    ['IV',   76.1, 65.6],
    ['V',    64.6, 77.1],
    ['VI',   50.0, 81.0],
    ['VII',  35.4, 77.1],
    ['VIII', 23.9, 65.6],
    ['IX',   20.0, 50.0],
    ['X',    23.9, 34.4],
    ['XI',   35.4, 22.9],
  ];
  const numeralText = numerals
    .map(([n, x, y]) => `<text x="${x}" y="${y}">${n}</text>`)
    .join('');

  // 12 hour-tick bars at 30° intervals, drawn as one path.
  const ticks: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const s = Math.sin(a);
    const c = -Math.cos(a);
    const x1 = (50 + s * 37.5).toFixed(2);
    const y1 = (50 + c * 37.5).toFixed(2);
    const x2 = (50 + s * 41).toFixed(2);
    const y2 = (50 + c * 41).toFixed(2);
    ticks.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }

  clock.innerHTML = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="warp-clock-face-grad" cx="50%" cy="42%" r="60%">
          <stop offset="0%"   stop-color="#fbf2d9"/>
          <stop offset="80%"  stop-color="#ecdfba"/>
          <stop offset="100%" stop-color="#d8c896"/>
        </radialGradient>
        <linearGradient id="warp-clock-bezel-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#d6b070"/>
          <stop offset="50%"  stop-color="#8a6a3a"/>
          <stop offset="100%" stop-color="#5a4422"/>
        </linearGradient>
      </defs>

      <circle cx="50" cy="50" r="49"   fill="url(#warp-clock-bezel-grad)"/>
      <circle cx="50" cy="50" r="47"   fill="none" stroke="#fff0c0" stroke-width="0.4" opacity="0.6"/>
      <circle cx="50" cy="50" r="45"   fill="#3a2a18"/>
      <circle cx="50" cy="50" r="43.5" fill="none" stroke="#c4a468" stroke-width="0.4"/>
      <circle cx="50" cy="50" r="43"   fill="url(#warp-clock-face-grad)"/>

      <path d="${ticks.join(' ')}" stroke="#3a2a18" stroke-width="1.2" stroke-linecap="round" fill="none"/>

      <g font-family="'Times New Roman', Times, serif" font-weight="600" font-size="6.5" fill="#2a1c10" text-anchor="middle" dominant-baseline="central">
        ${numeralText}
      </g>

      <path class="warp-clock-hand warp-clock-hand--hour"
            d="M 50 50 L 47.8 28 L 50 22 L 52.2 28 Z"
            fill="#1a120a" stroke="#3a2a18" stroke-width="0.3" stroke-linejoin="round"/>
      <path class="warp-clock-hand warp-clock-hand--minute"
            d="M 50 50 L 48.7 14 L 50 9 L 51.3 14 Z"
            fill="#1a120a" stroke="#3a2a18" stroke-width="0.3" stroke-linejoin="round"/>

      <circle cx="50" cy="50" r="2.6" fill="#3a2a18"/>
      <circle cx="50" cy="50" r="1.4" fill="#c4a468"/>
      <circle cx="50" cy="50" r="0.5" fill="#1a120a"/>
    </svg>
  `;

  return clock;
}

// 90s gets its full webring + UNDER CONSTRUCTION caution tape. Other eras get
// the lighter bottom-banner / marquee pair. All decor lives outside the resume
// so the static markup stays clean when no era is active. Decor stays anchored
// to the viewport bottom so era changes never shift the resume content (and
// the dates the user is clicking) down the page.
function buildDecor(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('.timewarp-avatar');
  if (existing) return existing;

  // Clock lives as a sibling of <body> (child of <html>), NOT inside body.
  // body.is-time-warping applies `filter:` during the flash, which makes
  // body the containing block for its position:fixed descendants — so a
  // clock inside body would snap from viewport-anchored to body-anchored
  // (visibly jumping by scrollY) whenever the filter toggles. Outside
  // body, the clock's containing block is always the viewport.
  document.documentElement.appendChild(buildWarpClock());

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

  // Bottom banner — content swaps per era. Hidden via CSS unless an era class
  // is on the body (and the era's CSS opts the banner in).
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

  // Dino-only scenery. Lives in DOM permanently; CSS shows it only under
  // body.era-dino and hides it on narrow viewports where the side margins
  // aren't wide enough to host palms without crashing into the resume.
  const dinoDecor = document.createElement('div');
  dinoDecor.className = 'era-dino-decor';
  dinoDecor.setAttribute('aria-hidden', 'true');
  dinoDecor.innerHTML = DINO_DECOR_HTML;
  document.body.appendChild(dinoDecor);

  const avatarEl = document.createElement('div');
  avatarEl.className = 'timewarp-avatar';
  avatarEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(avatarEl);
  return avatarEl;
}

function applyEraDecor(era: Era | null) {
  const bottom = document.querySelector<HTMLElement>('.era-bottom-banner');
  const marquee = document.querySelector<HTMLElement>('.era-marquee > span');
  if (era === null) {
    if (bottom) bottom.textContent = '';
    if (marquee) marquee.textContent = '';
    return;
  }
  const cfg = ERA_CONFIGS[era];
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
  // Debounced hide for the clock overlay. Each flip() re-arms this; if no
  // new flip lands before it fires, the clock fades out.
  let clockFadeTimer: number | null = null;

  function clearFlipTimers() {
    flipTimers.forEach((t) => window.clearTimeout(t));
    flipTimers.length = 0;
  }

  function clearClockFadeTimer() {
    if (clockFadeTimer !== null) {
      window.clearTimeout(clockFadeTimer);
      clockFadeTimer = null;
    }
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

    // Park the journal fully off-screen while warped (the tucked-peek state
    // would still hover the clip + top strip over a 90s/dino theme, which
    // reads as jarring). On the un-warp landing (targetEra === null) we let
    // it slide back into its tucked peek.
    if (targetEra === null) peekJournal();
    else hideJournal();

    const reduced = prefersReducedMotion();
    if (!reduced) {
      body.classList.remove('is-time-warping');
      void body.offsetWidth;
      body.classList.add('is-time-warping');
    }
    // Higher index = further back in time. Going TO a higher index (or from
    // present into any era) is a back-whoosh; going TO a lower index (or back
    // to present) is the reversed whoosh.
    const fromIdx = currentEra ? ERA_SEQUENCE.indexOf(currentEra) : -1;
    const toIdx = targetEra ? ERA_SEQUENCE.indexOf(targetEra) : -1;
    const goingBack = toIdx > fromIdx;
    playTimeWarp(goingBack ? 'back' : 'forward');

    // Clock overlay: visible only during a warp transition. Re-armed on
    // every flip so a back-to-back sequence (rapid clicks, or Tim's
    // un-warp strobe through eras) keeps the clock up without re-popping.
    // After the trailing pause it fades out, so just sitting in an era
    // doesn't leave the clock floating. Hands run counter-clockwise when
    // traveling back in time, clockwise when un-warping toward the present.
    body.classList.toggle('time-warp-reverse', goingBack);
    body.classList.add('time-warp-active');
    clearClockFadeTimer();
    clockFadeTimer = window.setTimeout(() => {
      body.classList.remove('time-warp-active');
      clockFadeTimer = null;
    }, FLASH_DURATION_MS);

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

    // Un-warp is a fast-forward through each era between the current one and
    // present, evenly spaced across the core gesture. The final flip(null)
    // lands at T_CORE_END so the flash still overlaps the held standing pose
    // between core and exit. Single-era warps (90s) get one transition; deeper
    // warps (dino) strobe through 5.
    const stepsToTake = currentEraIndex + 1;
    const stepMs = core.durationMs / stepsToTake;
    for (let i = 0; i < stepsToTake; i++) {
      const nextIndex = currentEraIndex - 1 - i;
      const targetEra: Era | null = nextIndex < 0 ? null : ERA_SEQUENCE[nextIndex];
      const at = T_CORE_START + (i + 1) * stepMs;
      fixSequenceTimers.push(window.setTimeout(() => flip(targetEra), at));
    }
    stateResetTimer = window.setTimeout(() => {
      state = 'dormant';
      currentEraIndex = -1;
      stateResetTimer = null;
      end(LOCK_ID);
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
          end(LOCK_ID);
        } else {
          if (state === 'dormant' && !tryStart(LOCK_ID)) return;
          markDiscovered('time-warp');
          currentEraIndex += 1;
          flip(ERA_SEQUENCE[currentEraIndex]);
          state = 'warped';
        }
        return;
      }

      // Mid-fix click: dismiss Tim and let the user keep warping. If the
      // auto un-warp has already fired (currentEra is null), restart from
      // dormant; otherwise treat as still-warped at the current era.
      if (state === 'fixing') {
        clearFixTimer();
        clearFixSequenceTimers();
        clearStateResetTimer();
        avatar.reset();
        if (currentEra === null) {
          currentEraIndex = -1;
          state = 'dormant';
          end(LOCK_ID);
        } else {
          state = 'warped';
        }
      }

      if (state === 'dormant') {
        if (!tryStart(LOCK_ID)) return;
        markDiscovered('time-warp');
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
