// Per-session tracker for "which Easter eggs has the user discovered?".
// Lives in memory only — every reload resets the journal so each visit
// reads as a fresh interview, and the eggs stay re-discoverable. The
// journal joins this against the registry in src/scripts/eggs/manifest.ts
// to render found/unfound state.
//
// Each egg calls markDiscovered(id) once it has successfully fired (i.e.,
// after its lock acquisition), so silently-dropped clicks don't count.

// `import type` is erased at compile time — avoids the runtime cycle
// (discoveries → manifest → eggs → discoveries).
import type { DiscoveryId } from '../eggs/manifest';

const listeners = new Set<() => void>();
const discovered = new Set<DiscoveryId>();

export function markDiscovered(id: DiscoveryId): void {
  if (discovered.has(id)) return;
  discovered.add(id);
  listeners.forEach((fn) => fn());
}

// Return type widens to `string` so callers iterating REGISTRY (whose entries
// are typed `{ id: string; ... }`) can `.has(entry.id)` without a narrowing
// dance. The Set is still keyed on DiscoveryId internally; only known ids
// can ever get in via markDiscovered.
export function getDiscovered(): ReadonlySet<string> {
  return discovered;
}

export function onDiscoveryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
