import { playPaperWhoosh, resumeAudio } from '../lib/audio';
import {
  ARRIVALS,
  type AvatarAnim,
  createAvatarController,
  EXITS,
  getCoreDurationMs,
  pickRandom,
} from '../lib/avatar';
import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

const LOCK_ID = 'greenhouse-cascade';

// Greenhouse Easter egg. Click "Greenhouse Software" → a burst of resume
// papers erupts upward from the company name (Greenhouse is an ATS), then
// flutters down and settles at the bottom of the role's stage div. After
// the papers settle, Tim arrives from off-screen left, walks rightward
// pushing a wide push-broom; landed papers caught in the broom's hitbox get
// shoved off the right edge of the stage. Tim exits stage right.

// How many resume sheets fly out per click.
const PAPER_COUNT = 100;

// Gap between the paper's bottom edge and the bottom of the stage when
// landed. Small, so it reads as "on the floor of this section".
const GROUND_GAP_PX = 6;

// Sprite box dimension (matches .greenhouse-paper CSS — sprite is 48×48
// native pixel art). The burst graphic fills most of the box; the feather
// graphic sits in the middle band, so landing alignment using the full box
// height leaves a comfortable gap above the actual rendered feather.
const PAPER_SIZE_PX = 48;

// Avatar render width (matches .greenhouse-avatar CSS).
const AVATAR_W = 192;

// Push-broom core. Single play of the 25-frame v2 sprite — cycling >1
// makes Tim visibly drop and re-pick-up the broom at every loop boundary
// (the first/last 5 frames are Original-pose seam locks). Two more
// workarounds for the v2 sprite specifically:
//
//   - skipFrames: 10 — v2's first 10 frames are Tim standing without a
//     broom (slow pickup phase). Negative CSS animation-delay starts the
//     visible sprite at frame 10, where the broom first appears.
//   - durationMs: 3500 — sets per-frame timing (~140ms/frame). The
//     effective on-screen core time is durationMs - skipMs (3500 - 1400 =
//     2100ms), which is also the avatar's translate window — see
//     getCoreDurationMs.
const CORE_BROOM_SWEEP: AvatarAnim = {
  sprite: '/sprites/tim/cores/broom-sweep.png',
  durationMs: 3500,
  cycles: 1,
  skipFrames: 10,
};

// Beat after the click before the sweep sequence kicks off. Tuned so all
// papers have time to burst → drift → land before Tim arrives.
const SWEEP_DELAY_AFTER_CLICK_MS = 2200;
// Beat after arrival lands before the sweep core starts.
const ARRIVAL_TO_SWEEP_MS = 100;

// Computer-operate core. Tim pivots away from camera to face the chassis
// behind him, types on the (invisible) console keyboard at chest level,
// then turns back to face forward. The animation choreography:
//   frames 0-6  — anticipation turn (head looks back, body rotates)
//   frames 7-18 — back-turned typing (chest-level, small hand motions)
//   frames 19-24 — rotate back to face forward
// Both seam frames (0, 24) are locked to the canonical Original pose so the
// sprite chains cleanly from the broom-sweep's core-held state and into a
// subsequent exit. No skipFrames: every frame is meaningful motion.
const CORE_TERMINAL_TYPE: AvatarAnim = {
  sprite: '/sprites/tim/cores/terminal-type.png',
  durationMs: 2400,
  cycles: 1,
};

// Hold at the receptacle after the sweep ends, so the eye can register
// "all the papers are piled at the slot" before Tim starts operating the
// machine. He stays in place for the terminal-type core — no relocation, no fade,
// no re-arrival; any "Tim disappears mid-sequence" beat (even just opacity)
// reads as an exit, which is wrong since he hasn't left yet. Conveniently,
// the broom-end park leaves his body roughly in front of the CRT already
// (brush front parks at the receptacle, but his 192px body extends ~96px
// left of that, landing him under the screen).
const RECEPTACLE_HOLD_MS = 500;
// Beat between the receptacle hold and the terminal-type core. Both ends
// are seam-locked to the Original standing pose, so this is a clean direct
// sprite chain with no visible pop.
const HOLD_TO_TYPE_MS = 0;
// Fraction through the terminal-type core when the digitization fires.
// Chosen so it lands during the back-turned typing window (frames 7-18,
// roughly 28-72% of the animation), not during the anticipation turn or
// the turn-back. 0.45 = frame ~11, comfortably mid-typing.
const TYPE_TO_DIGITIZE_FRAC = 0.45;
// Time between successive papers vaporizing in the cascade. Total cascade
// span = PAPER_COUNT × this. With 100 papers @ 14ms = 1400ms — fast enough
// to read as a single event, slow enough that you can see individual shards
// being pulled into the slot.
const DIGITIZE_STAGGER_MS = 14;
// Per-paper dissolve duration (flash → particle flight). Particle flight is
// driven by the CSS transition on .greenhouse-pixel.
const DIGITIZE_FLASH_MS = 200;
const DIGITIZE_FLIGHT_MS = 520;
// How many pixel shards each paper becomes.
const SHARDS_PER_PAPER = 4;
// Initial outward kick before shards turn toward the slot — gives each
// dissolution a tiny burst silhouette so the eye registers each paper.
const SHARD_KICK_PX = 6;
// Pause after the cascade finishes before the scorecard flash begins.
const DIGITIZE_TO_FLASH_MS = 250;
// Tim's exit timing inside the scorecard sequence. The strong-yes "landing"
// pulse hits at FLASH_FAST*5 + FLASH_MED*5 + FLASH_SLOW*4 ms into the flash;
// Tim peels off shortly after that so he's gone by the time the chassis
// fades. Computed at runtime from those constants.
const EXIT_AFTER_LANDING_MS = 400;

