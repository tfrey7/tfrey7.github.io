// Firework primitive. A single firework = one rising shell with a trail of
// embers, a bright radial flash at the apex, then a burst of rotating
// icon-shaped particles that arc out under gravity.
//
// Callers pass a stage element (any positioned ancestor) plus a launch point
// in stage-local coordinates; the shell/embers/flash/particles are appended
// directly to the stage, so the firework moves with whatever the stage is
// anchored to (a section in the page, a fixed clipboard, etc.).
//
// One module-scoped rAF loop drives every active particle on every stage,
// so 50 concurrent fireworks across the page still only spend one frame's
// worth of overhead.
//
// CSS classes (.gh-firework-shell / -ember / -flash / -particle) and their
// keyframes live in src/styles/global.css.
//
// Cancellation: launchFirework returns a handle whose .cancel() removes any
// elements still in flight from THIS launch and clears its pending timers.
// cancelFireworksOnStage(stage) bulk-cancels every launch hung off the same
// stage — used by the greenhouse re-click path to wipe an in-progress show.

export type Rating = 'strong-no' | 'no' | 'mixed' | 'yes' | 'strong-yes';

export const RATING_ORDER: Rating[] = [
  'strong-no',
  'no',
  'mixed',
  'yes',
  'strong-yes',
];

const ICON_STRONG_NO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
  `<polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" fill="#e23b29"/>` +
  `<path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` +
  `</svg>`;

const ICON_NO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="#e23b29" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>` +
  `</svg>`;

const ICON_MIXED = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="#f4b942" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7 13v-2h10v2H7z"/>` +
  `</svg>`;

const ICON_YES = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="#43b5a0" d="M9 21h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2zM1 9h4v12H1V9z"/>` +
  `</svg>`;

const ICON_STRONG_YES = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="#43b5a0" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>` +
  `</svg>`;

export const RATING_GLYPHS: Record<Rating, { svg: string; glow: string }> = {
  'strong-no':  { svg: ICON_STRONG_NO,  glow: '#e23b29' },
  'no':         { svg: ICON_NO,         glow: '#e23b29' },
  'mixed':      { svg: ICON_MIXED,      glow: '#f4b942' },
  'yes':        { svg: ICON_YES,        glow: '#43b5a0' },
  'strong-yes': { svg: ICON_STRONG_YES, glow: '#43b5a0' },
};

// Rise duration — short enough to read as "phshoo→pop" without feeling floaty.
const RISE_MS = 480;
const RISE_PX_MIN = 350;
const RISE_PX_MAX = 430;
// Launch angle off vertical, in radians. Each rocket picks a uniform random
// in ±this — real fireworks fan out instead of all going straight up.
const LAUNCH_ANGLE_DEFAULT = 0.45; // ≈ ±26°

// Trail embers. A few small fading sparks dropped along each rocket's path
// so the rise reads as a streak instead of a single dot.
const EMBER_COUNT = 7;
const EMBER_LIFETIME_MS = 420;
// Flash element's CSS keyframes run 320ms; remove with a tiny safety pad.
const FLASH_REMOVE_MS = 360;

const PARTICLES_PER_BURST = 18;
const PARTICLE_LIFETIME_MS = 1000;
const PARTICLE_LIFETIME_VAR_MS = 180;
// Per-particle angular jitter (radians) added to the radial angle. Small
// jitter keeps the ring from looking mechanical without breaking it up.
const ANGLE_JITTER = 0.08;
// Initial random tumble velocity. Fast spin made the icons look like a
// swirling blur instead of a radial pattern.
const ROTATION_BASE = 90;

// Two layers per burst — a BIG outer ring and a SMALL inner core. Big
// particles get a tight high-speed range so they all reach roughly the
// same distance at the same time, forming a visible expanding circle;
// small particles get a slower range so they cluster near the burst point
// as a sparkly core that fades fast.
const BIG_SIZE_MIN = 26;
const BIG_SIZE_MAX = 34;
const SMALL_SIZE_MIN = 11;
const SMALL_SIZE_MAX = 16;
const BIG_SPEED_MIN = 180;
const BIG_SPEED_MAX = 205;
const SMALL_SPEED_MIN = 45;
const SMALL_SPEED_MAX = 90;
const BIG_LIFETIME_MOD = 1.1;
const SMALL_LIFETIME_MOD = 0.55;
// Lighter than paper gravity (460) so the sparks linger.
const GRAVITY = 280;
const DRAG = 0.985;
// Fraction of particle lifetime spent at full opacity before fading out.
const FADE_START_FRAC = 0.55;

type Particle = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationVel: number;
  birthTime: number;
  lifetimeMs: number;
  slot: Slot;
};

type Slot = {
  stage: HTMLElement;
  shells: Set<HTMLElement>;
  embers: Set<HTMLElement>;
  flashes: Set<HTMLElement>;
  particles: Set<Particle>;
  timers: Set<number>;
  cancelled: boolean;
};

