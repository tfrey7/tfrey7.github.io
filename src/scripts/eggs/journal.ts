// Journal Easter egg. A clipboard that lives at the bottom of the viewport
// once it appears. Two states:
//   - tucked: most of the clipboard sits below the fold; only the metal clip
//     and the top strip of paper show (the title "App Review" etc).
//   - open: the clipboard slides up so the full checklist is on screen.
//
// Clicking the visible portion in the tucked state expands it; clicking the
// clip again (or pressing J / Esc) tucks it back. Unlike the old modal
// version there is NO backdrop — the page underneath stays interactive, so
// eggs can be discovered while the clipboard is open and new checkmarks
// land in real time.
//
// First appearance is gated on the user's first egg discovery: a recruiter
// who never pokes at the page never sees a clipboard. Returning visitors
// with prior discoveries see it on load. Power users can also surface it
// any time with the J key.
//
// Discovery state is loaded from / saved to localStorage by lib/discoveries,
// so a returning visitor's checklist is restored.

import {
  clearDiscoveries,
  getDiscovered,
  onDiscoveryChange,
} from '../lib/discoveries';
import { hasHint, hintFor } from '../lib/hint';
import { startSnakeDrawMode } from './draw-snake';
import { REGISTRY } from './manifest';

// How long to wait after the user clicks a locked journal item before
// firing the page glow — long enough for the tuck transition to mostly
// finish (420ms in CSS) so the glow lands on a visible page, not a
// half-overlapped clipboard.
const HINT_FROM_JOURNAL_DELAY_MS = 360;

// After the user's first discovery, wait a beat before the clipboard slides
// in so the egg's own animation has the spotlight first — otherwise the two
// motions compete at the exact moment of the gag.
const FIRST_REVEAL_DELAY_MS = 900;

let _open = false;
let panelEl: HTMLElement | null = null;
let unsubscribeFirstReveal: (() => void) | null = null;

export function isJournalOpen(): boolean {
  return _open;
}

