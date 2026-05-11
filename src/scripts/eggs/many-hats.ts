import { playRoleTick } from '../lib/audio';
import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

// Founding-Engineer hat-cycle. The joke: founding engineers wear every hat.
// Click "Founding Engineer" on the Otti row, the second word slot-machines
// through alternate hats and snaps back to "Engineer". A burst of literal hat
// sprites also flies out of the word — independent of the text rotation.
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

const HAT_SPRITES = [
  'construction',
  'cowboy',
  'mining',
  'baseball',
  'fireman',
  'police',
  'pilot',
  'astronaut',
  'welder',
  'chef',
  'graduate',
  'surgeon',
  'detective',
  'sailor',
  'soldier',
  'fastfood',
  'mascot',
  'propeller',
  'wizard',
  'tophat',
  'crown',
  'jester',
  'pirate',
  'conductor',
  'beret',
];
const HATS_PER_BURST = 8;
const HAT_BURST_STAGGER_MS = 70;
const HAT_SIZE_PX = 56;
const HAT_GRAVITY = 1400;
const HAT_RESTITUTION = 0.55;
const HAT_ROT_BOUNCE_DAMP = 0.7;
// Slow-mo factor on physics dt — keeps arc shape identical, just plays back
// slower so the eye can read each hat.
const HAT_TIME_SCALE = 0.7;

function pickHats(n: number): string[] {
  const pool = HATS.slice();
  const out: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// One in-flight hat. Position is stored in word-local coords (origin = word
// center), so the initial spawn frame is already behind the word's text via
// the z-index rule in global.css. We translate to viewport coords each tick to
// test collisions against the viewport edges.
type HatParticle = {
  el: HTMLImageElement;
  hostCenterX: number;
  hostCenterY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
};

const activeHats: HatParticle[] = [];
let hatPhysicsFrame: number | null = null;
let hatPhysicsLastTime = 0;

// Spawn one hat sprite at the host's center, give it an upward-biased
// velocity, and hand it to the physics loop. The loop bounces it off the
// viewport's top/left/right edges and lets it fall off the bottom.
function spawnHat(host: HTMLElement, sprite: string) {
  const img = document.createElement('img');
  img.className = 'role-cycle-hat';
  img.src = `${import.meta.env.BASE_URL}sprites/hats/${sprite}.png`;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  host.appendChild(img);

  // Burst angle: mostly straight up with a small fan (-120° to -60°).
  const angleDeg = -90 + (Math.random() - 0.5) * 60;
  const angle = (angleDeg * Math.PI) / 180;
  const speed = 520 + Math.random() * 380;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const vrot = (Math.random() - 0.5) * 720;

  const hostRect = host.getBoundingClientRect();
  const hostCenterX = hostRect.left + hostRect.width / 2;
  const hostCenterY = hostRect.top + hostRect.height / 2;

  activeHats.push({
    el: img,
    hostCenterX,
    hostCenterY,
    x: 0,
    y: 0,
    vx,
    vy,
    rot: 0,
    vrot,
  });
  ensureHatPhysics();
}

function ensureHatPhysics() {
  if (hatPhysicsFrame !== null) return;
  hatPhysicsLastTime = performance.now();
  hatPhysicsFrame = requestAnimationFrame(hatPhysicsTick);
}

function hatPhysicsTick(now: number) {
  const dt = Math.min((now - hatPhysicsLastTime) / 1000, 1 / 30) * HAT_TIME_SCALE;
  hatPhysicsLastTime = now;

  const W = window.innerWidth;
  const H = window.innerHeight;
  const half = HAT_SIZE_PX / 2;

  for (let i = activeHats.length - 1; i >= 0; i--) {
    const h = activeHats[i];
    h.vy += HAT_GRAVITY * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.rot += h.vrot * dt;

    const cx = h.hostCenterX + h.x;
    const cy = h.hostCenterY + h.y;

    if (cx - half < 0) {
      h.x += -(cx - half);
      h.vx = -h.vx * HAT_RESTITUTION;
      h.vrot = -h.vrot * HAT_ROT_BOUNCE_DAMP;
    } else if (cx + half > W) {
      h.x -= cx + half - W;
      h.vx = -h.vx * HAT_RESTITUTION;
      h.vrot = -h.vrot * HAT_ROT_BOUNCE_DAMP;
    }

    if (cy - half < 0) {
      h.y += -(cy - half);
      h.vy = -h.vy * HAT_RESTITUTION;
    }

    // Off the bottom = gone. No bottom bounce — they "fall off the edge".
    if (cy - half > H) {
      h.el.remove();
      activeHats.splice(i, 1);
      continue;
    }

    h.el.style.transform =
      `translate(calc(-50% + ${h.x.toFixed(2)}px), calc(-50% + ${h.y.toFixed(2)}px)) ` +
      `rotate(${h.rot.toFixed(2)}deg)`;
  }

  if (activeHats.length > 0) {
    hatPhysicsFrame = requestAnimationFrame(hatPhysicsTick);
  } else {
    hatPhysicsFrame = null;
    maybeReleaseLock();
  }
}

// role-cycle is self-reentrant under the shared interaction lock — re-clicks
// during an active hat-cycle just re-trigger, but the lock stays held against
// *other* interactions until both the text cycle and hat physics are quiet.
const LOCK_ID = 'role-cycle';
let textCycleActive = false;

function maybeReleaseLock() {
  if (!textCycleActive && activeHats.length === 0) end(LOCK_ID);
}

function spawnHatBurst(host: HTMLElement, timers: number[]) {
  if (prefersReducedMotion()) return;
  // Pick a random subset each click so 15 hats don't all fly at once and
  // each burst feels fresh.
  const order = HAT_SPRITES.slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, HATS_PER_BURST);
  order.forEach((sprite, i) => {
    if (i === 0) {
      spawnHat(host, sprite);
      return;
    }
    timers.push(window.setTimeout(() => spawnHat(host, sprite), i * HAT_BURST_STAGGER_MS));
  });
}

export function initManyHats() {
  const roleCycle = document.querySelector<HTMLElement>('.role-cycle');
  const roleCycleWord = roleCycle?.querySelector<HTMLElement>('.role-cycle-word') ?? null;
  const roleCycleOverlay = roleCycle?.querySelector<HTMLElement>('.role-cycle-overlay') ?? null;
  if (!roleCycle || !roleCycleWord || !roleCycleOverlay) return;

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
    if (!roleCycle || !roleCycleWord || !roleCycleOverlay) return;
    if (!tryStart(LOCK_ID, { reentrant: true })) return;
    markDiscovered('many-hats');
    clearTimers();
    textCycleActive = true;

    const sequence = pickHats(HATS_PER_CYCLE);
    if (sequence.length === 0) {
      textCycleActive = false;
      maybeReleaseLock();
      return;
    }

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
    spawnHatBurst(roleCycleWord, timers);

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
        textCycleActive = false;
        maybeReleaseLock();
      }, t)
    );
  }

  roleCycle.addEventListener('click', start);
}
