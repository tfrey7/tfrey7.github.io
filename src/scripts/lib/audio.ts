// Lazy AudioContext — browsers require a user gesture before it can produce
// sound, so the first-hover cascade silently no-ops here (per CLAUDE.md's
// "no autoplay" rule). After the first click anywhere, blinks play.
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function readyCtx(): AudioContext | null {
  const ctx = getCtx();
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return null;
  return ctx;
}

// Call from a user-gesture handler to wake the context up early so the next
// play* call lands in a `running` state.
export function resumeAudio() {
  const ctx = getCtx();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

export function playBoink(intensity: number) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const basePitch = 280 + Math.random() * 320;
  const endPitch = basePitch * (0.32 + Math.random() * 0.18);
  const pitchDuration = 0.07 + Math.random() * 0.05;
  const totalDuration = 0.18 + intensity * 0.18;
  const peakGain = 0.04 + intensity * 0.20;

  // Triangle for cartoony body. Pitch dips low, snaps up to peak, drops fast
  // — the "BO-ink" cadence.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(basePitch * 0.78, now);
  osc.frequency.linearRampToValueAtTime(basePitch, now + 0.012);
  osc.frequency.exponentialRampToValueAtTime(endPitch, now + pitchDuration);

  // Lowpass opens with intensity → brighter, more aggressive at the climax.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700 + intensity * 1800;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + totalDuration + 0.02);

  // High-intensity boinks get a quick noise transient for the "thunk" of impact.
  if (intensity > 0.45) {
    const noiseDur = 0.045;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 600 + intensity * 900;

    const noiseGain = ctx.createGain();
    const noisePeak = (intensity - 0.4) * 0.14;
    noiseGain.gain.setValueAtTime(noisePeak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);

    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noiseSrc.start(now);
    noiseSrc.stop(now + noiseDur);
  }
}

export function playThunk() {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const totalDur = 0.16;

  // Triangle body with a fast pitch dip — gives the woody "thock" of a
  // claw hammer striking a board.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(280, now);
  osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);

  const oscFilter = ctx.createBiquadFilter();
  oscFilter.type = 'lowpass';
  oscFilter.frequency.value = 1200;

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.18, now + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + totalDur);

  osc.connect(oscFilter).connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + totalDur + 0.02);

  // Sharp band-passed transient at the front — the "tk" of the strike that
  // sells the impact.
  const noiseDur = 0.04;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.8;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.12, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);

  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + noiseDur);
}

export function playAngelicChime() {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  // C major arpeggio in the upper octave for a bright, bell-like reveal.
  const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  const peakGain = 0.028;
  const decay = 1.1;
  const stagger = 0.045;

  freqs.forEach((freq, i) => {
    const start = now + i * stagger;
    const stop = start + decay + 0.1;

    // Pair of detuned sines per note for a soft chorus shimmer.
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = freq;
    const oscB = ctx.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.value = freq * 1.0035;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peakGain, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);

    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(start);
    oscB.start(start);
    oscA.stop(stop);
    oscB.stop(stop);
  });
}

