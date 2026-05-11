import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

// "View Source" Easter egg. Right-click anywhere on the resume → a stylized
// JSX source modal slides in. Different on both axes from the other eggs:
// trigger is contextmenu (not left-click), effect is a reveal modal (no
// avatar, no physics).
//
// Falls through to the browser's real context menu when:
//   - any modifier key is held (Cmd/Ctrl/Shift/Alt — devs can still Inspect)
//   - the target is a link, input, textarea, or contenteditable
//   - there's an active text selection (user is probably trying to Copy)
//   - the target is outside `.resume` (journal panel, idle peek, etc.)

const LOCK_ID = 'view-source';

// Token helpers — tagged HTML spans for syntax highlighting. Short class
// names keep the source array readable inline.
const C = (s: string) => `<span class="vs-c">${s}</span>`; // comment
const K = (s: string) => `<span class="vs-k">${s}</span>`; // keyword
const S = (s: string) => `<span class="vs-s">${s}</span>`; // string
const T = (s: string) => `<span class="vs-t">${s}</span>`; // jsx tag
const A = (s: string) => `<span class="vs-a">${s}</span>`; // jsx attribute
const F = (s: string) => `<span class="vs-f">${s}</span>`; // function/identifier
const LT = '&lt;';
const GT = '&gt;';

// Handcrafted, not derived from profile.ts — the comments are the gag and
// need to be written by hand. Structure mirrors the real page so a reader
// recognizes their resume in the "source".
const SOURCE_LINES: ReadonlyArray<string> = [
  C('// resume.tsx'),
  C('// pssst — you found View Source. respect.'),
  '',
  `${K('import')} { Header, Skills, Experience, Education } ${K('from')} ${S(`'./components'`)};`,
  `${K('import')} { ${T('HireMe')} } ${K('from')} ${S(`'@tfrey7/superpowers'`)};`,
  '',
  `${K('export default function')} ${F('Resume')}() {`,
  `  ${K('return')} (`,
  `    ${LT}${T('main')} ${A('className')}=${S(`"resume"`)}${GT}`,
  '',
  `      ${LT}${T('Header')}`,
  `        ${A('name')}=${S(`"Timothy J. Frey"`)}`,
  `        ${A('location')}=${S(`"New York, NY"`)}`,
  `        ${C(`// resume.pdf coming — keep finding things to add to it`)}`,
  `      /${GT}`,
  '',
  `      ${LT}${T('Skills')}`,
  `        ${A('languages')}={[${S(`'Ruby'`)}, ${S(`'TypeScript'`)}, ${S(`'JavaScript'`)}, ${S(`'Java'`)}, ${S(`'SQL'`)}]}`,
  `        ${A('cloud')}={[${S(`'AWS'`)}, ${S(`'PostgreSQL'`)}]}`,
  `        ${A('ai')}={[${S(`'OpenAI'`)}, ${S(`'Claude Code'`)}, ${S(`'Copilot'`)}]}`,
  `        ${C(`// TODO: add 'whiteboard markers'`)}`,
  `      /${GT}`,
  '',
  `      ${LT}${T('Experience')}${GT}`,
  `        ${LT}${T('Role')} ${A('at')}=${S(`"Otti, Inc."`)}            ${A('years')}=${S(`"2024 — 2025"`)} /${GT}`,
  `        ${LT}${T('Role')} ${A('at')}=${S(`"Greenhouse Software"`)}   ${A('years')}=${S(`"2013 — 2023"`)} /${GT}  ${C('// yes, ten of them')}`,
  `        ${LT}${T('Role')} ${A('at')}=${S(`"The New York Times"`)}    ${A('years')}=${S(`"2013"`)} /${GT}`,
  `        ${LT}${T('Role')} ${A('at')}=${S(`"Thomson Reuters"`)}       ${A('years')}=${S(`"2010 — 2013"`)} /${GT}`,
  `      ${LT}/${T('Experience')}${GT}`,
  '',
  `      ${LT}${T('Education')}`,
  `        ${A('school')}=${S(`"Stony Brook University"`)}`,
  `        ${A('degree')}=${S(`"B.S. Computer Science"`)}`,
  `      /${GT}`,
  '',
  `      ${C('/* the easter eggs are not documented on purpose. */')}`,
  `      ${C('/* keep poking around — there are more.            */')}`,
  `      ${LT}${T('HireMe')} /${GT}`,
  '',
  `    ${LT}/${T('main')}${GT}`,
  `  );`,
  `}`,
];

let openInstance: { close: () => void } | null = null;

function buildModal(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'view-source-backdrop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'View source');

  const numWidth = String(SOURCE_LINES.length).length;
  const linesHtml = SOURCE_LINES.map((raw, i) => {
    const n = String(i + 1).padStart(numWidth, ' ');
    // Empty lines need a non-empty space so the .view-source-line height
    // matches a populated line — otherwise blank rows collapse and the
    // visual rhythm of the source breaks.
    const code = raw.length === 0 ? '&nbsp;' : raw;
    return (
      `<div class="view-source-line">` +
      `<span class="view-source-num">${n}</span>` +
      `<span class="view-source-code">${code}</span>` +
      `</div>`
    );
  }).join('');

  root.innerHTML =
    `<div class="view-source-modal">` +
      `<div class="view-source-header">` +
        `<span class="view-source-traffic" aria-hidden="true">` +
          `<span></span><span></span><span></span>` +
        `</span>` +
        `<span class="view-source-tab">resume.tsx</span>` +
        `<button class="view-source-close" aria-label="Close">×</button>` +
      `</div>` +
      `<div class="view-source-body">${linesHtml}</div>` +
      `<div class="view-source-footer">` +
        `<span>view-source: tfrey7.com</span>` +
        `<span>esc to close</span>` +
      `</div>` +
    `</div>`;
  return root;
}

function openModal() {
  if (openInstance) return;
  if (!tryStart(LOCK_ID)) return;
  markDiscovered('view-source');

  const root = buildModal();
  document.body.appendChild(root);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const closeBtn = root.querySelector<HTMLButtonElement>('.view-source-close')!;

  function close() {
    window.removeEventListener('keydown', onKeyDown, true);
    closeBtn.removeEventListener('click', close);
    root.removeEventListener('click', onBackdropClick);
    root.remove();
    document.body.style.overflow = prevOverflow;
    openInstance = null;
    end(LOCK_ID);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === root) close();
  }

  window.addEventListener('keydown', onKeyDown, true);
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', onBackdropClick);

  openInstance = { close };
}

export function initViewSource() {
  const resume = document.querySelector<HTMLElement>('.resume');
  if (!resume) return;

  // Mobile/discoverable trigger: a small "view-source:tfrey7.com" link at the
  // bottom of the resume. Styled like an old browser URL prefix, it's the
  // tap-friendly counterpart to right-click and a faint hint that there's
  // something to find here.
  const vsBtn = document.querySelector<HTMLButtonElement>('.resume-view-source');
  if (vsBtn) {
    vsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  }

  document.addEventListener('contextmenu', (e) => {
    // Modifier-held → defer to the browser's real menu (Inspect, etc.).
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Defer on interactive elements so users can still Save Link, Copy Link
    // Address, paste into fields, etc.
    if (target.closest('a, input, textarea, [contenteditable="true"]')) return;

    // If text is selected, the user is probably about to Copy — defer.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

    // Only hijack inside the resume body — leaves the journal panel,
    // idle-peek avatar, and any future floating UI on their own.
    if (!target.closest('.resume')) return;

    e.preventDefault();
    openModal();
  });
}
