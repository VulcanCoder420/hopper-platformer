/**
 * Generate placeholder PCM WAV SFX + looping music for Hopper.
 * Pure Node, no deps. Run: node scripts/generate-audio.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public/assets/audio');
const SR = 44100;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function writeWav(filePath, samples, sampleRate = SR) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // audio format PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const s = clamp(samples[i], -1, 1);
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

function mixInto(target, source, offset = 0, gain = 1) {
  for (let i = 0; i < source.length; i++) {
    const j = offset + i;
    if (j >= 0 && j < target.length) target[j] += source[i] * gain;
  }
}

function envADSR(t, dur, a, d, s, r) {
  if (t < 0 || t > dur) return 0;
  if (t < a) return a <= 0 ? 1 : t / a;
  if (t < a + d) return 1 - ((1 - s) * (t - a)) / Math.max(d, 1e-6);
  if (t < dur - r) return s;
  if (r <= 0) return 0;
  return s * (1 - (t - (dur - r)) / r);
}

/** Sine tone with ADSR. */
function tone(freq, dur, { a = 0.01, d = 0.05, s = 0.6, r = 0.08, gain = 0.5, slide = 0 } = {}) {
  const n = Math.floor(dur * SR);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq + slide * (t / dur);
    phase += (2 * Math.PI * f) / SR;
    const e = envADSR(t, dur, a, d, s, r);
    out[i] = Math.sin(phase) * e * gain;
  }
  return out;
}

/** Soft square (odd harmonics, limited) for chiptune feel. */
function softSquare(freq, dur, { a = 0.005, d = 0.04, s = 0.5, r = 0.06, gain = 0.25, slide = 0 } = {}) {
  const n = Math.floor(dur * SR);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq + slide * (t / dur);
    phase += (2 * Math.PI * f) / SR;
    const e = envADSR(t, dur, a, d, s, r);
    const sq =
      Math.sin(phase) +
      Math.sin(phase * 3) / 3 +
      Math.sin(phase * 5) / 5;
    out[i] = sq * 0.7 * e * gain;
  }
  return out;
}

function noiseBurst(dur, { a = 0.001, d = 0.02, s = 0.15, r = 0.05, gain = 0.35 } = {}) {
  const n = Math.floor(dur * SR);
  const out = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = envADSR(t, dur, a, d, s, r);
    // simple low-pass noise
    const white = Math.random() * 2 - 1;
    prev = prev * 0.6 + white * 0.4;
    out[i] = prev * e * gain;
  }
  return out;
}

function normalize(samples, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  if (max < 1e-9) return samples;
  const g = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= g;
  return samples;
}

function alloc(seconds) {
  return new Float64Array(Math.floor(seconds * SR));
}

// --- SFX ---

function makeJump() {
  // Rising chirp + soft blip
  const buf = alloc(0.22);
  mixInto(buf, softSquare(280, 0.18, { a: 0.005, d: 0.04, s: 0.4, r: 0.08, gain: 0.45, slide: 420 }));
  mixInto(buf, tone(560, 0.12, { a: 0.002, d: 0.03, s: 0.3, r: 0.06, gain: 0.2, slide: 200 }), Math.floor(0.02 * SR));
  return normalize(buf, 0.85);
}

function makeLand() {
  const buf = alloc(0.18);
  mixInto(buf, noiseBurst(0.12, { a: 0.001, d: 0.03, s: 0.2, r: 0.08, gain: 0.5 }));
  mixInto(buf, tone(90, 0.14, { a: 0.001, d: 0.04, s: 0.25, r: 0.08, gain: 0.55, slide: -40 }));
  return normalize(buf, 0.8);
}

function makeCoin() {
  const buf = alloc(0.35);
  const notes = [988, 1319]; // B5, E6-ish sparkle
  notes.forEach((f, i) => {
    mixInto(
      buf,
      tone(f, 0.2, { a: 0.002, d: 0.05, s: 0.35, r: 0.12, gain: 0.4 }),
      Math.floor(i * 0.07 * SR),
    );
  });
  return normalize(buf, 0.85);
}

function makeStomp() {
  const buf = alloc(0.25);
  mixInto(buf, tone(140, 0.12, { a: 0.001, d: 0.05, s: 0.3, r: 0.06, gain: 0.55, slide: -80 }));
  mixInto(buf, noiseBurst(0.1, { gain: 0.45 }), Math.floor(0.01 * SR));
  mixInto(buf, softSquare(220, 0.1, { a: 0.002, d: 0.04, s: 0.2, r: 0.05, gain: 0.25, slide: -60 }), Math.floor(0.03 * SR));
  return normalize(buf, 0.85);
}

function makeDeath() {
  const buf = alloc(0.7);
  const notes = [440, 349, 294, 220];
  notes.forEach((f, i) => {
    mixInto(
      buf,
      softSquare(f, 0.22, { a: 0.01, d: 0.06, s: 0.35, r: 0.1, gain: 0.35, slide: -20 }),
      Math.floor(i * 0.12 * SR),
    );
  });
  mixInto(buf, noiseBurst(0.35, { a: 0.01, d: 0.1, s: 0.1, r: 0.2, gain: 0.2 }), Math.floor(0.3 * SR));
  return normalize(buf, 0.85);
}