export function playPaperWhoosh() {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.34;

  // Shaped white noise — bandpass swept upward then down for a "fwip" of
  // paper catching air. Quiet (papers aren't loud).
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    const env = Math.sin(t * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.linearRampToValueAtTime(2400, now + 0.14);
  filter.frequency.linearRampToValueAtTime(1200, now + dur);
  filter.Q.value = 0.9;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

// Broom sweep — continuous airy "shhh" bed (bandpass-filtered noise) with
// rhythmic stroke peaks ridden on top, sized to the on-screen sweep core.
// Returns a stop() handle so a mid-sweep re-click can cancel cleanly.
export function playBroomSweep(durationMs: number): () => void {
  const ctx = readyCtx();
  if (!ctx) return () => {};

  const now = ctx.currentTime;
  const dur = durationMs / 1000;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Bandpass sits in the bristle band; slow drift keeps it from reading flat.
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(3500, now);
  filter.frequency.linearRampToValueAtTime(4200, now + dur * 0.5);
  filter.frequency.linearRampToValueAtTime(3100, now + dur);
  filter.Q.value = 1.1;

  // Highpass clears any low rumble — bristles are airy, not boomy.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;

  // Stroke envelope on top of a quiet noise bed — discrete gain peaks across
  // the duration give the back-and-forth cadence of an actual sweep.
  const gain = ctx.createGain();
  const strokeCount = Math.max(2, Math.round(durationMs / 700));
  const peakGain = 0.07;
  const bedGain = 0.018;
  gain.gain.setValueAtTime(bedGain, now);
  for (let i = 0; i < strokeCount; i++) {
    const center = now + (dur * (i + 0.5)) / strokeCount;
    const half = (dur / strokeCount) * 0.45;
    gain.gain.linearRampToValueAtTime(peakGain, center);
    gain.gain.linearRampToValueAtTime(bedGain, center + half);
  }
  gain.gain.linearRampToValueAtTime(0, now + dur + 0.05);

  noise.connect(filter).connect(hp).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + dur + 0.08);

  return () => {
    try { noise.stop(); } catch {}
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
  };
}

// Continuous pencil-on-paper scratch. Three filtered-noise channels driven
// by *random* sub-audio gates (long noise buffers fed through very low
// lowpass filters and routed into the gate gains' AudioParams) so each
// channel pulses irregularly — like graphite catching paper grain — rather
// than evenly like a tremolo. The mid channel also goes through a soft-clip
// waveshaper for harmonic snarl. Intensity is driven externally (typically
// stroke velocity) so the sound matches motion: silent when paused, gritty
// when scribbling. Returns { setIntensity, stop } for live driving + clean
// teardown on pointer-up / cancel.
export function startPencilScratch(): {
  setIntensity: (v: number) => void;
  stop: () => void;
} {
  const ctx = readyCtx();
  if (!ctx) return { setIntensity: () => {}, stop: () => {} };

  const now = ctx.currentTime;
  const sources: AudioScheduledSourceNode[] = [];

  // 2s shared noise buffer for the audio-rate carriers — long enough that
  // the loop seam isn't audible. Each carrier reads it at a different
  // playbackRate so the three channels don't lock into the same pattern.
  const noiseLen = Math.floor(ctx.sampleRate * 2.0);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

  // Soft-clip curve (tanh) — adds harmonics so the bandpassed noise reads
  // as "shredding" rather than smooth hiss. Used on the mid channel.
  const shaperCurve = new Float32Array(512);
  for (let i = 0; i < shaperCurve.length; i++) {
    shaperCurve[i] = Math.tanh(((i / 256) - 1) * 3.5);
  }

  // Master output — driven by setIntensity. Each setIntensity call ramps
  // up fast then back toward 0 over ~320ms, so continuous motion sustains
  // the sound and a paused cursor decays to silence without a timer.
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.connect(ctx.destination);

  // makeRandomMod: a chaotic sub-audio control signal — a separate long
  // noise buffer fed through a very low lowpass and scaled up. Connect
  // its output node to any AudioParam to get truly irregular modulation
  // (vs. an LFO, which is periodic). The cutoff sets how fast the texture
  // wobbles; the scale sets how deep.
  const makeRandomMod = (cutoffHz: number, scale: number): AudioNode => {
    const modBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const md = modBuf.getChannelData(0);
    for (let i = 0; i < md.length; i++) md[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = modBuf;
    src.loop = true;
    sources.push(src);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoffHz;
    lp.Q.value = 0.6;

    const g = ctx.createGain();
    g.gain.value = scale;

    src.connect(lp).connect(g);
    src.start(now);
    return g;
  };

  // === Channel A: body — periodic raspy strokes around 2.2 kHz. ===
  // Square LFO gives a clear stroke rhythm; a random mod on the same param
  // throws in irregular kicks so it doesn't feel mechanical.
  const noiseA = ctx.createBufferSource();
  noiseA.buffer = noiseBuf;
  noiseA.loop = true;
  sources.push(noiseA);
  const bpA = ctx.createBiquadFilter();
  bpA.type = 'bandpass';
  bpA.frequency.value = 2200;
  bpA.Q.value = 1.5;
  const hpA = ctx.createBiquadFilter();
  hpA.type = 'highpass';
  hpA.frequency.value = 1100;
  const gateA = ctx.createGain();
  gateA.gain.setValueAtTime(0.15, now);
  const lfoA = ctx.createOscillator();
  lfoA.type = 'square';
  lfoA.frequency.value = 16;
  sources.push(lfoA);
  const lfoAGain = ctx.createGain();
  lfoAGain.gain.value = 0.55;
  lfoA.connect(lfoAGain).connect(gateA.gain);
  makeRandomMod(20, 3.5).connect(gateA.gain);
  const levelA = ctx.createGain();
  levelA.gain.value = 0.5;
  noiseA.connect(bpA).connect(hpA).connect(gateA).connect(levelA).connect(out);

  // === Channel B: grit — resonant 4.5 kHz bandpass through a waveshaper. ===
  // High-Q bandpass gives the noise a "voice"; the tanh shaper turns peaks
  // into snarled harmonics. Random mod alone (no LFO) keeps it organic.
  const noiseB = ctx.createBufferSource();
  noiseB.buffer = noiseBuf;
  noiseB.loop = true;
  noiseB.playbackRate.value = 0.91;
  sources.push(noiseB);
  const bpB = ctx.createBiquadFilter();
  bpB.type = 'bandpass';
  bpB.frequency.value = 4500;
  bpB.Q.value = 2.6;
  const shaperB = ctx.createWaveShaper();
  shaperB.curve = shaperCurve;
  shaperB.oversample = '2x';
  const gateB = ctx.createGain();
  gateB.gain.setValueAtTime(0.18, now);
  makeRandomMod(55, 5.0).connect(gateB.gain);
  const levelB = ctx.createGain();
  levelB.gain.value = 0.42;
  noiseB.connect(bpB).connect(shaperB).connect(gateB).connect(levelB).connect(out);

  // === Channel C: high crackle — fast irregular bursts above 5.5 kHz. ===
  // The "kshk-kshk" of graphite catching paper fibers. Faster random mod,
  // no LFO, simple highpass — the irregularity is the whole point here.
  const noiseC = ctx.createBufferSource();
  noiseC.buffer = noiseBuf;
  noiseC.loop = true;
  noiseC.playbackRate.value = 1.13;
  sources.push(noiseC);
  const hpC = ctx.createBiquadFilter();
  hpC.type = 'highpass';
  hpC.frequency.value = 5500;
  const gateC = ctx.createGain();
  gateC.gain.setValueAtTime(0.08, now);
  makeRandomMod(110, 6.5).connect(gateC.gain);
  const levelC = ctx.createGain();
  levelC.gain.value = 0.38;
  noiseC.connect(hpC).connect(gateC).connect(levelC).connect(out);

  noiseA.start(now);
  noiseB.start(now);
  noiseC.start(now);
  lfoA.start(now);

  let stopped = false;
  const PEAK = 0.14; // master ceiling — quiet by design

  return {
    setIntensity(v: number) {
      if (stopped) return;
      const clamped = Math.max(0, Math.min(1, v));
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(PEAK * clamped, t + 0.025);
      out.gain.linearRampToValueAtTime(0, t + 0.32);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.05);
      const stopAt = t + 0.08;
      for (const s of sources) {
        try { s.stop(stopAt); } catch {}
      }
    },
  };
}

// Continuous "slurp" for the digitize cascade — bandpass noise + sub sine
// both sweeping UP across the duration to sell the suction-into-slot feel.
// Sized to match the visible cascade window (stagger * count + flight tail).
// Returns a stop() handle for mid-cascade cancellation.
export function playDigitizeSlurp(durationMs: number): () => void {
  const ctx = readyCtx();
  if (!ctx) return () => {};

  const now = ctx.currentTime;
  const dur = durationMs / 1000;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + dur * 0.92);
  filter.Q.value = 2.2;

  // Sub sine adds body without reading as a pitched tone — rides under
  // the noise to give the slurp its "vacuum" weight.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(420, now + dur * 0.92);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.08, now + 0.08);
  noiseGain.gain.linearRampToValueAtTime(0.12, now + dur * 0.85);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0, now);
  subGain.gain.linearRampToValueAtTime(0.04, now + 0.08);
  subGain.gain.linearRampToValueAtTime(0.06, now + dur * 0.85);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  sub.connect(subGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + dur + 0.05);
  sub.start(now);
  sub.stop(now + dur + 0.05);

  return () => {
    const t = ctx.currentTime;
    try { noise.stop(); } catch {}
    try { sub.stop(); } catch {}
    noiseGain.gain.cancelScheduledValues(t);
    noiseGain.gain.setValueAtTime(0, t);
    subGain.gain.cancelScheduledValues(t);
    subGain.gain.setValueAtTime(0, t);
  };
}

