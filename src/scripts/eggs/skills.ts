import { playBoink, playThunk, resumeAudio } from '../lib/audio';
import {
  ARRIVALS,
  AVATAR_FADE_MS,
  EXITS,
  type AvatarAnim,
  createAvatarController,
  pickRandom,
} from '../lib/avatar';
import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

const LOCK_ID = 'skills-cascade';

// How long after the last item launches before the avatar arrives. Tuned so
// the avatar's arrival animation (~1.1s) overlaps the last items' bounce-and-
// settle window, so everything is on the floor by hammer-time.
const SETTLE_AFTER_LAST_LAUNCH_MS = 850;
// Fractions of the core's duration when the hammer hits the ground. Tuned
// to the hammer-fix sheet: hammer descends to the floor around frame ~13
// (52%) and a follow-up beat around frame ~18 (72%).
const HAMMER_IMPACT_FRACTIONS = [0.52, 0.72] as const;

const CORE_HAMMER_FIX: AvatarAnim = {
  sprite: '/sprites/tim/cores/hammer-fix.png',
  durationMs: 1500,
};

// Beat after arrival lands before the hammer-fix kicks off.
const ARRIVAL_TO_REPAIR_MS = 200;
// Pause between core's last frame and the exit kicking off.
const CORE_TO_EXIT_HOLD_MS = 320;

// Physics tuning.
const GRAVITY = 2400;
const RESTITUTION_FLOOR = 0.5;
const RESTITUTION_WALL = 0.62;
const FLOOR_FRICTION = 0.78;
const SETTLE_SPEED = 40;
const FLOOR_GAP = 4;

// Boink budget — first floor impacts play a boink, capped + rate-limited
// so a 20-item cascade doesn't turn into a noise wall.
const BOINK_COOLDOWN_MS = 55;
const BOINK_MAX = 24;

type Body = {
  el: HTMLElement;
  // Rest position (viewport coords of element center, captured at launch).
  restX: number;
  restY: number;
  // Live viewport coords of the element center.
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  // Half extents for wall/floor collision.
  hw: number;
  hh: number;
  // Bodies are pre-created at rest. The wave scheduler flips `launched` later
  // — only launched bodies are physics-active. This drives the domino: the
  // first item flips early, neighbors flip on a delay, and panic spreads out.
  launched: boolean;
  settled: boolean;
  hasImpacted: boolean;
  returning: boolean;
};

type Spark = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

