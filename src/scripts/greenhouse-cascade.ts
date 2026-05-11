import { playPaperWhoosh, playPaperPat, playStackTap, resumeAudio } from './audio';
import {
  ARRIVALS,
  EXITS,
  type AvatarAnim,
  createAvatarController,
  pickRandom,
} from './avatar';

// Greenhouse Easter egg. Click "Greenhouse Software" → a chaotic burst of
// resume papers erupts upward from the company name (Greenhouse is an ATS).
// They flutter, descend, and Tim arrives to catch them in waves and stack
// them into a neat pile.
//
// Same shape as skills-cascade: arrival → core → exit, with the core's
// impact frames driving the visible "fix" (here, papers snapping onto a pile).

// ---- placeholder until catch-and-stack sprite is generated ----
const CORE_CATCH_AND_STACK: AvatarAnim = {
  sprite: '/sprites/tim/cores/catch-and-stack.png',
  durationMs: 1800,
};

// Catch impact fractions of the core — when in the animation Tim's hands
// "catch" a wave of in-flight papers and snap them onto the pile.
// Last fraction is the squaring tap-tap (any leftover papers).
const CATCH_IMPACT_FRACTIONS = [0.30, 0.55, 0.78] as const;

const ARRIVAL_TO_CORE_MS = 200;
const CORE_TO_EXIT_HOLD_MS = 480;
const PILE_FADE_MS = 700;

// How many resume sheets fly out per click. Enough to read as "a whole stack
// got knocked over" without burying the page.
const PAPER_COUNT = 18;

type Paper = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationVel: number;
  caught: boolean;
};