// Short "woop" blip — triangle wave with a quick upward pitch sweep. Called
// on every Nth paper in the digitize cascade; `progress` (0..1) raises the
// base pitch as the cascade advances so the woops climb like a register
// filling. Quiet by design — many fire in rapid succession.
export function playDigitizeWoop(progress: number) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.085;
  const base = 220 + progress * 480;
  const peak = base * 1.7;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(base, now);
  osc.frequency.exponentialRampToValueAtTime(peak, now + dur * 0.55);
  osc.frequency.exponentialRampToValueAtTime(peak * 0.9, now + dur);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2800;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.03, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// Slot-machine "pling" for each scorecard reel tick — bright sine bell with
// a 2x partial. Each rating passes a distinct pitch so the spinner reads as
// distinct symbols cycling past, not undifferentiated beeps.
export function playScorecardTick(pitch: number) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.16;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = pitch;

  // 2x partial adds bell brightness without going full FM-clang.
  const partial = ctx.createOscillator();
  partial.type = 'sine';
  partial.frequency.value = pitch * 2;

  const partialGain = ctx.createGain();
  partialGain.gain.value = 0.28;
  partial.connect(partialGain);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  partialGain.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  partial.start(now);
  osc.stop(now + dur + 0.02);
  partial.stop(now + dur + 0.02);
}