export type LaunchOpts = {
  // Positioned ancestor the firework elements get appended to. Coordinates
  // are stage-local (matches getBoundingClientRect math the caller already
  // does for placement).
  stage: HTMLElement;
  // Launch point in stage-local coordinates — where the shell first appears.
  originX: number;
  originY: number;
  // Particle icon + color. Random across RATING_ORDER if omitted.
  rating?: Rating;
  // Off-vertical launch angle in radians. Random in ±LAUNCH_ANGLE_DEFAULT
  // if omitted; pass 0 to fire straight up.
  angleRad?: number;
  // Rise distance in pixels. Random in [RISE_PX_MIN, RISE_PX_MAX] if omitted.
  riseDistancePx?: number;
  // Fires when the shell starts rising — caller's hook for whistle audio.
  onLaunch?: (rating: Rating) => void;
  // Fires at apex, immediately before the flash + particles spawn —
  // caller's hook for burst pop audio.
  onBurst?: (rating: Rating) => void;
};

export type FireworkHandle = {
  cancel: () => void;
};

const allSlots = new Set<Slot>();
const allParticles = new Set<Particle>();
let rafId: number | null = null;
let lastTime = 0;

function ensureLoop(): void {
  if (rafId !== null) return;
  lastTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;

  for (const p of allParticles) {
    const age = now - p.birthTime;
    if (age >= p.lifetimeMs) {
      p.el.remove();
      p.slot.particles.delete(p);
      allParticles.delete(p);
      continue;
    }
    p.vy += GRAVITY * dt;
    p.vx *= DRAG;
    p.vy *= DRAG;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.rotationVel * dt;

    const lifeFrac = age / p.lifetimeMs;
    const opacity =
      lifeFrac < FADE_START_FRAC
        ? 1
        : Math.max(
            0,
            1 - (lifeFrac - FADE_START_FRAC) / (1 - FADE_START_FRAC),
          );
    p.el.style.opacity = String(opacity);
    p.el.style.transform =
      `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) ` +
      `rotate(${p.rotation}deg)`;
  }

  if (allParticles.size > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function spawnFlash(slot: Slot, x: number, y: number, glow: string): void {
  const el = document.createElement('div');
  el.className = 'gh-firework-flash';
  el.style.setProperty('--gh-flash-glow', glow);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  slot.stage.appendChild(el);
  slot.flashes.add(el);
  const t = window.setTimeout(() => {
    slot.flashes.delete(el);
    slot.timers.delete(t);
    el.remove();
  }, FLASH_REMOVE_MS);
  slot.timers.add(t);
}

function spawnEmber(
  slot: Slot,
  x: number,
  y: number,
  glow: string,
): void {
  const el = document.createElement('div');
  el.className = 'gh-firework-ember';
  el.style.setProperty('--gh-ember-glow', glow);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  slot.stage.appendChild(el);
  slot.embers.add(el);
  const t = window.setTimeout(() => {
    slot.embers.delete(el);
    slot.timers.delete(t);
    el.remove();
  }, EMBER_LIFETIME_MS + 40);
  slot.timers.add(t);
}

function spawnBurst(
  slot: Slot,
  centerX: number,
  centerY: number,
  rating: Rating,
): void {
  const now = performance.now();
  // Random rotational offset so successive bursts don't fan out along
  // identical axes.
  const angleOffset = Math.random() * Math.PI * 2;
  const { svg, glow } = RATING_GLYPHS[rating];
  spawnFlash(slot, centerX, centerY, glow);

  for (let i = 0; i < PARTICLES_PER_BURST; i++) {
    const el = document.createElement('div');
    el.className = 'gh-firework-particle';
    el.innerHTML = svg;
    el.style.setProperty('--gh-fp-glow', glow);

    // 50/50 between BIG (outer ring) and SMALL (inner sparkly core).
    const isBig = Math.random() < 0.5;
    const size = isBig
      ? BIG_SIZE_MIN + Math.random() * (BIG_SIZE_MAX - BIG_SIZE_MIN)
      : SMALL_SIZE_MIN + Math.random() * (SMALL_SIZE_MAX - SMALL_SIZE_MIN);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    const speed = isBig
      ? BIG_SPEED_MIN + Math.random() * (BIG_SPEED_MAX - BIG_SPEED_MIN)
      : SMALL_SPEED_MIN + Math.random() * (SMALL_SPEED_MAX - SMALL_SPEED_MIN);
    const lifetimeMod = isBig ? BIG_LIFETIME_MOD : SMALL_LIFETIME_MOD;

    const angle =
      angleOffset +
      (Math.PI * 2 * i) / PARTICLES_PER_BURST +
      (Math.random() - 0.5) * ANGLE_JITTER;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const rotation = Math.random() * 360;
    const rotationVel =
      (Math.random() - 0.5) * ROTATION_BASE * (isBig ? 1.0 : 1.6);
    const lifetimeMs =
      (PARTICLE_LIFETIME_MS +
        (Math.random() - 0.5) * PARTICLE_LIFETIME_VAR_MS) *
      lifetimeMod;

    el.style.transform =
      `translate(${centerX}px, ${centerY}px) translate(-50%, -50%) ` +
      `rotate(${rotation}deg)`;
    slot.stage.appendChild(el);

    const particle: Particle = {
      el,
      x: centerX,
      y: centerY,
      vx,
      vy,
      rotation,
      rotationVel,
      birthTime: now,
      lifetimeMs,
      slot,
    };
    slot.particles.add(particle);
    allParticles.add(particle);
  }
  ensureLoop();
}

export function launchFirework(opts: LaunchOpts): FireworkHandle {
  const rating =
    opts.rating ?? RATING_ORDER[Math.floor(Math.random() * RATING_ORDER.length)];
  const slot: Slot = {
    stage: opts.stage,
    shells: new Set(),
    embers: new Set(),
    flashes: new Set(),
    particles: new Set(),
    timers: new Set(),
    cancelled: false,
  };
  allSlots.add(slot);

  const cancel = (): void => {
    if (slot.cancelled) return;
    slot.cancelled = true;
    slot.shells.forEach((el) => el.remove());
    slot.embers.forEach((el) => el.remove());
    slot.flashes.forEach((el) => el.remove());
    slot.particles.forEach((p) => {
      p.el.remove();
      allParticles.delete(p);
    });
    slot.shells.clear();
    slot.embers.clear();
    slot.flashes.clear();
    slot.particles.clear();
    slot.timers.forEach((t) => window.clearTimeout(t));
    slot.timers.clear();
    allSlots.delete(slot);
  };

  const angle =
    opts.angleRad ?? (Math.random() - 0.5) * 2 * LAUNCH_ANGLE_DEFAULT;
  const distance =
    opts.riseDistancePx ??
    RISE_PX_MIN + Math.random() * (RISE_PX_MAX - RISE_PX_MIN);
  const apexX = opts.originX + Math.sin(angle) * distance;
  const apexY = opts.originY - Math.cos(angle) * distance;
  const glow = RATING_GLYPHS[rating].glow;

  const shell = document.createElement('div');
  shell.className = 'gh-firework-shell';
  // Color the rising shell with the burst's glow so the rocket telegraphs
  // which rating's about to pop.
  shell.style.setProperty('--gh-shell-glow', glow);
  shell.style.setProperty('--gh-shell-x', `${opts.originX}px`);
  shell.style.setProperty('--gh-shell-y', `${opts.originY}px`);
  shell.style.setProperty('--gh-shell-tx', `${apexX}px`);
  shell.style.setProperty('--gh-shell-ty', `${apexY}px`);
  shell.style.setProperty('--gh-shell-rise-ms', `${RISE_MS}ms`);
  opts.stage.appendChild(shell);
  slot.shells.add(shell);

  opts.onLaunch?.(rating);

  // Kick off the rise on the next frame so the initial transform sticks
  // before the target one is read.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (slot.cancelled) return;
      shell.classList.add('is-rising');
    });
  });

  // Drop trail embers along the rise path. The CSS transition uses linear
  // easing (set in global.css), so position interpolates linearly with
  // time — embers placed at uniform time fractions align with the rocket.
  for (let i = 1; i <= EMBER_COUNT; i++) {
    const frac = i / (EMBER_COUNT + 1);
    const ex = opts.originX + (apexX - opts.originX) * frac;
    const ey = opts.originY + (apexY - opts.originY) * frac;
    const t = window.setTimeout(() => {
      slot.timers.delete(t);
      if (slot.cancelled) return;
      spawnEmber(slot, ex, ey, glow);
    }, RISE_MS * frac);
    slot.timers.add(t);
  }

  const burstTimer = window.setTimeout(() => {
    slot.timers.delete(burstTimer);
    if (slot.cancelled) return;
    slot.shells.delete(shell);
    shell.remove();
    opts.onBurst?.(rating);
    spawnBurst(slot, apexX, apexY, rating);
  }, RISE_MS);
  slot.timers.add(burstTimer);

  return { cancel };
}

// Bulk-cancels every in-flight firework whose stage equals `stage`. Used by
// the greenhouse re-click path to wipe the whole show without tracking
// individual handles. No-op if the stage has nothing in flight.
export function cancelFireworksOnStage(stage: HTMLElement): void {
  for (const slot of Array.from(allSlots)) {
    if (slot.stage !== stage || slot.cancelled) continue;
    slot.cancelled = true;
    slot.shells.forEach((el) => el.remove());
    slot.embers.forEach((el) => el.remove());
    slot.flashes.forEach((el) => el.remove());
    slot.particles.forEach((p) => {
      p.el.remove();
      allParticles.delete(p);
    });
    slot.shells.clear();
    slot.embers.clear();
    slot.flashes.clear();
    slot.particles.clear();
    slot.timers.forEach((t) => window.clearTimeout(t));
    slot.timers.clear();
    allSlots.delete(slot);
  }
}