export function initGreenhouseCascade() {
  const stage = document.querySelector<HTMLElement>('.greenhouse-stage');
  const trigger = stage?.querySelector<HTMLElement>('.greenhouse-trigger') ?? null;
  const greenhouseAvatar = stage?.querySelector<HTMLElement>('.greenhouse-avatar') ?? null;
  const pile = stage?.querySelector<HTMLElement>('.greenhouse-pile') ?? null;
  if (!stage || !trigger || !greenhouseAvatar || !pile) return;

  const avatar = createAvatarController(greenhouseAvatar);

  let busy = false;
  const activePapers: Paper[] = [];
  let physicsFrame: number | null = null;
  let physicsLastTime = 0;
  const timers: number[] = [];
  let stackedCount = 0;

  function clearTimers() {
    timers.forEach((t) => window.clearTimeout(t));
    timers.length = 0;
  }

  function spawnPapers(originX: number, originY: number) {
    for (let i = 0; i < PAPER_COUNT; i++) {
      // Slight stagger so the burst reads as an eruption rather than a single
      // popcorn pop.
      const delay = Math.random() * 90;
      window.setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'greenhouse-paper';

        // Tiny per-paper visual variety: 3 stripe styles to suggest different
        // resume layouts. Pure CSS, no images.
        const variant = i % 3;
        if (variant === 1) el.classList.add('greenhouse-paper--variant-b');
        else if (variant === 2) el.classList.add('greenhouse-paper--variant-c');

        // Initial offset right at the trigger word — small jitter so they
        // don't all stack at one pixel.
        const jitterX = (Math.random() - 0.5) * 18;
        const jitterY = (Math.random() - 0.5) * 8;
        const x = originX + jitterX;
        const y = originY + jitterY;

        // Burst velocity: strongly upward, with horizontal spread biased
        // outward from the click point. Papers are light — modest speeds,
        // light gravity later.
        const upSpeed = 480 + Math.random() * 320;
        const sideBias = Math.random() < 0.5 ? -1 : 1;
        const sideSpeed = sideBias * (60 + Math.random() * 280);
        const rotation = (Math.random() - 0.5) * 60;
        const rotationVel = (Math.random() - 0.5) * 520;

        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rotation}deg)`;
        document.body.appendChild(el);

        activePapers.push({
          el,
          x,
          y,
          vx: sideSpeed,
          vy: -upSpeed,
          rotation,
          rotationVel,
          caught: false,
        });
        ensurePhysicsLoop();
      }, delay);
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
    // Light gravity — papers drift, not fall like rocks.
    const GRAVITY = 720;
    // Air drag on horizontal velocity (papers don't keep flying sideways)
    // and a soft cap on terminal vertical fall speed (paper terminal velocity).
    const HORIZONTAL_DRAG = 0.985;
    const TERMINAL_VY = 220;
    const ROTATION_DRAG = 0.992;

    for (let i = activePapers.length - 1; i >= 0; i--) {
      const p = activePapers[i];

      // Caught papers ride a CSS transition to their pile slot — physics is
      // off for them, but we keep them in the array so the cleanup path can
      // remove them on stage reset.
      if (p.caught) continue;

      p.vy += GRAVITY * dt;
      if (p.vy > TERMINAL_VY) p.vy = TERMINAL_VY;
      p.vx *= HORIZONTAL_DRAG;
      p.rotationVel *= ROTATION_DRAG;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotationVel * dt;

      // Off-screen guard — if a paper escapes past the bottom or sides
      // before being caught, drop it silently.
      if (p.y > H + 80 || p.x < -80 || p.x > W + 80) {
        p.el.remove();
        activePapers.splice(i, 1);
        continue;
      }

      p.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.rotation}deg)`;
    }

    if (activePapers.length > 0) {
      physicsFrame = requestAnimationFrame(physicsTick);
    } else {
      physicsFrame = null;
    }
  }

  // Returns the viewport coords of the top of the pile (where caught papers
  // should snap to). Sampled at catch time so layout shifts don't drift it.
  function computePileTop() {
    if (!pile) return null;
    const r = pile.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      // Stack grows upward — each subsequent paper sits a little higher than
      // the previous one.
      baseY: r.bottom - 6,
    };
  }

  function catchWave(targetCount: number) {
    // Pick the lowest-altitude in-flight papers (closest to landing) and
    // snap them onto the pile. A real catch reads as "he grabbed the ones
    // that were about to hit the ground".
    const inFlight = activePapers.filter((p) => !p.caught);
    if (inFlight.length === 0) return;

    inFlight.sort((a, b) => b.y - a.y);
    const wave = inFlight.slice(0, targetCount);
    if (wave.length === 0) return;

    const target = computePileTop();
    if (!target) return;

    playPaperPat(Math.random());

    wave.forEach((p, i) => {
      p.caught = true;
      const stackIdx = stackedCount + i;
      // Each paper stacks 2px above the previous, with a tiny rotation
      // jitter so the pile isn't perfectly square — feels hand-stacked.
      const stackOffsetY = -stackIdx * 2;
      const restRotation = (Math.random() - 0.5) * 6;

      // Add a CSS transition for the snap-to-pile, then schedule a removal
      // of the in-flight transform style — the resting state takes over.
      p.el.style.transition =
        'transform 0.28s cubic-bezier(0.42, 0.0, 0.6, 1.2)';
      p.el.style.transform =
        `translate(${target.x}px, ${target.baseY + stackOffsetY}px) ` +
        `translate(-50%, -100%) rotate(${restRotation}deg)`;

      // Once the paper has settled, transfer it from body into the pile so
      // it can fade with the pile during exit.
      window.setTimeout(() => {
        if (!pile) return;
        // Re-anchor: convert to pile-relative absolute position so it stays
        // put when we drop the body-level transform.
        const pileRect = pile.getBoundingClientRect();
        const restedX = target.x - pileRect.left;
        const restedY = target.baseY + stackOffsetY - pileRect.top;
        p.el.style.transition = 'opacity 0.6s ease-out';
        p.el.style.transform =
          `translate(${restedX}px, ${restedY}px) translate(-50%, -100%) rotate(${restRotation}deg)`;
        p.el.classList.add('is-stacked');
        pile.appendChild(p.el);
      }, 300);
    });

    stackedCount += wave.length;
  }

  function squareStack() {
    // Final beat: any remaining in-flight papers snap, plus the visible
    // "tap tap" sound. If everything's already caught, still play the tap
    // — it's the punchline.
    const remaining = activePapers.filter((p) => !p.caught).length;
    if (remaining > 0) catchWave(remaining);
    playStackTap();
  }

  function teardown() {
    // Fade pile out, then remove all stacked + in-flight papers and reset.
    const stacked = pile ? Array.from(pile.querySelectorAll<HTMLElement>('.greenhouse-paper')) : [];
    stacked.forEach((el) => {
      el.style.opacity = '0';
    });

    timers.push(
      window.setTimeout(() => {
        // Drop pile contents.
        stacked.forEach((el) => el.remove());
        // Drop any papers that never got caught (off-screen guard handles
        // most, this catches edge cases).
        activePapers.forEach((p) => p.el.remove());
        activePapers.length = 0;
        stackedCount = 0;
        busy = false;
      }, PILE_FADE_MS),
    );
  }

  function start(clickX: number, clickY: number) {
    if (busy) return;
    busy = true;
    clearTimers();
    avatar.reset();

    playPaperWhoosh();
    spawnPapers(clickX, clickY);

    const arrival = pickRandom(ARRIVALS);
    const exit = pickRandom(EXITS);
    const core = CORE_CATCH_AND_STACK;

    const T_CORE_START = arrival.durationMs + ARRIVAL_TO_CORE_MS;
    const T_CORE_END = T_CORE_START + core.durationMs;
    const T_EXIT_START = T_CORE_END + CORE_TO_EXIT_HOLD_MS;
    const T_TEARDOWN_START = T_EXIT_START + exit.durationMs;

    avatar.startArrival(arrival);
    avatar.scheduleCore(core, T_CORE_START);
    avatar.scheduleExit(exit, T_EXIT_START);

    // Each catch wave grabs roughly 1/N of the papers. Last wave gets
    // whatever's left and includes the squaring tap-tap.
    const perWave = Math.ceil(PAPER_COUNT / CATCH_IMPACT_FRACTIONS.length);
    CATCH_IMPACT_FRACTIONS.forEach((frac, i) => {
      const at = T_CORE_START + frac * core.durationMs;
      const isLast = i === CATCH_IMPACT_FRACTIONS.length - 1;
      timers.push(
        window.setTimeout(() => {
          if (isLast) squareStack();
          else catchWave(perWave);
        }, at),
      );
    });

    timers.push(window.setTimeout(teardown, T_TEARDOWN_START));
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    resumeAudio();
    start(e.clientX, e.clientY);
  });
}