function makeFlag() {
  const buf = alloc(0.9);
  const notes = [523, 659, 784, 1047]; // C major flourish
  notes.forEach((f, i) => {
    mixInto(
      buf,
      tone(f, 0.35, { a: 0.01, d: 0.08, s: 0.45, r: 0.15, gain: 0.35 }),
      Math.floor(i * 0.12 * SR),
    );
    mixInto(
      buf,
      softSquare(f * 2, 0.25, { a: 0.005, d: 0.05, s: 0.2, r: 0.1, gain: 0.12 }),
      Math.floor(i * 0.12 * SR),
    );
  });
  return normalize(buf, 0.88);
}

// --- Music loops (beat-aligned for seamless-ish loop) ---

const BPM = 100;
const BEAT = 60 / BPM; // 0.6s
const BARS = 4;
const LOOP_SEC = BEAT * 4 * BARS; // 4 bars of 4/4 = 9.6s

function noteFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function makeMusicMain() {
  const buf = alloc(LOOP_SEC);
  // Soft pad root + fifth
  const padNotes = [48, 55, 60, 67]; // C2 C3 G3 …
  for (const midi of padNotes) {
    mixInto(
      buf,
      tone(noteFreq(midi), LOOP_SEC, {
        a: 0.4,
        d: 0.5,
        s: 0.55,
        r: 0.5,
        gain: 0.08,
      }),
    );
  }

  // Arpeggio pattern (C major-ish)
  const arp = [60, 64, 67, 72, 67, 64, 60, 55]; // C E G C' G E C G
  const step = BEAT / 2; // 8th notes
  const steps = Math.floor(LOOP_SEC / step);
  for (let i = 0; i < steps; i++) {
    const midi = arp[i % arp.length];
    const t0 = i * step;
    // slight accent on bar starts
    const barBeat = i % 8 === 0;
    mixInto(
      buf,
      softSquare(noteFreq(midi), step * 0.9, {
        a: 0.01,
        d: 0.06,
        s: 0.25,
        r: 0.08,
        gain: barBeat ? 0.16 : 0.11,
      }),
      Math.floor(t0 * SR),
    );
    // gentle high sparkle every other
    if (i % 2 === 0) {
      mixInto(
        buf,
        tone(noteFreq(midi + 12), step * 0.6, {
          a: 0.005,
          d: 0.04,
          s: 0.15,
          r: 0.08,
          gain: 0.05,
        }),
        Math.floor(t0 * SR),
      );
    }
  }

  // Soft kick on beats for pulse
  for (let b = 0; b < Math.floor(LOOP_SEC / BEAT); b++) {
    const t0 = b * BEAT;
    mixInto(
      buf,
      tone(70, 0.12, { a: 0.001, d: 0.04, s: 0.15, r: 0.06, gain: 0.18, slide: -30 }),
      Math.floor(t0 * SR),
    );
  }

  // Fade edges slightly for loop friendliness
  const fade = Math.floor(0.02 * SR);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return normalize(buf, 0.75);
}

function makeMusicWin() {
  const bars = 2;
  const sec = BEAT * 4 * bars;
  const buf = alloc(sec);
  const melody = [60, 64, 67, 72, 67, 72, 76, 79];
  const step = BEAT / 2;
  for (let i = 0; i < Math.floor(sec / step); i++) {
    const midi = melody[i % melody.length];
    mixInto(
      buf,
      tone(noteFreq(midi), step * 0.85, {
        a: 0.01,
        d: 0.05,
        s: 0.35,
        r: 0.08,
        gain: 0.22,
      }),
      Math.floor(i * step * SR),
    );
    mixInto(
      buf,
      softSquare(noteFreq(midi + 7), step * 0.7, {
        a: 0.005,
        d: 0.04,
        s: 0.2,
        r: 0.06,
        gain: 0.08,
      }),
      Math.floor(i * step * SR),
    );
  }
  // Pad
  mixInto(buf, tone(noteFreq(48), sec, { a: 0.2, d: 0.3, s: 0.4, r: 0.3, gain: 0.1 }));
  mixInto(buf, tone(noteFreq(55), sec, { a: 0.2, d: 0.3, s: 0.35, r: 0.3, gain: 0.08 }));

  const fade = Math.floor(0.015 * SR);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return normalize(buf, 0.8);
}

// --- Write files ---

fs.mkdirSync(OUT, { recursive: true });

const files = {
  'jump.wav': makeJump,
  'land.wav': makeLand,
  'coin.wav': makeCoin,
  'stomp.wav': makeStomp,
  'death.wav': makeDeath,
  'flag.wav': makeFlag,
  'music-main.wav': makeMusicMain,
  'music-win.wav': makeMusicWin,
};

for (const [name, fn] of Object.entries(files)) {
  const samples = fn();
  const dest = path.join(OUT, name);
  writeWav(dest, samples);
  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`wrote ${name} (${kb} KB, ${(samples.length / SR).toFixed(2)}s)`);
}

console.log('Done →', OUT);
