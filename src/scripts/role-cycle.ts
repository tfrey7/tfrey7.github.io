import { playRoleTick } from './audio';

// Founding-Engineer hat-cycle. The joke: founding engineers wear every hat.
// Click "Founding Engineer" on the Otti row, the second word slot-machines
// through alternate hats and snaps back to "Engineer".
const HATS = [
  'Janitor',
  'Salesperson',
  'Recruiter',
  'Designer',
  'DevOps',
  'Plumber',
  'Mediator',
  'Strategist',
  'Receptionist',
  'Office Manager',
  'IT Support',
  'Coffee Maker',
  'Customer Support',
];
const HAT_HOLD_MS = 150;
const HAT_FINAL_HOLD_MS = 240;
const HATS_PER_CYCLE = 6;

function pickHats(n: number): string[] {
  const pool = HATS.slice();
  const out: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function initRoleCycle() {
  const roleCycle = document.querySelector<HTMLElement>('.role-cycle');
  const roleCycleOverlay = roleCycle?.querySelector<HTMLElement>('.role-cycle-overlay') ?? null;
  if (!roleCycle || !roleCycleOverlay) return;

  const timers: number[] = [];

  function clearTimers() {
    timers.forEach((t) => window.clearTimeout(t));
    timers.length = 0;
  }

  function showHat(text: string, pitch: number) {
    if (!roleCycleOverlay) return;
    roleCycleOverlay.textContent = text;
    roleCycleOverlay.classList.remove('is-flicker');
    // Force reflow so re-adding the class restarts the flicker animation.
    void roleCycleOverlay.offsetHeight;
    roleCycleOverlay.classList.add('is-flicker');
    playRoleTick(pitch);
  }

  function start() {
    if (!roleCycle || !roleCycleOverlay) return;
    clearTimers();

    const sequence = pickHats(HATS_PER_CYCLE);
    if (sequence.length === 0) return;

    // Show the first hat synchronously so adding `is-cycling` doesn't briefly
    // reveal an empty overlay (the original "Engineer" goes invisible the moment
    // the class is set).
    const firstPitch = 320 + Math.random() * 220;
    roleCycleOverlay.textContent = sequence[0];
    roleCycleOverlay.classList.remove('is-flicker');
    void roleCycleOverlay.offsetHeight;
    roleCycleOverlay.classList.add('is-flicker');
    roleCycle.classList.add('is-cycling');
    playRoleTick(firstPitch);

    let t = HAT_HOLD_MS;
    for (let i = 1; i < sequence.length; i++) {
      const hat = sequence[i];
      const pitch = 320 + Math.random() * 220;
      timers.push(window.setTimeout(() => showHat(hat, pitch), t));
      t += HAT_HOLD_MS;
    }

    // Snap back to Engineer with a slightly higher "settled" pitch.
    timers.push(window.setTimeout(() => showHat('Engineer', 720), t));
    t += HAT_FINAL_HOLD_MS;

    // Drop the cycling class — overlay fades out, original "Engineer" reappears
    // in the same position, so the swap is invisible.
    timers.push(
      window.setTimeout(() => {
        roleCycle.classList.remove('is-cycling');
        roleCycleOverlay.classList.remove('is-flicker');
      }, t)
    );
  }

  roleCycle.addEventListener('click', start);
}
