// Tracker for "which Easter eggs has the user discovered?". Persisted to
// localStorage so the journal carries state across reloads — a returning
// visitor sees their previous ticks restored and can keep filling out the
// scorecard, or wipe it with the "Clear notes" button in the journal.
//
// The journal joins this against the registry in src/scripts/eggs/manifest.ts
// to render found/unfound state. Each egg calls markDiscovered(id) once it has
// successfully fired (i.e., after its lock acquisition), so silently-dropped
// clicks don't count.

// `import type` is erased at compile time — avoids the runtime cycle
// (discoveries → manifest → eggs → discoveries).
import type { DiscoveryId } from '../eggs/manifest';

// Versioned key so a future schema change (e.g. id renames) can ignore old
// blobs instead of misinterpreting them.
const STORAGE_KEY = 'tfrey7:discoveries:v1';

const listeners = new Set<() => void>();
const discovered: Set<DiscoveryId> = loadFromStorage();

function loadFromStorage(): Set<DiscoveryId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is DiscoveryId => typeof x === 'string'));
  } catch {
    // Safari private mode, disabled storage, corrupted JSON — silently start
    // fresh rather than blowing up page init.
    return new Set();
  }
}

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...discovered]));
  } catch {
    /* quota / private mode — non-fatal, in-memory set still works */
  }
}

export function markDiscovered(id: DiscoveryId): void {
  if (discovered.has(id)) return;
  discovered.add(id);
  saveToStorage();
  listeners.forEach((fn) => fn());
}

// Return type widens to `string` so callers iterating REGISTRY (whose entries
// are typed `{ id: string; ... }`) can `.has(entry.id)` without a narrowing
// dance. The Set is still keyed on DiscoveryId internally; only known ids
// can ever get in via markDiscovered.
export function getDiscovered(): ReadonlySet<string> {
  return discovered;
}

// Wipe both memory and localStorage. The journal's "Clear notes" button
// calls this; everything subscribed via onDiscoveryChange will re-render
// against the now-empty set.
export function clearDiscoveries(): void {
  if (discovered.size === 0) return;
  discovered.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function onDiscoveryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