// Fatter "ding!" for the Strong Yes landing — same bell idea but a triad of
// partials and a longer decay so it sustains under the celebration.
export function playScorecardLanding() {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 1.2;
  const root = 1046.5; // C6 — matches strong-yes tick

  // Root + 2x + 3x partials for a brighter, more bell-like spectrum.
  const partials: Array<{ mult: number; level: number }> = [
    { mult: 1, level: 0.12 },
    { mult: 2, level: 0.05 },
    { mult: 3, level: 0.025 },
  ];

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  gain.connect(ctx.destination);

  partials.forEach(({ mult, level }) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = root * mult;
    const lvl = ctx.createGain();
    lvl.gain.value = level;
    osc.connect(lvl).connect(gain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  });
}

// Firework burst — CRACK + noise body + crackling sparkle tail.
// `pitchShift` (default 1) tilts the filter centers so successive shells
// sound varied rather than identical; pass ~0.8–1.25 for natural
// variation. Recruiter-safe: short and bright, no chest-thump bass and no
// tonal component (tonal = "boop", what we want is sharp noise = "crack").
export function playFireworkBurst(pitchShift = 1) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1) CRACK — very short wideband noise transient. The sharp leading
  // edge of the burst. High-pass tilted to keep it bright and percussive.
  const crackDur = 0.04;
  const crackBuf = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * crackDur),
    ctx.sampleRate,
  );
  const crackData = crackBuf.getChannelData(0);
  for (let i = 0; i < crackData.length; i++) {
    crackData[i] = (Math.random() * 2 - 1) * (1 - i / crackData.length);
  }
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackBuf;
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 1400 * pitchShift;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.32, now);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + crackDur);
  crackSrc.connect(crackFilter).connect(crackGain).connect(ctx.destination);
  crackSrc.start(now);
  crackSrc.stop(now + crackDur);

  // 2) BODY — slightly longer lowpass-filtered noise for the "boom" of
  // the burst, with a quick filter sweep down so it reads as energy
  // collapsing. Pure noise (no oscillator) — that's the difference
  // between "crack" and "boop".
  const bodyDur = 0.22;
  const bodyBuf = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * bodyDur),
    ctx.sampleRate,
  );
  const bodyData = bodyBuf.getChannelData(0);
  for (let i = 0; i < bodyData.length; i++) {
    bodyData[i] = (Math.random() * 2 - 1) * (1 - i / bodyData.length);
  }
  const bodySrc = ctx.createBufferSource();
  bodySrc.buffer = bodyBuf;
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(2400 * pitchShift, now);
  bodyFilter.frequency.exponentialRampToValueAtTime(500 * pitchShift, now + bodyDur);
  bodyFilter.Q.value = 0.7;
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.18, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + bodyDur);
  bodySrc.connect(bodyFilter).connect(bodyGain).connect(ctx.destination);
  bodySrc.start(now);
  bodySrc.stop(now + bodyDur);

  // 3) CRACKLE — dense high-pass noise grains scattered across the tail.
  // Each grain is a tiny percussive snap; together they read as falling
  // sparkles/glitter stars popping. Randomized timing/pitch so it doesn't
  // sound metronomic. Count + volume are dialed up from earlier passes
  // because at low density the tail just disappears.
  const tailStart = 0.04;
  const tailDur = 0.7;
  const grainCount = 28;
  for (let i = 0; i < grainCount; i++) {
    const grainOffset = tailStart + Math.random() * tailDur;
    const grainDur = 0.006 + Math.random() * 0.018;
    const grainBuf = ctx.createBuffer(
      1,
      Math.max(1, Math.floor(ctx.sampleRate * grainDur)),
      ctx.sampleRate,
    );
    const gd = grainBuf.getChannelData(0);
    for (let j = 0; j < gd.length; j++) {
      gd[j] = (Math.random() * 2 - 1) * (1 - j / gd.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = grainBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = (2200 + Math.random() * 3000) * pitchShift;
    const g = ctx.createGain();
    // Decay roughly with distance into the tail so later grains are quieter.
    const fade = 1 - (grainOffset - tailStart) / tailDur;
    const peak = 0.14 * (0.45 + fade * 0.75);
    g.gain.setValueAtTime(peak, now + grainOffset);
    g.gain.exponentialRampToValueAtTime(0.0001, now + grainOffset + grainDur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(now + grainOffset);
    src.stop(now + grainOffset + grainDur);
  }
}

// Descending whistle for the firework ascent — reads as the rocket
// receding from the listener (Doppler-style pitch drop + fading volume).
// Pure sine in the 2–4 kHz range, sweeping down over the rise. No vibrato
// (vibrato reads as sci-fi ray-gun, not firework). A whisper of bandpass
// noise tracks the sweep so it doesn't sound like a flute tone.
// `pitchShift` matches playFireworkBurst's range (~0.8–1.25) so each
// shell's whistle pairs with its eventual pop. Duration tuned to the
// 480ms FIREWORK_RISE_MS; ends quietly just before the burst lands.
export function playFireworkLaunch(pitchShift = 1) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.46;
  const startHz = 3400 * pitchShift;
  const endHz = 1700 * pitchShift;

  // Master gain — quick attack, then a slow taper across the whole rise
  // so the whistle fades into the distance instead of staying full-volume
  // until the burst.
  const peak = 0.06;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.04);
  gain.gain.linearRampToValueAtTime(peak * 0.35, now + dur - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  gain.connect(ctx.destination);

  // Core whistle: sine swept exponentially DOWN the rise. No LFO — a
  // clean tone reads as "rocket whistle"; modulation reads as "ray gun".
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, now);
  osc.frequency.exponentialRampToValueAtTime(endHz, now + dur);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Breath — thin bandpass noise tracking the sweep at a high Q. Just
  // enough to take the polish off the sine so it sounds like a real
  // whistle tube rather than a test tone.
  const noiseBuf = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * dur),
    ctx.sampleRate,
  );
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.Q.value = 18;
  noiseFilter.frequency.setValueAtTime(startHz, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(endHz, now + dur);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.06;
  noise.connect(noiseFilter).connect(noiseGain).connect(gain);
  noise.start(now);
  noise.stop(now + dur);
}

