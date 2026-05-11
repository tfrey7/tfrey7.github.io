// Single source of truth for every Easter egg on the page.
//
// To add a new egg:
//   1. Create src/scripts/eggs/<name>.ts with an init<Name>() export.
//   2. Add one entry to EGGS below — id, init, plus journal { label, hint }
//      if you want it to show up in the J-key journal.
//   3. Inside the egg, call markDiscovered('<id>') once it has successfully
//      fired (typically right after tryStart succeeds).
//
// index.astro just calls initAllEggs(); the journal derives its checklist
// from this list automatically.
//
// NOTE: src/scripts/lib/hint.ts (the idle-pulse hint module) keeps its own
// DOM-selector config because its shape is different (per-element selectors,
// multi-element groups). A future cleanup could fold it in here.

import { initDrawSnake } from './draw-snake';
import { initGreenhouse } from './greenhouse';
import { initHeader } from './header';
import { initIdlePeek } from './idle-peek';
import { initJournal } from './journal';
import { initManyHats } from './many-hats';
import { initSkills } from './skills';
import { initSnake } from './snake';
import { initTimeWarp } from './time-warp';
import { initTsSquiggle } from './ts-squiggle';
import { initViewSource } from './view-source';

export type JournalEntry = {
  // Friendly name shown once the user has triggered the egg.
  label: string;
  // Vague nudge shown for undiscovered entries — point at the section without
  // giving the gag away.
  hint: string;
};

export type EggDef = {
  // Stable id used by markDiscovered() and as the localStorage key. Don't
  // rename without a migration — found-egg state is keyed on this.
  id: string;
  init: () => void;
  // Omit to keep the egg out of the journal (e.g. the journal itself, which
  // is the thing rendering the list).
  journal?: JournalEntry;
};

// `as const satisfies` keeps the literal id types (so we can derive a union
// from them below) while still type-checking each entry against EggDef.
export const EGGS = [
  // Labels are phrased as observations an interviewer would jot on a
  // candidate scorecard — the journal renders as their clipboard. Hints
  // stay in the same voice: the interviewer's internal "what to probe".
  {
    id: 'name',
    init: initHeader,
    journal: {
      label: 'Strong first impression',
      hint: 'Start with the introduction.',
    },
  },
  {
    id: 'skills',
    init: initSkills,
    journal: {
      label: 'Knows his stuff',
      hint: 'Strong technicals?',
    },
  },
  {
    id: 'ts-squiggle',
    init: initTsSquiggle,
    journal: {
      label: 'Not just the classics',
      hint: 'Keeps up with modern tooling?',
    },
  },
  {
    id: 'many-hats',
    init: initManyHats,
    journal: {
      label: 'Wears many hats',
      hint: 'Founding engineers handle every role.',
    },
  },
  {
    id: 'greenhouse',
    init: initGreenhouse,
    journal: {
      label: 'Decade at Greenhouse',
      hint: 'Longest tenure?',
    },
  },
  {
    id: 'time-warp',
    init: initTimeWarp,
    journal: {
      label: 'Career spans decades',
      hint: 'Poke at the dates on his resume.',
    },
  },
  // Background behavior — Tim peeks from a page edge after the page has
  // been quiet for a while. Intentionally not journaled: it's an ambient
  // wink, not a discoverable skill.
  { id: 'idle-peek', init: initIdlePeek },
  {
    id: 'view-source',
    init: initViewSource,
    journal: {
      label: 'Code reads as well as the resume',
      hint: 'Curious how he built this.',
    },
  },
  {
    id: 'snake',
    init: initSnake,
    journal: {
      label: 'Knows how to have fun',
      hint: 'Doodles in the margins?',
    },
  },
  // Meta — the journal renders the list above. Not itself tracked.
  { id: 'journal', init: initJournal },
  // Launcher for the snake egg via the clipboard pencil. Exposes
  // window.__drawSnake; not itself a discovery (the snake egg is).
  { id: 'draw-snake', init: initDrawSnake },
] as const satisfies readonly EggDef[];

// Union of every known egg id, derived from EGGS. markDiscovered() takes this
// instead of `string` so typos / stale ids fail at compile time.
export type DiscoveryId = (typeof EGGS)[number]['id'];

export const REGISTRY: readonly (JournalEntry & { id: string })[] = EGGS.flatMap(
  (e: EggDef) => (e.journal ? [{ id: e.id, ...e.journal }] : []),
);

export function initAllEggs(): void {
  for (const egg of EGGS) egg.init();
}
