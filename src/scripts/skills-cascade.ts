import { playBoink, playThunk, resumeAudio } from './audio';
import {
  ARRIVALS,
  EXITS,
  type AvatarAnim,
  createAvatarController,
  pickRandom,
} from './avatar';

type Direction = 'left' | 'right';

const SETTLE_MS = 1200;
// Fractions of the core's duration when the hammer hits the ground. Tuned
// to the hammer-fix sheet: hammer descends to the floor around frame ~13
// (52%) and a follow-up beat around frame ~18 (72%). Tweak after watching
// the animation if the snap-back doesn't land on the visual impact.
const HAMMER_IMPACT_FRACTIONS = [0.52, 0.72] as const;

const CORE_HAMMER_FIX: AvatarAnim = {
  sprite: '/sprites/tim/cores/hammer-fix.png',
  durationMs: 1500,
};

// Beat after the arrival lands before the hammer-fix kicks off — gives
// the audience a moment to register that he's arrived.
const ARRIVAL_TO_REPAIR_MS = 200;
// Pause between core's last frame and the exit kicking off — long enough
// for the held standing pose to register before he leaves.
const CORE_TO_EXIT_HOLD_MS = 320;

type Spark = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

export function initSkillsCascade() {
  const stage = document.querySelector<HTMLElement>('.skills-stage');
  const skillsAvatar = stage?.querySelector<HTMLElement>('.skills-avatar') ?? null;
  if (!stage || !skillsAvatar) return;

  const avatar = createAvatarController(skillsAvatar);

  let fixTimer: number | null = null;
  let cascading = false;

  const activeSparks: Spark[] = [];
  let physicsFrame: number | null = null;
  let physicsLastTime = 0;

  function fall(el: HTMLElement, direction: Direction, delay: number, intensity: number) {
    // Roll a tip angle first; if it exceeds the tipping point, gravity wins and
    // the item falls all the way off rather than hanging at a weird steep angle.
    const tipAngle = 22 + Math.random() * 78;
    const TIPPING_POINT = 62;
    const fallsOff = Math.random() < 0.22 || tipAngle > TIPPING_POINT;

    if (fallsOff) {
      // Spins off the section: heavy rotation + translate past the viewport
      // bottom so the item is fully off-screen by the time cleanup snaps it back.
      const sideBias = direction === 'right' ? 1 : -1;
      const spinSign = Math.random() < 0.6 ? sideBias : -sideBias;
      const spinMagnitude = 220 + Math.random() * 540;
      const fallX = sideBias * Math.random() * 180;
      const rect = el.getBoundingClientRect();
      const distanceToBottom = Math.max(0, window.innerHeight - rect.bottom);
      const fallY = distanceToBottom + 140 + Math.random() * 220;
      const duration = 0.75 + Math.random() * 0.4;

      el.style.setProperty('--fall-angle', `${spinSign * spinMagnitude}deg`);
      el.style.setProperty('--fall-x', `${fallX}px`);
      el.style.setProperty('--fall-y', `${fallY}px`);
      el.style.setProperty('--fall-duration', `${duration}s`);
      el.classList.add('is-falling-off');
    } else {
      const signed = direction === 'right' ? tipAngle : -tipAngle;
      const slide = Math.random() < 0.4 ? (Math.random() - 0.5) * 16 : 0;
      const duration = 0.32 + Math.random() * 0.4;

      el.style.setProperty('--fall-angle', `${signed}deg`);
      el.style.setProperty('--fall-origin', direction === 'right' ? '0% 100%' : '100% 100%');
      el.style.setProperty('--fall-duration', `${duration}s`);
      if (slide !== 0) el.style.setProperty('--fall-x', `${slide}px`);
    }

    window.setTimeout(() => {
      if (el.classList.contains('is-fallen')) return;
      el.classList.add('is-fallen');
      playBoink(intensity);
      scheduleFix();
    }, delay);
  }

  function startCascade(clickX: number, clickY: number) {
    if (!stage || cascading || stage.classList.contains('is-fixing')) return;
    cascading = true;
    avatar.reset();

    const items = Array.from(stage.querySelectorAll<HTMLElement>('.skill-item'));

    // Rank items by distance from click — nearest will fall first.
    const ranked = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const dx = cx - clickX;
        const dy = cy - clickY;
        return {
          el,
          dist: Math.sqrt(dx * dx + dy * dy),
          direction: (dx >= 0 ? 'right' : 'left') as Direction,
        };
      })
      .sort((a, b) => a.dist - b.dist);

    // Spreading-panic pacing: 1 falls, beat, another, then 2, 3, 5, then domino.
    // Intensity rises with each wave so the boinks build from soft to crashing.
    const waveSizes = [1, 1, 2, 3, 5];
    const waveDelays = [0, 320, 540, 700, 830];
    const waveIntensity = [0.05, 0.18, 0.32, 0.5, 0.7];
    const FINAL_BASE = 950;
    const FINAL_STAGGER = 45;

    let cursor = 0;
    waveSizes.forEach((size, w) => {
      for (let j = 0; j < size && cursor < ranked.length; j++, cursor++) {
        const { el, direction } = ranked[cursor];
        fall(el, direction, waveDelays[w] + Math.random() * 50, waveIntensity[w]);
      }
    });

    const remaining = ranked.length - cursor;
    let extra = 0;
    while (cursor < ranked.length) {
      const { el, direction } = ranked[cursor];
      // Final domino climbs from 0.85 → 1.0 across its items.
      const finalIntensity = 0.85 + (remaining > 1 ? (extra / (remaining - 1)) * 0.15 : 0);
      fall(el, direction, FINAL_BASE + extra * FINAL_STAGGER + Math.random() * 35, finalIntensity);
      cursor++;
      extra++;
    }
  }

  function scheduleFix() {
    if (fixTimer !== null) window.clearTimeout(fixTimer);
    fixTimer = window.setTimeout(runFix, SETTLE_MS);
  }

  // Returns the viewport + stage-percent coordinates of the hammer's strike
  // point: roughly in front of the avatar's right foot. Sampled at impact time
  // (not pre-computed) so layout shifts between schedule and fire don't drift it.
  function computeHammerImpactPoint() {
    if (!stage || !skillsAvatar) return null;
    const avatarRect = skillsAvatar.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const viewportX = avatarRect.left + avatarRect.width * 0.78;
    const viewportY = avatarRect.bottom - 12;
    return {
      viewportX,
      viewportY,
      stagePctX: ((viewportX - stageRect.left) / stageRect.width) * 100,
      stagePctY: ((viewportY - stageRect.top) / stageRect.height) * 100,
    };
  }

  // Drives the visible repair: each hammer impact snaps back a portion of the
  // pile, plays a thunk, and erupts sparks/puffs at the strike point. Fallen
  // items are partitioned left-to-right so the hammer reads as working its way
  // across the pile rather than fixing everything at once.
  function scheduleRepair(
    startMs: number,
    fallen: NodeListOf<HTMLElement>,
    coreDurationMs: number,
  ) {
    if (!stage) return;

    const sortedByX = Array.from(fallen)
      .map((el) => ({ el, x: el.getBoundingClientRect().left }))
      .sort((a, b) => a.x - b.x)
      .map((p) => p.el);
    const half = Math.ceil(sortedByX.length / HAMMER_IMPACT_FRACTIONS.length);
    const waves: HTMLElement[][] = HAMMER_IMPACT_FRACTIONS.map((_, i) =>
      sortedByX.slice(i * half, (i + 1) * half),
    );

    window.setTimeout(() => {
      if (!stage) return;
      stage.classList.add('is-fixing');
    }, startMs);

    HAMMER_IMPACT_FRACTIONS.forEach((frac, i) => {
      const wave = waves[i] ?? [];
      window.setTimeout(() => {
        if (!stage) return;
        const impact = computeHammerImpactPoint();
        playThunk();
        if (impact) {
          spawnSparks(impact.viewportX, impact.viewportY, 14);
          spawnPuffs(stage, impact.stagePctX, impact.stagePctY, 11);
        }
        wave.forEach((el) => {
          el.style.transition = 'none';
          el.classList.remove('is-fallen', 'is-falling-off');
          el.style.removeProperty('--fall-angle');
          el.style.removeProperty('--fall-origin');
          el.style.removeProperty('--fall-x');
          el.style.removeProperty('--fall-y');
          el.style.removeProperty('--fall-duration');
          void el.offsetHeight;
          el.style.transition = '';
        });
      }, startMs + frac * coreDurationMs);
    });

    window.setTimeout(() => {
      if (!stage) return;
      stage.classList.remove('is-fixing');
      cascading = false;
    }, startMs + coreDurationMs);
  }

  function runFix() {
    fixTimer = null;
    if (!stage) return;
    const fallen = stage.querySelectorAll<HTMLElement>('.skill-item.is-fallen');
    if (fallen.length === 0) {
      cascading = false;
      return;
    }

    avatar.reset();

    const arrival = pickRandom(ARRIVALS);
    const exit = pickRandom(EXITS);
    const core = CORE_HAMMER_FIX;

    // Serial timeline: arrival → core (the visible fix) → exit. The hammer's
    // impact frames inside the core duration drive the snap-back; see
    // scheduleRepair.
    const T_CORE_START = arrival.durationMs + ARRIVAL_TO_REPAIR_MS;
    const T_CORE_END = T_CORE_START + core.durationMs;
    const T_EXIT_START = T_CORE_END + CORE_TO_EXIT_HOLD_MS;

    avatar.startArrival(arrival);
    avatar.scheduleCore(core, T_CORE_START);
    avatar.scheduleExit(exit, T_EXIT_START);

    scheduleRepair(T_CORE_START, fallen, core.durationMs);
  }

  function spawnSparks(centerX: number, centerY: number, count: number) {
    // Sparks live in document.body (position: fixed) so they can fly anywhere
    // on screen and bounce off the viewport edges, settling along the bottom of
    // the window. Caller supplies the impact point in viewport coords.
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const x = centerX + side * Math.random() * 4;
        const y = centerY + (Math.random() - 0.5) * 6;

        // Bias velocity outward+up — at viewport scale they need horizontal
        // momentum to ricochet across the screen, not just shoot straight up.
        const speed = 480 + Math.random() * 720;
        const angleDeg = 10 + Math.random() * 60;
        const angleRad = (angleDeg * Math.PI) / 180;
        const vx = side * Math.cos(angleRad) * speed;
        const vy = -Math.sin(angleRad) * speed;

        const size = 2 + Math.random() * 3;
        const maxLife = 1.4 + Math.random() * 1.0;

        const el = document.createElement('div');
        el.className = 'skills-spark';
        el.style.setProperty('--spark-size', `${size}px`);
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity = '1';
        document.body.appendChild(el);

        activeSparks.push({ el, x, y, vx, vy, life: maxLife, maxLife });
        ensurePhysicsLoop();
      }, Math.random() * 60);
    }
  }

  function ensurePhysicsLoop() {
    if (physicsFrame !== null) return;
    physicsLastTime = performance.now();
    physicsFrame = requestAnimationFrame(physicsTick);
  }

  function physicsTick(now: number) {
    const dt = Math.min((now - physicsLastTime) / 1000, 1 / 30);
    physicsLastTime = now;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const GRAVITY = 2400;
    const RESTITUTION = 0.5;
    const FRICTION = 0.84;

    for (let i = activeSparks.length - 1; i >= 0; i--) {
      const s = activeSparks[i];

      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (s.y > H) {
        s.y = H;
        s.vy = -s.vy * RESTITUTION;
        s.vx *= FRICTION;
        if (Math.abs(s.vy) < 80) s.vy = 0;
      }
      if (s.y < 0) {
        s.y = 0;
        s.vy = -s.vy * RESTITUTION;
      }
      if (s.x < 0) {
        s.x = 0;
        s.vx = -s.vx * RESTITUTION;
      }
      if (s.x > W) {
        s.x = W;
        s.vx = -s.vx * RESTITUTION;
      }

      s.life -= dt;
      const lifeFrac = Math.max(0, s.life / s.maxLife);
      const opacity = lifeFrac < 0.3 ? lifeFrac / 0.3 : 1;
      const scale = 0.7 + lifeFrac * 0.4;

      s.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${scale})`;
      s.el.style.opacity = `${opacity}`;

      if (s.life <= 0) {
        s.el.remove();
        activeSparks.splice(i, 1);
      }
    }

    if (activeSparks.length > 0) {
      physicsFrame = requestAnimationFrame(physicsTick);
    } else {
      physicsFrame = null;
    }
  }

  function spawnPuffs(stageEl: HTMLElement, leftPct: number, topPct: number, count: number) {
    // Front-loaded eruption around the supplied stage-percent point: most puffs
    // in the first ~180ms, the rest trail off.
    const burstCount = Math.ceil(count * 0.65);
    for (let i = 0; i < count; i++) {
      const inBurst = i < burstCount;
      const delay = inBurst
        ? Math.random() * 180
        : 180 + (i - burstCount) * 70 + Math.random() * 50;

      window.setTimeout(() => {
        const isBack = i % 2 === 0;
        // Bias position around the impact; back puffs spread a touch wider.
        const sideRoll = Math.random();
        const side: -1 | 1 = sideRoll < 0.5 ? -1 : 1;
        const horizontalSpread = isBack ? 8 : 5;
        const left = leftPct + side * (1 + Math.random() * horizontalSpread);
        const top = topPct + (Math.random() - 0.5) * 14;

        const puff = document.createElement('div');
        puff.className = isBack ? 'skills-puff skills-puff--back' : 'skills-puff';
        puff.style.left = `${left}%`;
        puff.style.top = `${top}%`;

        const size = isBack
          ? 56 + Math.random() * 60
          : 30 + Math.random() * 40;
        // Drift outward from impact (away from center) and upward.
        const driftX = side * (20 + Math.random() * 70);
        const driftY = -(40 + Math.random() * 60);
        const rotate = side * (10 + Math.random() * 50);
        const scaleEnd = isBack ? 2.2 + Math.random() * 0.6 : 1.6 + Math.random() * 0.5;

        puff.style.setProperty('--puff-size', `${size}px`);
        puff.style.setProperty('--puff-drift-x', `${driftX}px`);
        puff.style.setProperty('--puff-drift-y', `${driftY}px`);
        puff.style.setProperty('--puff-rotate', `${rotate}deg`);
        puff.style.setProperty('--puff-scale-end', `${scaleEnd}`);

        stageEl.appendChild(puff);
        window.setTimeout(() => puff.remove(), isBack ? 1500 : 1150);
      }, delay);
    }
  }

  stage.addEventListener('click', (e) => {
    resumeAudio();
    startCascade(e.clientX, e.clientY);
  });
}