// Subtle paper-on-paper shuffle for UI panels that slide up/down (e.g. the
// journal clipboard). Dry bandpass noise with a short rise-fall envelope.
// Direction tilts the filter sweep so "up" rises and "down" settles —
// matches the motion without drawing attention to itself.
export function playPaperShuffle(direction: 'up' | 'down' = 'up') {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.24;
  const rising = direction === 'up';

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    const env = Math.sin(t * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  const startFreq = rising ? 1500 : 2400;
  const endFreq = rising ? 2400 : 1400;
  filter.frequency.setValueAtTime(startFreq, now);
  filter.frequency.linearRampToValueAtTime(endFreq, now + dur);
  filter.Q.value = 0.8;

  // Highpass keeps it dry — papers shouldn't have low-mid body.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1100;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.025, now + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter).connect(hp).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

export function playPaperPat(pitchJitter = 0) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.09;

  // Soft thump — low triangle dip + a brief noise tap. The "pat" of papers
  // landing on the pile.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const basePitch = 180 + pitchJitter * 30;
  osc.frequency.setValueAtTime(basePitch, now);
  osc.frequency.exponentialRampToValueAtTime(basePitch * 0.55, now + dur);

  const oscFilter = ctx.createBiquadFilter();
  oscFilter.type = 'lowpass';
  oscFilter.frequency.value = 800;

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.08, now + 0.004);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(oscFilter).connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Tiny noise transient for the paper rustle.
  const noiseDur = 0.05;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1800;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.05, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);

  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + noiseDur);
}

