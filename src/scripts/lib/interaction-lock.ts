// Single-flight lock for Easter-egg interactions. Only one interaction may
// hold the lock at a time. Any click that would START a *different*
// interaction while it's held is silently ignored by that interaction's
// click handler (which calls tryStart() up front and bails on false).
//
// Reentrancy: the same holder can re-acquire by passing { reentrant: true }
// — used by role-cycle, where rapid-fire re-clicks on the job title are the
// point. Re-acquire returns true without resetting; the holder is in charge
// of its own internal re-trigger logic (clearing timers, restarting, etc.).
//
// The lock also broadcasts state via a tiny subscribe API so the idle peek
// can defer while anything else is playing.

let holder: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function tryStart(
  id: string,
  options: { reentrant?: boolean } = {},
): boolean {
  if (holder === null) {
    holder = id;
    notify();
    return true;
  }
  if (holder === id && options.reentrant) {
    // Already ours — caller handles its own re-trigger cleanup. Don't notify
    // again; nothing about the lock changed for outside observers.
    return true;
  }
  return false;
}

export function end(id: string): void {
  if (holder !== id) return;
  holder = null;
  notify();
}

export function isLocked(): boolean {
  return holder !== null;
}

export function currentHolder(): string | null {
  return holder;
}

// Subscribe to lock state changes. Returns an unsubscribe function.
export function onLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