// Broom front edge, as a fraction of the avatar bounding box. Any landed
// paper at or behind this x-position gets swept — there is no rear bound,
// because once the brush has crossed a paper it's "behind the broom" and
// belongs in the pile regardless. Tuned to the painted brush's leading edge.
const BROOM_FRONT_FRAC = 1.05;
// Extra space to start the avatar off-screen-left, beyond -120 (which is the
// leftmost a paper can land per the existing side-cull). With this margin
// the brush's front edge starts to the LEFT of the leftmost possible paper,
// so every paper is initially ahead of the brush and gets caught naturally
// as the brush moves over it — no instant-snap teleporting from the left.
const SWEEP_START_LEFT_MARGIN = 160;

// Scorecard rating sequence. Plays after the resumes get loaded into the
// computer: screen flashes through Greenhouse's five scorecard ratings —
// Strong No → No → Mixed → Yes → Strong Yes — getting progressively slower,
// then lands on Strong Yes with a celebratory pulse. Icons are inlined SVG
// (Material-style paths) so they render crisp at any size without needing
// a sprite asset; colors match the Greenhouse scorecard reference.
type Rating = 'strong-no' | 'no' | 'mixed' | 'yes' | 'strong-yes';

const RATING_ORDER: Rating[] = ['strong-no', 'no', 'mixed', 'yes', 'strong-yes'];

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

const RATING_GLYPHS: Record<Rating, { svg: string; glow: string }> = {
  'strong-no':  { svg: ICON_STRONG_NO,  glow: '#e23b29' },
  'no':         { svg: ICON_NO,         glow: '#e23b29' },
  'mixed':      { svg: ICON_MIXED,      glow: '#f4b942' },
  'yes':        { svg: ICON_YES,        glow: '#43b5a0' },
  'strong-yes': { svg: ICON_STRONG_YES, glow: '#43b5a0' },
};

// Tempo of the flash. Two fast cycles set up the "slot-machine" beat, then
// a slower pass deliberately approaches the answer, then it lands on Strong
// Yes for a longer celebratory hold. After the hold the WHOLE supercomputer
// fades (with Strong Yes still on the screen) — no flash-back-to-idle-'g'
// beat between the answer and the chassis leaving.
const FLASH_FAST_MS = 70;
const FLASH_MED_MS = 110;
const FLASH_SLOW_MS = 180;
const FLASH_LANDING_HOLD_MS = 2200;
// Matches .greenhouse-supercomputer's opacity transition.
const COMPUTER_FADE_OUT_MS = 380;

// Swept-paper pile geometry. Swept papers don't collapse to a single point
// — they spread out in a small grid in front of the brush, each new paper
// taking the next slot. Row N stacks above row N-1, so the pile grows up
// as well as forward and reads as a tidy heap instead of a clumped ball.
const PILE_ROW_SIZE = 6;
const PILE_X_STEP = 5;
const PILE_Y_STEP = 5;
const PILE_BACK_X = 4;
// Tiny per-paper jitter (px) so the grid doesn't look mechanical.
const PILE_JITTER_X = 3;
const PILE_JITTER_Y = 2;

type Paper = {
  el: HTMLElement;
  // Stage-local coordinates (papers are position: absolute inside .greenhouse-stage).
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationVel: number;
  landed: boolean;
  // Has the paper crossed its apex and morphed to feather/profile mode?
  profileMode: boolean;
  scale: number;
  // Lateral flutter — each paper has its own sinusoidal sway acceleration
  // so the flock doesn't oscillate in lockstep.
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  birthTime: number;
  // Once swept, the paper rides the brush in a tidy grid pile. sweptOffsetX
  // is its fixed x distance forward of the brush front (positive — paper
  // is in front of brush, being pushed). sweptOffsetY is its fixed y
  // displacement from the floor (≤ 0 — higher rows of the pile sit above
  // lower ones).
  swept: boolean;
  sweptOffsetX: number;
  sweptOffsetY: number;
};

