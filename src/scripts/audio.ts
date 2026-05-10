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