export function initSkills() {
  const stage = document.querySelector<HTMLElement>('.skills-stage');
  const skillsAvatar = stage?.querySelector<HTMLElement>('.skills-avatar') ?? null;
  if (!stage || !skillsAvatar) return;

  const avatar = createAvatarController(skillsAvatar);

  let cascading = false;
  let bodies: Body[] = [];
  let fixTimer: number | null = null;

  let physicsFrame: number | null = null;
  let physicsLastTime = 0;
  const activeSparks: Spark[] = [];

  let lastBoinkAt = 0;
  let boinkCount = 0;

  function startCascade(clickX: number, clickY: number) {
    if (!stage || cascading || stage.classList.contains('is-fixing')) return;
    if (!tryStart(LOCK_ID)) return;
    markDiscovered('skills');
    cascading = true;
    stage.classList.add('is-cascading');
    avatar.reset();
    boinkCount = 0;
    lastBoinkAt = 0;

    const items = Array.from(stage.querySelectorAll<HTMLElement>('.skill-item'));

    // Rank by distance from click — the nearest item goes first, panic
    // spreads outward from there.
    const ranked = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        return {
          el,
          restX: cx,
          restY: cy,
          hw: r.width / 2,
          hh: r.height / 2,
          dist: Math.hypot(cx - clickX, cy - clickY),
        };
      })
      .sort((a, b) => a.dist - b.dist);

    // Pre-create resting bodies for every item. They sit at rest (launched =
    // false) until the wave scheduler flips them. Pre-creation keeps the
    // bodies array in sync with the items list, so scheduleRepair can fly
    // every item home even if the user somehow cuts the cascade short.
    bodies = ranked.map((r) => ({
      el: r.el,
      restX: r.restX,
      restY: r.restY,
      x: r.restX,
      y: r.restY,
      vx: 0,
      vy: 0,
      angle: 0,
      spin: 0,
      hw: r.hw,
      hh: r.hh,
      launched: false,
      settled: false,
      hasImpacted: false,
      returning: false,
    }));

    // Spreading-panic pacing: 1 → 1 → 2 → 3 → 5 → domino through the rest.
    // Intensity ramps each wave so early items "tip" (low impulse, gentle
    // spin) while later items erupt. Boink loudness scales with impact speed
    // downstream, so the audio rises with the visual chaos automatically.
    const waveSizes = [1, 1, 2, 3, 5];
    const waveDelays = [0, 320, 540, 700, 830];
    const waveIntensity = [0.18, 0.32, 0.5, 0.72, 0.88];
    const FINAL_BASE = 950;
    const FINAL_STAGGER = 45;

    let cursor = 0;
    let lastLaunchAt = 0;

    waveSizes.forEach((size, w) => {
      for (let j = 0; j < size && cursor < bodies.length; j++, cursor++) {
        const body = bodies[cursor];
        const intensity = waveIntensity[w];
        const delay = waveDelays[w] + Math.random() * 50;
        window.setTimeout(() => launchBody(body, clickX, clickY, intensity), delay);
        if (delay > lastLaunchAt) lastLaunchAt = delay;
      }
    });

    // Domino tail: remaining items launch in left-to-right(ish) order with a
    // tight stagger, climbing intensity 0.92 → 1.0 across the run.
    const remaining = bodies.length - cursor;
    let extra = 0;
    while (cursor < bodies.length) {
      const body = bodies[cursor];
      const finalIntensity = 0.92 + (remaining > 1 ? (extra / (remaining - 1)) * 0.08 : 0);
      const delay = FINAL_BASE + extra * FINAL_STAGGER + Math.random() * 35;
      window.setTimeout(() => launchBody(body, clickX, clickY, finalIntensity), delay);
      if (delay > lastLaunchAt) lastLaunchAt = delay;
      cursor++;
      extra++;
    }

    if (fixTimer !== null) window.clearTimeout(fixTimer);
    fixTimer = window.setTimeout(runFix, lastLaunchAt + SETTLE_AFTER_LAST_LAUNCH_MS);
  }

  // Flip a resting body into the physics simulation. Tuned as a tip-and-fall:
  // a small sideways nudge away from the click + tumble, then gravity does the
  // real work. Intensity scales the nudge so panic still spreads outward, but
  // even the strongest wave shouldn't read as an eruption — items lose their
  // footing and drop.
  function launchBody(body: Body, clickX: number, clickY: number, intensity: number) {
    if (body.launched || body.returning) return;

    const dx = body.restX - clickX;
    const dy = body.restY - clickY;
    const dist = Math.max(20, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;

    const radial = intensity * 180;
    // Tiny upward bias so items clear their own baseline before falling — keeps
    // them from instantly clipping into the floor on a cold start.
    const lift = 20 + intensity * 50;
    const jitter = 30 + intensity * 70;

    body.vx = ux * radial + (Math.random() - 0.5) * jitter;
    // uy term kept very small — we don't want items above the click to launch
    // upward. Vertical motion is dominated by gravity, not impulse.
    body.vy = uy * radial * 0.1 - lift;
    body.spin = (Math.random() - 0.5) * (180 + intensity * 520);
    body.launched = true;

    body.el.style.transition = 'none';
    body.el.classList.add('is-flying');

    ensurePhysicsLoop();
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

    let bodyWork = false;
    for (const b of bodies) {
      if (!b.launched || b.returning) continue;
      if (!b.settled) {
        bodyWork = true;
        b.vy += GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.angle += b.spin * dt;

        const floorY = H - b.hh - FLOOR_GAP;
        if (b.y >= floorY) {
          const impactSpeed = Math.abs(b.vy);
          b.y = floorY;
          b.vy = -b.vy * RESTITUTION_FLOOR;
          b.vx *= FLOOR_FRICTION;
          b.spin *= FLOOR_FRICTION;
          if (!b.hasImpacted && impactSpeed > 220) {
            b.hasImpacted = true;
            maybeBoink(impactSpeed);
          }
          if (Math.abs(b.vy) < SETTLE_SPEED && Math.abs(b.vx) < SETTLE_SPEED) {
            b.settled = true;
            b.vx = 0;
            b.vy = 0;
            b.spin = 0;
          }
        }
        if (b.x - b.hw < 0) {
          b.x = b.hw;
          b.vx = -b.vx * RESTITUTION_WALL;
          b.spin *= 0.85;
        }
        if (b.x + b.hw > W) {
          b.x = W - b.hw;
          b.vx = -b.vx * RESTITUTION_WALL;
          b.spin *= 0.85;
        }

        const dx = b.x - b.restX;
        const dy = b.y - b.restY;
        b.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${b.angle}deg)`;
      }
    }

    // Sparks share the same loop — saves a second rAF callback.
    if (activeSparks.length > 0) {
      tickSparks(dt, W, H);
    }

    if (bodyWork || activeSparks.length > 0) {
      physicsFrame = requestAnimationFrame(physicsTick);
    } else {
      physicsFrame = null;
    }
  }

  function tickSparks(dt: number, W: number, H: number) {
    const GRAV = 2400;
    const RESTITUTION = 0.5;
    const FRICTION = 0.84;
    for (let i = activeSparks.length - 1; i >= 0; i--) {
      const s = activeSparks[i];
      s.vy += GRAV * dt;
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
  }

  function maybeBoink(impactSpeed: number) {
    const now = performance.now();
    if (now - lastBoinkAt < BOINK_COOLDOWN_MS) return;
    if (boinkCount >= BOINK_MAX) return;
    lastBoinkAt = now;
    boinkCount++;
    const intensity = Math.min(1, impactSpeed / 1400);
    playBoink(intensity);
  }

  // Viewport + stage-percent coords of the hammer strike point, ~in front of
  // the avatar's right foot. Sampled per-impact so layout shifts between
  // schedule and fire don't drift it.
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

  function runFix() {
    fixTimer = null;
    if (!stage) return;
    if (bodies.length === 0) {
      cascading = false;
      end(LOCK_ID);
      return;
    }

    avatar.reset();

    const arrival = pickRandom(ARRIVALS);
    const exit = pickRandom(EXITS);
    const core = CORE_HAMMER_FIX;

    const T_CORE_START = arrival.durationMs + ARRIVAL_TO_REPAIR_MS;
    const T_CORE_END = T_CORE_START + core.durationMs;
    const T_EXIT_START = T_CORE_END + CORE_TO_EXIT_HOLD_MS;
    const T_DONE = T_EXIT_START + exit.durationMs + AVATAR_FADE_MS;

    avatar.startArrival(arrival);
    avatar.scheduleCore(core, T_CORE_START);
    avatar.scheduleExit(exit, T_EXIT_START);

    scheduleRepair(T_CORE_START, core.durationMs);

    // Release the lock only after Tim has fully faded — otherwise a click
    // mid-exit could spawn a second avatar overlapping his fadeout.
    window.setTimeout(() => end(LOCK_ID), T_DONE);
  }

  // Each hammer impact frame: a wave of bodies fly home from wherever they
  // currently rest. Items are partitioned left-to-right by their *current*
  // x so the hammer reads as working its way across the pile.
  function scheduleRepair(startMs: number, coreDurationMs: number) {
    if (!stage) return;

    const sorted = [...bodies].sort((a, b) => a.x - b.x);
    const chunk = Math.ceil(sorted.length / HAMMER_IMPACT_FRACTIONS.length);
    const waves: Body[][] = HAMMER_IMPACT_FRACTIONS.map((_, i) =>
      sorted.slice(i * chunk, (i + 1) * chunk),
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
        wave.forEach((b) => {
          b.returning = true;
          b.settled = true;
          // Hand off from per-frame inline transform to a single CSS
          // transition back to identity — the item flies home on a smooth
          // arc set by the cubic-bezier below.
          b.el.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.18, 0.64, 1)';
          b.el.style.transform = 'translate(0, 0) rotate(0deg)';
          window.setTimeout(() => {
            b.el.classList.remove('is-flying');
            b.el.style.transition = '';
            b.el.style.transform = '';
          }, 620);
        });
      }, startMs + frac * coreDurationMs);
    });

    window.setTimeout(() => {
      if (!stage) return;
      stage.classList.remove('is-fixing');
      stage.classList.remove('is-cascading');
      cascading = false;
      bodies = [];
    }, startMs + coreDurationMs);
  }

  function spawnSparks(centerX: number, centerY: number, count: number) {
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const x = centerX + side * Math.random() * 4;
        const y = centerY + (Math.random() - 0.5) * 6;

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

  function spawnPuffs(stageEl: HTMLElement, leftPct: number, topPct: number, count: number) {
    const burstCount = Math.ceil(count * 0.65);
    for (let i = 0; i < count; i++) {
      const inBurst = i < burstCount;
      const delay = inBurst
        ? Math.random() * 180
        : 180 + (i - burstCount) * 70 + Math.random() * 50;

      window.setTimeout(() => {
        const isBack = i % 2 === 0;
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

  // Trigger is the section heading (not the whole stage) so that smaller
  // per-item Easter eggs — e.g. the TypeScript squiggle — can claim their
  // own clicks without the cascade swallowing them.
  const heading = stage.querySelector<HTMLElement>('#skills-heading');
  if (!heading) return;
  heading.addEventListener('click', (e) => {
    resumeAudio();
    startCascade(e.clientX, e.clientY);
  });
}