export function initGreenhouse() {
  const stage = document.querySelector<HTMLElement>('.greenhouse-stage');
  const trigger = stage?.querySelector<HTMLElement>('.greenhouse-trigger') ?? null;
  const avatarEl = stage?.querySelector<HTMLElement>('.greenhouse-avatar') ?? null;
  const screenEl = stage?.querySelector<HTMLElement>('.greenhouse-screen') ?? null;
  const superEl =
    stage?.querySelector<HTMLElement>('.greenhouse-supercomputer') ?? null;
  if (!stage || !trigger || !avatarEl) return;

  // Right tower's left edge in stage-local coords. Measured from the
  // supercomputer sprite: the painted top of the right-hand "RESUMES" tower
  // starts at pixel x=277 within the 384px frame (everything left of that is
  // the CRT + desk). Tim's sweep terminates with the brush front parked at
  // this edge so the pile lands right in front of the receptacle slot, ready
  // for the (future) pickup-and-insert animation. Works across viewports —
  // getBoundingClientRect returns post-transform bounds, so the mobile
  // scale(0.65) is honoured automatically.
  const RIGHT_TOWER_LEFT_FRAC = 277 / 384;
  function getReceptacleLeft(): number {
    if (!stage || !superEl) return stage!.clientWidth;
    const stageRect = stage.getBoundingClientRect();
    const superRect = superEl.getBoundingClientRect();
    const superLeft = superRect.left - stageRect.left;
    return superLeft + RIGHT_TOWER_LEFT_FRAC * superRect.width;
  }

  // Right edge of the entire supercomputer element in stage-local coords.
  // Used as a generous upper bound for the swept-paper cull so a stray
  // particle past the chassis still gets cleaned up. Pile normally parks
  // well to the left of this (at the receptacle); this is a safety net.
  function getSuperRight(): number {
    if (!stage || !superEl) return stage!.clientWidth;
    const stageRect = stage.getBoundingClientRect();
    const superRect = superEl.getBoundingClientRect();
    return superRect.right - stageRect.left;
  }

  // Stage-local point the digitized pixel shards converge on. Picked roughly
  // at the top-center of the painted RESUMES tower (right side of the
  // chassis, near its intake). Coordinates in fractions of the 384px sprite;
  // tune these if the slot doesn't read as the visual sink.
  const SLOT_X_FRAC = (277 + (360 - 277) / 2) / 384;
  const SLOT_Y_FRAC = 110 / 384;
  function getSlotCenter(): { x: number; y: number } {
    if (!stage || !superEl) return { x: 0, y: 0 };
    const stageRect = stage.getBoundingClientRect();
    const superRect = superEl.getBoundingClientRect();
    return {
      x: superRect.left - stageRect.left + SLOT_X_FRAC * superRect.width,
      y: superRect.top - stageRect.top + SLOT_Y_FRAC * superRect.height,
    };
  }

  const avatar = createAvatarController(avatarEl);

  const activePapers: Paper[] = [];
  // Pixel shards spawned by digitizePaper. Tracked separately from
  // activePapers so a re-click can vacuum them out even after their source
  // paper element has been removed.
  const activeParticles: HTMLElement[] = [];
  let physicsFrame: number | null = null;
  let physicsLastTime = 0;
  // Increments for every paper that gets caught by the broom, used to
  // assign each paper its slot in the pile grid. Reset on clearAll.
  let sweptCount = 0;
  // Every setTimeout used to drive the sweep sequence is tracked here so a
  // mid-sweep re-click can cancel them all atomically. Includes the initial
  // delay timer + the sweep-active on/off flips inside runSweep.
  const sweepTimers: number[] = [];
  // Broom sweep is driven by the physics loop reading these refs each
  // tick — single source of truth for both the avatar's `left` and the
  // brush hitbox.
  let sweepStartTime = 0;
  let sweepEndTime = 0;
  let sweepFromX = 0;
  let sweepToX = 0;
  let sweepActive = false;

  function clearAll() {
    activePapers.forEach((p) => p.el.remove());
    activePapers.length = 0;
    activeParticles.forEach((el) => el.remove());
    activeParticles.length = 0;
    sweepTimers.forEach((t) => window.clearTimeout(t));
    sweepTimers.length = 0;
    sweepActive = false;
    sweptCount = 0;
    avatar.reset();
    avatarEl!.style.left = '';
    stage!.classList.remove('is-active');
    if (screenEl) {
      screenEl.classList.remove('is-flashing', 'is-landing');
      screenEl.innerHTML = '';
      screenEl.style.removeProperty('--gh-screen-glow');
    }
  }

  // Plays the scorecard-rating flash sequence on the supercomputer's CRT.
  // Caller decides when to invoke (e.g., after the resumes have been
  // loaded into the RESUMES slot). Each scheduled tick is registered with
  // sweepTimers so a re-click resets cleanly via clearAll. Honours
  // prefers-reduced-motion by jumping straight to the Strong Yes landing.
  function runScorecardFlash() {
    if (!screenEl) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const showRating = (r: Rating, withLanding = false) => {
      const { svg, glow } = RATING_GLYPHS[r];
      screenEl.innerHTML = svg;
      screenEl.style.setProperty('--gh-screen-glow', glow);
      if (withLanding) {
        // Force the landing class to retrigger the keyframes even if the
        // node already had it from a prior click within the same session.
        screenEl.classList.remove('is-landing');
        void screenEl.offsetWidth;
        screenEl.classList.add('is-landing');
      }
    };

    screenEl.classList.add('is-flashing');

    if (reduced) {
      showRating('strong-yes', false);
      sweepTimers.push(
        window.setTimeout(() => screenEl.classList.remove('is-flashing'), 2000),
      );
      return;
    }

    // Build the tempo: two fast cycles (slot-machine spin), one slower
    // cycle that stops one short, then the deliberate Strong Yes landing.
    const ticks: Array<{ rating: Rating; ms: number; landing?: boolean }> = [];
    for (const r of RATING_ORDER) ticks.push({ rating: r, ms: FLASH_FAST_MS });
    for (const r of RATING_ORDER) ticks.push({ rating: r, ms: FLASH_MED_MS });
    for (const r of RATING_ORDER.slice(0, 4)) ticks.push({ rating: r, ms: FLASH_SLOW_MS });
    ticks.push({ rating: 'strong-yes', ms: FLASH_LANDING_HOLD_MS, landing: true });

    let t = 0;
    for (const step of ticks) {
      const r = step.rating;
      const landing = step.landing === true;
      sweepTimers.push(window.setTimeout(() => showRating(r, landing), t));
      t += step.ms;
    }
    // End of the strong-yes hold — drop .is-active so the whole
    // supercomputer (with Strong Yes still showing on its CRT) fades out
    // as one unit. The child screen overlay inherits the parent's
    // dwindling visibility, so the answer fades with the chassis instead
    // of flashing back to the idle 'g' first. Article text also un-dims.
    sweepTimers.push(
      window.setTimeout(() => stage!.classList.remove('is-active'), t),
    );
    // After the chassis is fully gone, clean up the screen DOM so a
    // re-click starts from a blank state.
    sweepTimers.push(
      window.setTimeout(() => {
        screenEl.classList.remove('is-flashing', 'is-landing');
        screenEl.innerHTML = '';
        screenEl.style.removeProperty('--gh-screen-glow');
        end(LOCK_ID);
      }, t + COMPUTER_FADE_OUT_MS + 80),
    );
  }

  function spawnPapers(originLeft: number, originWidth: number, originY: number) {
    // All papers burst out at the same instant — no stagger.
    for (let i = 0; i < PAPER_COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'greenhouse-paper';

      // Spawn anywhere along the trigger word's horizontal extent, on the
      // same horizontal line the user clicked. Reads as the whole word
      // erupting, not a single point exploding.
      const x = originLeft + Math.random() * originWidth;
      const jitterY = (Math.random() - 0.5) * 8;
      const y = originY + jitterY;

      // Burst velocity: modest upward kick, with horizontal spread biased
      // outward from the click point. Tuned so peak height stays roughly
      // within the role section.
      const upSpeed = 220 + Math.random() * 220;
      const sideBias = Math.random() < 0.5 ? -1 : 1;
      const sideSpeed = sideBias * (40 + Math.random() * 220);
      const rotation = (Math.random() - 0.5) * 60;
      const rotationVel = (Math.random() - 0.5) * 360;
      // Sprite is 48×48 native; render slightly above 1× with per-paper
      // variance for visual interest. ~43–67px on screen.
      const scale = 0.9 + Math.random() * 0.5;
      const swayAmp = 70 + Math.random() * 110;
      const swayFreq = 1.2 + Math.random() * 1.6;
      const swayPhase = Math.random() * Math.PI * 2;
      const birthTime = performance.now();

      el.style.transform =
        `translate(${x}px, ${y}px) translate(-50%, -50%) ` +
        `rotate(${rotation}deg) scale(${scale})`;
      stage!.appendChild(el);

      activePapers.push({
        el,
        x,
        y,
        vx: sideSpeed,
        vy: -upSpeed,
        rotation,
        rotationVel,
        landed: false,
        profileMode: false,
        scale,
        swayAmp,
        swayFreq,
        swayPhase,
        birthTime,
        swept: false,
        sweptOffsetX: 0,
        sweptOffsetY: 0,
      });
    }
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

    const stageW = stage!.clientWidth;
    const stageH = stage!.clientHeight;
    // Swept-pile cull threshold. On wide viewports the supercomputer sits
    // OUTSIDE the article (extends to ~stageW + 408); we need the pile to
    // clear that right edge before being deleted, not the stage's right
    // edge. On narrow viewports the chassis is anchored right:0 so superRight
    // === stageW and this collapses back to the original behaviour.
    const superRight = getSuperRight();
    const sweptCullX = Math.max(stageW, superRight) + 60;
    // Faster fall than the previous pass — still feathery, but you can
    // actually see them land in a reasonable beat.
    const GRAVITY = 460;
    const HORIZONTAL_DRAG = 0.985;
    const TERMINAL_VY = 210;
    const ROTATION_DRAG = 0.988;
    const REST_DRAG = 0.82;

    let anyMoving = false;

    // Broom front edge in stage-local coords, if a sweep is active.
    // Computed once per tick from the avatar's current position; we also
    // write avatarEl.style.left here so there's a single source of truth
    // for sweep motion.
    let brushFront = 0;
    if (sweepActive) {
      const span = sweepEndTime - sweepStartTime;
      const t = Math.min(1, Math.max(0, (now - sweepStartTime) / span));
      const avatarX = sweepFromX + (sweepToX - sweepFromX) * t;
      avatarEl!.style.left = `${avatarX}px`;
      brushFront = avatarX + AVATAR_W * BROOM_FRONT_FRAC;
    }

    for (let i = activePapers.length - 1; i >= 0; i--) {
      const p = activePapers[i];

      // Swept papers ride the brush in their assigned pile slot while the
      // sweep is active — their x/y are recomputed each tick from the
      // current brushFront + their fixed sweptOffsetX/Y, so the whole pile
      // glides forward together at the brush's pace. Once sweepActive flips
      // off (Tim parked at the receptacle), we stop touching them — they
      // stay rendered where the last sweep-active tick put them, parked
      // right in front of the slot until clearAll runs.
      if (p.swept) {
        if (!sweepActive) continue;
        const landY = stageH - GROUND_GAP_PX - (PAPER_SIZE_PX / 2) * p.scale;
        p.x = brushFront + p.sweptOffsetX;
        p.y = landY + p.sweptOffsetY;
        if (p.x > sweptCullX) {
          p.el.remove();
          activePapers.splice(i, 1);
          continue;
        }
        p.el.style.transform =
          `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) ` +
          `rotate(${p.rotation}deg) scale(${p.scale})`;
        anyMoving = true;
        continue;
      }

      if (p.landed) {
        // Broom contact: any landed paper at or behind the brush front
        // gets swept. No rear bound — once the broom has crossed a paper
        // it's part of the pile. Robust to fast sweeps and to papers
        // that landed in the leftmost margin.
        if (sweepActive && p.x <= brushFront) {
          p.swept = true;
          // Assign this paper a slot in the pile grid. Row 0 sits on the
          // floor immediately in front of the brush; later rows stack up
          // and slightly back, so the pile grows up + forward.
          const idx = sweptCount++;
          const row = Math.floor(idx / PILE_ROW_SIZE);
          const col = idx % PILE_ROW_SIZE;
          p.sweptOffsetX =
            PILE_BACK_X + col * PILE_X_STEP +
            (Math.random() - 0.5) * PILE_JITTER_X;
          p.sweptOffsetY =
            -row * PILE_Y_STEP + (Math.random() - 0.5) * PILE_JITTER_Y;
          // Lock papers' rotation to a small static tilt — a neat pile
          // doesn't tumble, it sits.
          p.rotation = (Math.random() - 0.5) * 16;
          p.rotationVel = 0;
          continue;
        }
        // Landed papers gently lose any residual sideways drift and rotation,
        // then go fully static. Once everything is static we stop the loop
        // (unless the sweep is still running).
        if (Math.abs(p.vx) > 0.5 || Math.abs(p.rotationVel) > 1) {
          p.vx *= REST_DRAG;
          p.rotationVel *= REST_DRAG;
          p.x += p.vx * dt;
          p.rotation += p.rotationVel * dt;
          p.el.style.transform =
            `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) ` +
            `rotate(${p.rotation}deg) scale(${p.scale})`;
          anyMoving = true;
        }
        continue;
      }

      const tAlive = (now - p.birthTime) / 1000;

      // Lateral flutter. Each paper integrates its own sinusoidal sway
      // acceleration into vx, then drag pulls it back. Net effect: slow
      // side-to-side drift, out of phase across the flock.
      const swayAccel = p.swayAmp * Math.sin(p.swayFreq * tAlive + p.swayPhase);
      p.vx += swayAccel * dt;

      // Broadside lift. When the paper faces the air flat-on (rotation near
      // 0° or 180°) it catches drag and falls slower; edge-on it slips
      // through. cos(2·rot) is 1 when flat, -1 when edge-on — only the
      // positive half subtracts from gravity.
      const rotRad = (p.rotation * Math.PI) / 180;
      const broadside = Math.max(0, Math.cos(2 * rotRad));
      const effectiveGravity = GRAVITY * (1 - broadside * 0.28);

      p.vy += effectiveGravity * dt;
      if (p.vy > TERMINAL_VY) p.vy = TERMINAL_VY;
      p.vx *= HORIZONTAL_DRAG;
      p.rotationVel *= ROTATION_DRAG;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotationVel * dt;

      // Apex morph: as soon as the paper stops rising, swap to the thin
      // profile/feather visual. The CSS transition smooths the shape change
      // so it reads as the paper tipping out of plane.
      if (!p.profileMode && p.vy >= 0) {
        p.profileMode = true;
        p.el.classList.add('is-falling');
      }

      // Side culls. Papers can leave the stage horizontally — let them go a
      // bit past the edge for visual continuity, then drop them.
      if (p.x < -120 || p.x > stageW + 120) {
        p.el.remove();
        activePapers.splice(i, 1);
        continue;
      }

      // Landing: bottom edge of the (scaled) paper-sprite box reaches the
      // floor of the stage. The feather graphic sits in the middle band of
      // the box, so using the full box height as the reference lands the
      // visible feather a little above the absolute floor — feels right.
      const landY = stageH - GROUND_GAP_PX - (PAPER_SIZE_PX / 2) * p.scale;
      if (p.y >= landY && p.vy > 0) {
        p.y = landY;
        p.vy = 0;
        // Keep a fraction of horizontal velocity so the paper visibly skids
        // a moment after landing before friction stops it.
        p.vx *= 0.35;
        p.rotationVel *= 0.25;
        p.landed = true;
      }

      p.el.style.transform =
        `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) ` +
        `rotate(${p.rotation}deg) scale(${p.scale})`;
      anyMoving = true;
    }

    // Keep the physics loop alive while the sweep is running even if all
    // papers are at rest — the broom is moving and we still need to check
    // for contact each frame.
    if (anyMoving || sweepActive) {
      physicsFrame = requestAnimationFrame(physicsTick);
    } else {
      physicsFrame = null;
    }
  }

  // Vaporizes one paper into a small burst of pixel shards that stream into
  // the receptacle slot. Called per-paper by digitizePile, staggered.
  function digitizePaper(p: Paper, slotX: number, slotY: number) {
    // Capture the paper's last on-floor position before we mutate anything.
    // p.x / p.y are stage-local; shards spawn there, then transition to the
    // delta needed to land at the slot.
    const startX = p.x;
    const startY = p.y;

    // Phase 1: paper itself flashes + lifts via CSS keyframes. The paper's
    // transform is still being driven by physicsTick on the sweep-tail, but
    // sweepActive is false by the time we get here, so the last transform
    // sticks and the filter+opacity animation plays cleanly over it.
    p.el.classList.add('is-digitizing');

    // Phase 2: after the flash, swap the paper out for shards.
    sweepTimers.push(
      window.setTimeout(() => {
        // Drop from activePapers so physicsTick (if still running) stops
        // touching it, and remove the DOM node.
        const idx = activePapers.indexOf(p);
        if (idx >= 0) activePapers.splice(idx, 1);
        p.el.remove();

        const dx = slotX - startX;
        const dy = slotY - startY;
        for (let i = 0; i < SHARDS_PER_PAPER; i++) {
          const shard = document.createElement('div');
          shard.className = 'greenhouse-pixel';
          // Spawn at the paper's last position. Outward kick gives each
          // shard a brief silhouette so the dissolve reads per-paper rather
          // than as a uniform blur.
          const angle = (Math.PI * 2 * i) / SHARDS_PER_PAPER + Math.random() * 0.5;
          const kick = SHARD_KICK_PX * (0.6 + Math.random() * 0.6);
          shard.style.setProperty('--gh-pixel-x', `${startX}px`);
          shard.style.setProperty('--gh-pixel-y', `${startY}px`);
          shard.style.setProperty('--gh-pixel-kick-x', `${Math.cos(angle) * kick}px`);
          shard.style.setProperty('--gh-pixel-kick-y', `${Math.sin(angle) * kick}px`);
          // Target: kick collapses, position shifts by (dx,dy) with a small
          // per-shard jitter so the convergence isn't a single laser-tight point.
          const jitterX = (Math.random() - 0.5) * 8;
          const jitterY = (Math.random() - 0.5) * 8;
          shard.style.setProperty('--gh-pixel-tx', `${startX + dx + jitterX}px`);
          shard.style.setProperty('--gh-pixel-ty', `${startY + dy + jitterY}px`);
          stage!.appendChild(shard);
          activeParticles.push(shard);
          // Kick off the transition next frame so the browser registers the
          // initial transform before the target one is set.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => shard.classList.add('is-flying'));
          });
          // Clean up after the flight finishes.
          const myShard = shard;
          sweepTimers.push(
            window.setTimeout(() => {
              const pi = activeParticles.indexOf(myShard);
              if (pi >= 0) activeParticles.splice(pi, 1);
              myShard.remove();
            }, DIGITIZE_FLIGHT_MS + 80),
          );
        }
      }, DIGITIZE_FLASH_MS),
    );
  }

  // Cascades digitizePaper across every remaining paper, top-of-pile first.
  // Returns the total ms span of the cascade so the caller can chain the
  // scorecard flash after it.
  function digitizePile(): number {
    // Snapshot since digitizePaper mutates activePapers as papers turn into
    // shards. Sort by pile y-offset ascending (most negative = top row),
    // tie-break left-to-right so a row vacuums in a readable order.
    const snapshot = [...activePapers].sort((a, b) => {
      if (a.sweptOffsetY !== b.sweptOffsetY) return a.sweptOffsetY - b.sweptOffsetY;
      return a.sweptOffsetX - b.sweptOffsetX;
    });
    const slot = getSlotCenter();
    snapshot.forEach((p, i) => {
      sweepTimers.push(
        window.setTimeout(() => digitizePaper(p, slot.x, slot.y), i * DIGITIZE_STAGGER_MS),
      );
    });
    return snapshot.length * DIGITIZE_STAGGER_MS + DIGITIZE_FLASH_MS + DIGITIZE_FLIGHT_MS;
  }

  // After the broom-sweep parks Tim at the receptacle, this is the rest of
  // the show: Tim holds a moment, then directly transitions into the
  // terminal-type core IN PLACE. The broom-sweep's last frame and the
  // terminal-type's first frame are both the Original standing pose, so
  // the sprite swap is invisible. He never disappears mid-sequence (any
  // opacity dip reads as an exit and breaks the continuity); the only
  // actual exit is the final one after Strong Yes lands.
  function runKeyboardSequence() {
    if (!stage || !avatarEl) return;

    const typeCore = CORE_TERMINAL_TYPE;

    // Local timeline t=0 = start of this sequence (i.e., end of sweep core).
    const T_TYPE_START = RECEPTACLE_HOLD_MS + HOLD_TO_TYPE_MS;
    const typeMs = getCoreDurationMs(typeCore);
    const T_DIGITIZE_START = T_TYPE_START + Math.round(typeMs * TYPE_TO_DIGITIZE_FRAC);
    const T_TYPE_END = T_TYPE_START + typeMs;

    // 1) Tim plays the terminal-type core in place: turns to face the
    //    chassis behind him, types at chest level, turns back.
    sweepTimers.push(
      window.setTimeout(() => avatar.scheduleCore(typeCore, 0), T_TYPE_START),
    );

    // 2) Mid-typing (while Tim is still back-turned), the receptacle
    //    digitizes the pile.
    sweepTimers.push(window.setTimeout(digitizePile, T_DIGITIZE_START));

    // 3) After both the typing core ends AND the digitize cascade finishes,
    //    fire the scorecard flash. Cascade length depends on live paper
    //    count at fire time; use a worst-case bound derived from PAPER_COUNT
    //    so we can schedule eagerly. Flash starts at the later of (typing
    //    end + small gap) and (digitize start + bound + small gap).
    const digitizeBoundMs =
      PAPER_COUNT * DIGITIZE_STAGGER_MS + DIGITIZE_FLASH_MS + DIGITIZE_FLIGHT_MS;
    const T_FLASH_START = Math.max(
      T_TYPE_END + DIGITIZE_TO_FLASH_MS,
      T_DIGITIZE_START + digitizeBoundMs + DIGITIZE_TO_FLASH_MS,
    );
    sweepTimers.push(window.setTimeout(runScorecardFlash, T_FLASH_START));

    // 4) Tim exits during the Strong-Yes landing hold, so he's gone before
    //    the chassis fades. Landing pulse begins at:
    //    5*FLASH_FAST + 5*FLASH_MED + 4*FLASH_SLOW into the flash.
    const flashLandingOffset =
      5 * FLASH_FAST_MS + 5 * FLASH_MED_MS + 4 * FLASH_SLOW_MS;
    const T_FINAL_EXIT_START = T_FLASH_START + flashLandingOffset + EXIT_AFTER_LANDING_MS;
    sweepTimers.push(
      window.setTimeout(() => {
        const finalExit = pickRandom(EXITS);
        avatar.scheduleExit(finalExit, 0);
      }, T_FINAL_EXIT_START),
    );
  }

  function runSweep() {
    if (!stage || !avatarEl) return;
    avatar.reset();

    const arrival = pickRandom(ARRIVALS);
    const core = CORE_BROOM_SWEEP;

    // Start far enough left that the brush's front edge begins LEFT of
    // -120 (the leftmost a paper can land), so every paper is initially
    // ahead of the brush and gets caught smoothly as it passes — no
    // instant-snap jumps.
    const fromX = -AVATAR_W * BROOM_FRONT_FRAC - SWEEP_START_LEFT_MARGIN;
    // End with the brush front parked at the receptacle's left edge — the
    // pile rides at brushFront + 4..29, so it lands compressed right in
    // front of the RESUMES slot, ready for the (future) pickup-and-insert
    // animation. No exit follows; Tim stays in the core-held standing pose
    // at this position until a re-click clears him.
    const toX = getReceptacleLeft() - AVATAR_W * BROOM_FRONT_FRAC;
    avatarEl.style.left = `${fromX}px`;

    const totalCoreMs = getCoreDurationMs(core);
    const T_CORE_START = arrival.durationMs + ARRIVAL_TO_SWEEP_MS;
    const T_CORE_END = T_CORE_START + totalCoreMs;

    avatar.startArrival(arrival);
    avatar.scheduleCore(core, T_CORE_START);

    // Schedule the actual travel: starts when the core phase begins, ends
    // when the core finishes. The physics loop reads sweep state each tick
    // to update both the avatar's `left` and the broom hitbox.
    const startedAt = performance.now();
    sweepFromX = fromX;
    sweepToX = toX;
    sweepStartTime = startedAt + T_CORE_START;
    sweepEndTime = startedAt + T_CORE_END;

    sweepTimers.push(
      window.setTimeout(() => {
        sweepActive = true;
        // A second whoosh as the broom catches the papers — the burst whoosh
        // played at click time, this one anchors the sweep.
        playPaperWhoosh();
        ensurePhysicsLoop();
      }, T_CORE_START),
    );

    sweepTimers.push(
      window.setTimeout(() => {
        sweepActive = false;
        // Snap avatar to its end position so any rAF rounding doesn't leave
        // it mid-stride.
        avatarEl.style.left = `${toX}px`;
        // Sweep done, Tim parked at the receptacle. Hand off to the next
        // phase (hold → terminal-type core → digitize pile → scorecard
        // flash → final exit). The lock is released at the tail of
        // runScorecardFlash, when the chassis fade completes.
        runKeyboardSequence();
      }, T_CORE_END),
    );
  }

  function start(clickX: number, clickY: number) {
    // Each click resets: clear any existing burst + avatar, then start fresh.
    clearAll();
    // Mark the stage active — fades the supercomputer in and dims the
    // article text so the avatar reads clearly against any overlap. The
    // deactivation timer at the end of the flash chain restores both.
    stage!.classList.add('is-active');
    // Convert viewport coords to stage-local coords once. Papers animate
    // in stage-local space, so they scroll with the page. Spawn line spans
    // the full width of the trigger word at the click's y.
    const stageRect = stage!.getBoundingClientRect();
    const triggerRect = trigger!.getBoundingClientRect();
    const originLeft = triggerRect.left - stageRect.left;
    const originWidth = triggerRect.width;
    const localY = clickY - stageRect.top;
    playPaperWhoosh();
    spawnPapers(originLeft, originWidth, localY);
    sweepTimers.push(window.setTimeout(runSweep, SWEEP_DELAY_AFTER_CLICK_MS));
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!tryStart(LOCK_ID)) return;
    markDiscovered('greenhouse');
    resumeAudio();
    start(e.clientX, e.clientY);
  });
}
