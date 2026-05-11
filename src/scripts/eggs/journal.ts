// Journal Easter egg. Press J (like a Skyrim journal) to open a pixelated
// checklist of every other Easter egg on the page. Found items show their
// friendly name; undiscovered ones stay redacted with a vague nudge.
//
// The journal is a pure overlay — it does NOT hold the shared interaction
// lock. That way J always opens it, even mid-cascade. Other passive eggs
// (idle-peek) and keyboard-triggered ones (snake) check isJournalOpen()
// directly so they defer while the panel is up.

import { getDiscovered, onDiscoveryChange } from '../lib/discoveries';
import { REGISTRY } from './manifest';

const CLOSE_ANIM_MS = 220;

let _open = false;

export function isJournalOpen(): boolean {
  return _open;
}

export function initJournal() {
  injectStampFilter();
  let backdrop: HTMLElement | null = null;
  let unsubDiscoveryChange: (() => void) | null = null;

  function renderInto(panel: HTMLElement) {
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
      return `<li class="journal-item${isFound ? ' is-found' : ''}">${checkbox}${label}</li>`;
    }).join('');

    // Once every entry is ticked off, the interviewer slaps a red HIRED
    // stamp across the form. Re-renders animate the stamp drop each open.
    // The `is-complete` class on the paper dims the form content so the
    // stamp dominates ("case closed" feel).
    const complete = found === total;
    const stamp = complete
      ? `<div class="journal-stamp" aria-hidden="true">Hired</div>`
      : '';

    // Clipboard layout: a metal clip up top, then a sheet of paper with the
    // form on it. The recruiter's POV — they're observing the candidate
    // (Tim) and ticking off what they've seen.
    panel.innerHTML =
      `<div class="journal-clip" aria-hidden="true"></div>` +
      `<div class="journal-paper${complete ? ' is-complete' : ''}">` +
        `<h2 id="journal-title" class="journal-title">Interview Notes</h2>` +
        `<p class="journal-candidate">Candidate: <span>Tim Frey</span></p>` +
        `<p class="journal-count">${found} / ${total} noted</p>` +
        `<ul class="journal-list">${items}</ul>` +
        `<p class="journal-footer">[ Press J or Esc to close ]</p>` +
        stamp +
      `</div>`;
  }

  function open() {
    if (_open) return;
    _open = true;

    backdrop = document.createElement('div');
    backdrop.className = 'journal-backdrop';

    const panel = document.createElement('div');
    panel.className = 'journal-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'journal-title');
    renderInto(panel);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // Force reflow so the opening transition runs from the offscreen state.
    void backdrop.offsetWidth;
    backdrop.classList.add('is-open');

    // Click on the backdrop (but not the panel) closes.
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    // Re-render if a discovery lands while the journal is open. With the
    // panel up the user can't click eggs (backdrop intercepts), but an
    // already-running interaction could still resolve and mark its id.
    unsubDiscoveryChange = onDiscoveryChange(() => {
      if (backdrop) renderInto(panel);
    });
  }

  function close() {
    if (!_open || !backdrop) return;
    _open = false;
    const el = backdrop;
    backdrop = null;
    if (unsubDiscoveryChange) {
      unsubDiscoveryChange();
      unsubDiscoveryChange = null;
    }
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    window.setTimeout(() => el.remove(), CLOSE_ANIM_MS);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'j' && e.key !== 'J') return;
    // Don't hijack browser shortcuts (Cmd+J downloads, Alt+J, etc.) or J
    // while typing somewhere editable.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && isEditable(target)) return;
    e.preventDefault();
    if (_open) close();
    else open();
  });
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