export function playStackTap() {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Two quick high taps — squaring the stack, like a librarian.
  const taps = [0, 0.085];
  taps.forEach((delay) => {
    const start = now + delay;
    const dur = 0.045;

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.085, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(start);
    noise.stop(start + dur);
  });
}

// Whooshing time-warp — bandpass-swept white noise (the air rushing past)
// with a sub-bass sine for weight. `direction: 'back'` is the normal forward
// whoosh (fast attack → decay, frequencies sweep high→low). `direction:
// 'forward'` mirrors everything: gain builds from silence to a peak and cuts
// off abruptly, frequencies sweep low→high — the "sucking in" of time
// reversing back to the present.
export function playTimeWarp(direction: 'back' | 'forward' = 'back') {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dur = 0.38;
  const reverse = direction === 'forward';

  const noiseStart = reverse ? 400  : 3000;
  const noiseEnd   = reverse ? 3000 : 400;
  const subStart   = reverse ? 40   : 200;
  const subEnd     = reverse ? 200  : 40;

  // White-noise body — bandpass sweep is the dominant "whoosh" character.
  // Modest Q keeps it windy rather than pitched.
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(noiseStart, now);
  filter.frequency.exponentialRampToValueAtTime(noiseEnd, now + dur);
  filter.Q.value = 1.3;

  // Sub-bass sine for weight — way below the noise band so it adds body
  // without reading as a pitched tone.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(subStart, now);
  sub.frequency.exponentialRampToValueAtTime(subEnd, now + dur);

  const noiseGain = ctx.createGain();
  const subGain = ctx.createGain();
  if (reverse) {
    // Build from silence → peak → abrupt cut: the reverse-playback shape.
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.11, now + dur);
    noiseGain.gain.linearRampToValueAtTime(0, now + dur + 0.012);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.06, now + dur);
    subGain.gain.linearRampToValueAtTime(0, now + dur + 0.012);
  } else {
    // Fast attack → exp decay: wind rushing past as time recedes.
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.11, now + 0.025);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.06, now + 0.025);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  }

  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  sub.connect(subGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + dur + 0.05);
  sub.start(now);
  sub.stop(now + dur + 0.05);
}

export function playRoleTick(pitch: number) {
  const ctx = readyCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Square-wave clack with a fast pitch dip — like a typewriter strike or
  // an old split-flap display flipping.
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(pitch * 1.6, now);
  osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.006);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.7, now + 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.022, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  osc.connect(filter).connect(env).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}
