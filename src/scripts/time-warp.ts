import { playTimeWarp } from './audio';

// 90s time-warp Easter egg. Click any date range (`.resume-meta`) → page
// glitches back to the Netscape era: body.era-90s reskins to grey + Times
// New Roman, and every year on the page shifts back 30 years. Click any
// date again to return. The shift is purely visual; originals are stashed
// in dataset.original and restored on exit, so no resume info is lost.

const YEAR_SHIFT = 30;
const ROULETTE_STEPS = 4;
const ROULETTE_INTERVAL_MS = 70;
const FLASH_DURATION_MS = 500;
// Class flip lands during the dark trough of the flash so the swap is hidden.
const THEME_FLIP_DELAY_MS = 140;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function shiftYears(text: string, delta: number): string {
  return text.replace(/(?:19|20)\d{2}/g, (m) => String(parseInt(m, 10) + delta));
}

function randomizeYears(text: string): string {
  return text.replace(/(?:19|20)\d{2}/g, () => String(1970 + Math.floor(Math.random() * 61)));
}

const MARQUEE_TEXT =
  "★ Welcome to Tim Frey's Homepage ★ Last updated 03/15/95 ★ You are visitor #00042 ★ Sign my guestbook! ★";

type Button =
  | { variant: string; image: true }
  | { variant: string; title: string; sub: string };

const BUTTONS: ReadonlyArray<Button> = [
  { variant: 'netscape', image: true },
  { variant: 'ie',       image: true },
  { variant: 'html',     title: 'HTML 3.2',  sub: 'COMPLIANT' },
  { variant: 'res',      title: '800 × 600', sub: 'BEST VIEWED' },
];

// All 90s-only DOM lives outside the resume so the static markup stays clean
// when the egg is dormant. CSS hides everything unless body.era-90s.
function ensure90sDecor() {
  if (document.querySelector('.era-90s-marquee')) return;

  const construction = document.createElement('div');
  construction.className = 'era-90s-construction';
  construction.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'UNDER CONSTRUCTION';
  construction.appendChild(label);
  document.body.appendChild(construction);

  const buttons = document.createElement('div');
  buttons.className = 'era-90s-buttons';
  buttons.setAttribute('aria-hidden', 'true');
  for (const b of BUTTONS) {
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

  const bar = document.createElement('div');
  bar.className = 'era-90s-marquee';
  bar.setAttribute('aria-hidden', 'true');
  const span = document.createElement('span');
  span.textContent = MARQUEE_TEXT;
  bar.appendChild(span);
  document.body.appendChild(bar);
}

export function initTimeWarp() {
  const metas = Array.from(document.querySelectorAll<HTMLElement>('.resume-meta'));
  if (metas.length === 0) return;

  ensure90sDecor();

  // Stash originals up front so the regex never operates on already-shifted text.
  metas.forEach((el) => {
    if (el.dataset.original === undefined) el.dataset.original = el.textContent ?? '';
  });

  const body = document.body;
  let busy = false;
  const timers: number[] = [];

  function clearTimers() {
    timers.forEach((t) => window.clearTimeout(t));
    timers.length = 0;
  }

  // Slot-machine a date through a few random years before landing on the
  // final value. Sells the "scrubbing through time" feel.
  function spinTo(el: HTMLElement, finalText: string) {
    const original = el.dataset.original ?? '';
    for (let i = 0; i < ROULETTE_STEPS; i++) {
      const at = (i + 1) * ROULETTE_INTERVAL_MS;
      timers.push(window.setTimeout(() => { el.textContent = randomizeYears(original); }, at));
    }
    timers.push(
      window.setTimeout(() => { el.textContent = finalText; }, (ROULETTE_STEPS + 1) * ROULETTE_INTERVAL_MS)
    );
  }

  function snapTo(el: HTMLElement, finalText: string) {
    el.textContent = finalText;
  }

  function transition(toEra90s: boolean) {
    if (busy) return;
    busy = true;
    clearTimers();

    const reduced = prefersReducedMotion();
    if (!reduced) body.classList.add('is-time-warping');
    playTimeWarp();

    metas.forEach((el) => {
      const original = el.dataset.original ?? '';
      const target = toEra90s ? shiftYears(original, -YEAR_SHIFT) : original;
      if (reduced) snapTo(el, target);
      else spinTo(el, target);
    });

    const flipTheme = () => body.classList.toggle('era-90s', toEra90s);
    if (reduced) {
      flipTheme();
      busy = false;
    } else {
      timers.push(window.setTimeout(flipTheme, THEME_FLIP_DELAY_MS));
      timers.push(
        window.setTimeout(() => {
          body.classList.remove('is-time-warping');
          busy = false;
        }, FLASH_DURATION_MS)
      );
    }
  }

  metas.forEach((el) => {
    el.addEventListener('click', () => {
      transition(!body.classList.contains('era-90s'));
    });
  });
}