export function initJournal() {
  injectStampFilter();

  function render() {
    if (!panelEl) return;
    const discovered = getDiscovered();
    const total = REGISTRY.length;
    const found = REGISTRY.reduce(
      (n, entry) => n + (discovered.has(entry.id) ? 1 : 0),
      0,
    );

    const items = REGISTRY.map((entry) => {
      const isFound = discovered.has(entry.id);
      const checkbox = isFound
        ? `<span class="journal-check journal-check--found" aria-hidden="true">✓</span>`
        : `<span class="journal-check" aria-hidden="true"></span>`;
      const label = isFound
        ? `<span class="journal-label">${escapeHtml(entry.label)}</span>`
        : `<span class="journal-label journal-label--locked">??? &mdash; ${escapeHtml(entry.hint)}</span>`;
      // Locked rows that have a DOM trigger we can glow become real
      // <button>s — keyboard users get Tab focus + Enter/Space, mouse users
      // get a cursor + hover state. Rows whose hint is keyboard-only (snake)
      // or has no DOM target stay as plain text so the cursor doesn't lie
      // about being clickable.
      const inner = `${checkbox}${label}`;
      const isHintable = !isFound && hasHint(entry.id);
      const body = isHintable
        ? `<button type="button" class="journal-item-btn">${inner}</button>`
        : inner;
      return `<li class="journal-item${isFound ? ' is-found' : ''}" data-egg-id="${escapeHtml(entry.id)}">${body}</li>`;
    }).join('');

    // Once every entry is ticked off, the interviewer slaps a red HIRED
    // stamp across the form. The `is-complete` class on the paper dims the
    // form content so the stamp dominates ("case closed" feel).
    const complete = found === total;
    const stamp = complete
      ? `<div class="journal-stamp" aria-hidden="true">Hired</div>`
      : '';
    // Only render "Clear notes" when there's something to erase — otherwise
    // it reads as a confusing no-op on a brand-new clipboard.
    const clearBtn =
      found > 0
        ? `<button type="button" class="journal-clear-btn">Clear notes</button>`
        : '';

    // The clip is a real <button> so it carries keyboard semantics — Tab
    // lands on it, Enter/Space toggles. aria-expanded reflects state.
    const clipLabel = _open ? 'Tuck app review away' : 'Open app review';
    // Pencil resting at the bottom-right of the clipboard, angled like a
    // right-handed grip: tip on the left of the SVG, eraser on the right,
    // and the CSS rotate(+22deg) tilts the tip up-toward-the-paper while
    // the eraser end overhangs the bottom-right corner. Click launches
    // the snake-drawing minigame.
    const pencil =
      `<button type="button" class="journal-pencil" aria-label="Sketch a snake">` +
        `<svg viewBox="0 0 160 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
          `<polygon points="0,7 4,5 4,9" fill="#2a2a2a"/>` +
          `<polygon points="4,5 14,0 14,14 4,9" fill="#e8c896"/>` +
          `<polygon points="4,5 14,0 14,5" fill="#f4e0b4"/>` +
          `<polygon points="4,9 14,9 14,14" fill="#c8a070"/>` +
          `<rect x="14" y="0" width="126" height="14" fill="#f0b91c"/>` +
          `<rect x="14" y="0" width="126" height="2" fill="#f7d05e"/>` +
          `<rect x="14" y="12" width="126" height="2" fill="#c08810"/>` +
          `<rect x="140" y="0" width="8" height="14" fill="#c8a04c"/>` +
          `<rect x="140" y="0" width="8" height="2" fill="#e0bf6c"/>` +
          `<rect x="140" y="4" width="8" height="1" fill="#7a5a20"/>` +
          `<rect x="140" y="8" width="8" height="1" fill="#7a5a20"/>` +
          `<rect x="140" y="12" width="8" height="2" fill="#a88030"/>` +
          `<rect x="148" y="0" width="12" height="14" rx="2" fill="#e25b4a"/>` +
          `<rect x="148" y="0" width="12" height="3" fill="#f08075"/>` +
        `</svg>` +
      `</button>`;
    panelEl.innerHTML =
      `<button type="button" class="journal-clip" aria-label="${clipLabel}" aria-expanded="${_open}"></button>` +
      pencil +
      `<div class="journal-paper${complete ? ' is-complete' : ''}">` +
        `<h2 id="journal-title" class="journal-title">App Review</h2>` +
        `<p class="journal-candidate">Candidate: <span>Tim Frey</span></p>` +
        `<p class="journal-count">${found} / ${total} noted</p>` +
        `<ul class="journal-list">${items}</ul>` +
        `<div class="journal-actions">${clearBtn}</div>` +
        `<p class="journal-footer">[ Press J or Esc to tuck ]</p>` +
        stamp +
      `</div>`;
  }

  // Update only the clip's aria state on toggle — avoids a full innerHTML
  // re-render that would replay the HIRED-stamp drop animation each time
  // the user expands or tucks.
  function syncClipAria() {
    if (!panelEl) return;
    const clip = panelEl.querySelector('.journal-clip');
    if (!clip) return;
    clip.setAttribute('aria-expanded', String(_open));
    clip.setAttribute(
      'aria-label',
      _open ? 'Tuck app review away' : 'Open app review',
    );
  }

  function expand() {
    if (_open || !panelEl) return;
    _open = true;
    panelEl.classList.remove('is-tucked');
    panelEl.classList.add('is-open');
    syncClipAria();
  }

  function tuck() {
    if (!_open || !panelEl) return;
    _open = false;
    panelEl.classList.remove('is-open');
    panelEl.classList.add('is-tucked');
    syncClipAria();
  }

  function toggle() {
    if (_open) tuck();
    else expand();
  }

  function showHint(id: string) {
    // Always tuck before firing — even if already tucked, we still want
    // the small delay so the visual sequence reads as "panel out of the
    // way → look at the page" rather than a simultaneous double-event.
    tuck();
    window.setTimeout(() => hintFor(id), HINT_FROM_JOURNAL_DELAY_MS);
  }

  function mount() {
    if (panelEl) return;
    // Mounting wins over any pending first-reveal subscription — drop it so
    // a later discovery doesn't try to schedule a redundant mount.
    if (unsubscribeFirstReveal) {
      unsubscribeFirstReveal();
      unsubscribeFirstReveal = null;
    }
    const el = document.createElement('div');
    el.className = 'journal-panel';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'App review');
    panelEl = el;
    render();
    document.body.appendChild(el);

    // Force reflow so the off-screen-below starting position paints before
    // we add .is-tucked, which transitions up into the tucked anchor.
    void el.offsetWidth;
    el.classList.add('is-tucked');

    // One delegated click handler covers every interactive child:
    //   - clear button: wipe discoveries (no toggle)
    //   - clip: always toggles
    //   - locked journal-item: tuck the panel, then glow the page trigger
    //     so the user knows where to click (the journal's hint text told
    //     them "what"; this shows them "where")
    //   - already-found journal-item: no-op (the egg is done)
    //   - anywhere else while tucked: toggles, since the visible strip is
    //     too small to require aiming at the clip
    //   - anywhere else while open: ignored (it's readable content)
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.journal-clear-btn')) {
        clearDiscoveries();
        return;
      }
      if (t && t.closest('.journal-clip')) {
        toggle();
        return;
      }
      if (t && t.closest('.journal-pencil')) {
        // Get the clipboard out of the way before the drawing overlay fades
        // in — otherwise the open panel peeks around the drawing frame.
        if (_open) {
          tuck();
          window.setTimeout(() => startSnakeDrawMode(), 240);
        } else {
          startSnakeDrawMode();
        }
        return;
      }
      const btn = t?.closest<HTMLElement>('.journal-item-btn');
      if (btn) {
        const id = btn.closest<HTMLElement>('.journal-item')?.dataset.eggId;
        if (id) showHint(id);
        return;
      }
      if (!_open) toggle();
    });

    onDiscoveryChange(() => {
      render();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) {
      e.preventDefault();
      tuck();
      return;
    }
    if (e.key !== 'j' && e.key !== 'J') return;
    // Don't hijack browser shortcuts (Cmd+J downloads, Alt+J, etc.) or J
    // while typing somewhere editable.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && isEditable(target)) return;
    e.preventDefault();
    // J before any discovery still mounts the journal (then opens it) —
    // power users get an escape hatch into the checklist without having
    // to trigger an egg first.
    if (!panelEl) {
      mount();
      expand();
      return;
    }
    toggle();
  });

  // Returning visitor with prior progress: surface the journal right away
  // so they can see (and resume) their checklist. A fresh visitor with no
  // discoveries gets nothing on the page until they trip an egg — then the
  // clipboard slides up from below as the reveal.
  if (getDiscovered().size > 0) {
    mount();
  } else {
    unsubscribeFirstReveal = onDiscoveryChange(() => {
      if (getDiscovered().size === 0) return;
      // Drop the listener immediately so a flurry of discoveries can't
      // queue multiple mount timers. mount() is idempotent regardless.
      if (unsubscribeFirstReveal) {
        unsubscribeFirstReveal();
        unsubscribeFirstReveal = null;
      }
      window.setTimeout(() => mount(), FIRST_REVEAL_DELAY_MS);
    });
  }
}

function isEditable(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

// Hidden SVG holding the displacement filter the HIRED stamp references via
// `filter: url(#journal-stamp-distress)`. Two passes:
//   1. Fine fractal-noise displacement roughens every edge (border + text)
//      so nothing reads as printer-perfect.
//   2. Coarser noise punches small alpha holes so the ink looks like it
//      didn't fully transfer in places — the giveaway of a real stamp.
// Injected once per session; safe to reference from CSS as soon as it's in
// the document. Lives outside the journal panel so it survives close/reopen.
let stampFilterInjected = false;
function injectStampFilter(): void {
  if (stampFilterInjected) return;
  stampFilterInjected = true;
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.position = 'absolute';
  wrap.style.width = '0';
  wrap.style.height = '0';
  wrap.style.overflow = 'hidden';
  wrap.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" focusable="false">` +
      `<defs>` +
        `<filter id="journal-stamp-distress" x="-10%" y="-10%" width="120%" height="120%">` +
          // Edge jitter — fractal noise drives a displacement map so the
          // border and letterforms wobble slightly, like rubber pressed
          // unevenly into paper.
          `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="edgeNoise"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale="2.6" result="displaced"/>` +
          // Patchy ink — coarser noise, thresholded into a 1-bit mask. We
          // keep mostly-opaque areas (high noise → keep) and let the rest
          // punch through, giving the look of ink that didn't fully take.
          `<feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="1" seed="7" result="patchNoise"/>` +
          `<feComponentTransfer in="patchNoise" result="patchMask">` +
            `<feFuncA type="table" tableValues="0 0 0 1 1 1"/>` +
          `</feComponentTransfer>` +
          `<feComposite in="displaced" in2="patchMask" operator="in"/>` +
        `</filter>` +
      `</defs>` +
    `</svg>`;
  document.body.appendChild(wrap);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
