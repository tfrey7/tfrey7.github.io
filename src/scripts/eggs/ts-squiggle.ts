// Click "TypeScript" in the Technical Skills row → a red wavy underline
// appears under the word and a VS Code–style inline diagnostic slides in
// below it. A quick-fix lightbulb auto-fires, the squiggle clears, and a
// brief green ✓ flashes next to the word. Total play ~2.2s.
//
// The popover is positioned absolutely against the document so it never
// nudges resume text. The squiggle uses text-decoration so it lives inside
// the word's own bounding box.

import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

const LOCK_ID = 'ts-squiggle';

// Lifecycle. The popover settles in fast, the lightbulb pulses briefly,
// then a "quick fix" auto-applies and everything tears down.
const POPOVER_IN_DELAY_MS = 40;
const QUICK_FIX_AT_MS = 2200;
const SQUIGGLE_CLEAR_AT_MS = 2900;
const TOTAL_MS = 3600;

export function initTsSquiggle() {
  const target = findTypeScriptSpan();
  if (!target) return;

  target.classList.add('ts-trigger');

  target.addEventListener('click', () => {
    if (!tryStart(LOCK_ID)) return;
    markDiscovered('ts-squiggle');
    play(target);
  });
}

// Match by text rather than a special class so the resume markup stays
// generic — every Languages item is a plain .skill-item. The label spans
// (e.g. "Languages:") share the class but never match this exact text.
function findTypeScriptSpan(): HTMLElement | null {
  const items = document.querySelectorAll<HTMLElement>(
    '.skills-stage .skill-item',
  );
  for (const el of items) {
    if (el.textContent?.trim() === 'TypeScript') return el;
  }
  return null;
}

function play(target: HTMLElement) {
  target.classList.add('is-ts-erroring');

  const popover = buildPopover(target);
  document.body.appendChild(popover);

  window.setTimeout(() => popover.classList.add('is-visible'), POPOVER_IN_DELAY_MS);
  window.setTimeout(() => popover.classList.add('is-fixing'), QUICK_FIX_AT_MS);

  window.setTimeout(() => {
    target.classList.remove('is-ts-erroring');
    target.classList.add('is-ts-fixed');
    popover.classList.remove('is-visible');
    popover.classList.add('is-resolved');
  }, SQUIGGLE_CLEAR_AT_MS);

  window.setTimeout(() => {
    target.classList.remove('is-ts-fixed');
    popover.remove();
    end(LOCK_ID);
  }, TOTAL_MS);
}

function buildPopover(target: HTMLElement): HTMLDivElement {
  const rect = target.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.className = 'ts-popover';
  popover.style.left = `${rect.left + window.scrollX}px`;
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popover.innerHTML = `
    <div class="ts-popover-row ts-popover-error">
      <span class="ts-popover-icon" aria-hidden="true">⛔</span>
      <span class="ts-popover-text"><span class="ts-popover-code">ts(2741)</span> Property 'experience' is missing in type 'TypeScript'.</span>
    </div>
    <div class="ts-popover-row ts-popover-fix">
      <span class="ts-popover-bulb" aria-hidden="true">💡</span>
      <span class="ts-popover-text">Quick Fix: Add 16 years experience</span>
    </div>
  `;
  return popover;
}
