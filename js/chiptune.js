/**
 * chiptune.js — a tiny WebAudio synth for the room.
 * Piano-ish notes for the keyboard, a 4-channel chiptune sequencer
 * (two pulse voices, triangle bass, noise drums) and a couple of UI sounds.
 * Everything is generated from oscillators; there are no audio files.
 */

let ctx = null;
let master = null;

/** Lazily create the AudioContext. Must first be called from a user gesture. */
export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "C#4" -> 61 */
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  return (parseInt(m[3], 10) + 1) * 12 + NOTE_IDX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
/** 61 -> "C#4" */
export function midiName(m) {
  return NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

// ---------------------------------------------------------------------------
// Piano
// ---------------------------------------------------------------------------
export function pianoNote(midi, opts = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + (opts.when || 0);
  const vel = opts.vel ?? 0.5;
  const dur = opts.dur ?? 1.8;
  const f = midiHz(midi);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.16);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  // the hammer "brightness" dies off faster than the note itself
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(14000, f * 7), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 1.6), t + dur * 0.6);
  g.connect(lp).connect(master);

  const partials = [
    [1, 1, "triangle"],
    [2, 0.32, "sine"],
    [3, 0.12, "sine"],
    [4.01, 0.05, "sine"],
  ];
  for (const [h, a, type] of partials) {
    if (f * h > 16000) continue;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f * h;
    const og = ac.createGain();
    og.gain.value = a;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// ---------------------------------------------------------------------------
// Chip voices
// ---------------------------------------------------------------------------
const pulseCache = {};
function pulseWave(ac, duty) {
  const key = duty.toFixed(3);
  if (pulseCache[key]) return pulseCache[key];
  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return (pulseCache[key] = ac.createPeriodicWave(real, imag));
}

let noiseBuf = null;
function noise(ac) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
}

function kick(ac, out, t, a) {
  const o = ac.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(170, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  const g = ac.createGain();
  g.gain.setValueAtTime(a, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.26);
}
function snare(ac, out, t, a) {
  const n = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 0.7;
  const g = ac.createGain();
  g.gain.setValueAtTime(a, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  n.connect(bp).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.2);
  const o = ac.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(230, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(a * 0.7, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g2).connect(out);
  o.start(t);
  o.stop(t + 0.12);
}
function hat(ac, out, t, a) {
  const n = noise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7500;
  const g = ac.createGain();
  g.gain.setValueAtTime(a, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  n.connect(hp).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.06);
}

// ---------------------------------------------------------------------------
// Sequencer
// ---------------------------------------------------------------------------
/** "E5:4 R:2 G#4 | ..." -> [{midi, len}] where len is in 16ths (default 2 = an eighth) */
function parseTrack(str) {
  const out = [];
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === "|" || !tok) continue;
    const [n, l] = tok.split(":");
    out.push({ midi: n === "R" || n === "." ? null : noteToMidi(n), len: l ? parseFloat(l) : 2 });
  }
  return out;
}

/**
 * Play a tune: { bpm, volume, channels: [{ notes, wave, duty, gain, gate, decay, vibrato, melody }], drums }
 * Returns a handle { events, endTime, playing, stop() }. `events` lists the
 * melody notes with their AudioContext times so the room can animate along.
 */
export function playTune(tune, { onEnd, startAt } = {}) {
  const ac = audio();
  if (!ac) return null;
  const bus = ac.createGain();
  bus.gain.value = tune.volume ?? 0.6;
  bus.connect(master);
  if (tune.echo) {
    // a soft feedback delay for dreamy, roomy tunes
    const delay = ac.createDelay(2);
    delay.delayTime.value = tune.echo.time ?? 0.3;
    const fb = ac.createGain();
    fb.gain.value = tune.echo.feedback ?? 0.3;
    const wet = ac.createGain();
    wet.gain.value = tune.echo.mix ?? 0.25;
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    bus.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(wet).connect(master);
  }
  const t0 = startAt ?? ac.currentTime + 0.08;
  const step = 60 / tune.bpm / 4;
  const nodes = [];
  const events = [];
  let endTime = t0;

  for (const ch of tune.channels) {
    let t = t0;
    for (const ev of parseTrack(ch.notes)) {
      const d = ev.len * step;
      if (ev.midi != null) {
        const f = midiHz(ev.midi);
        const gate = Math.max(0.04, d * (ch.gate ?? 0.9) - 0.01);
        const a = ch.gain ?? 0.2;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(a, t + 0.004);
        if (ch.decay) g.gain.exponentialRampToValueAtTime(a * ch.decay, t + gate);
        else g.gain.setValueAtTime(a, t + gate - 0.008);
        g.gain.linearRampToValueAtTime(0.0001, t + gate + 0.01);
        const o = ac.createOscillator();
        if (ch.wave === "pulse") o.setPeriodicWave(pulseWave(ac, ch.duty ?? 0.25));
        else o.type = ch.wave || "square";
        o.frequency.setValueAtTime(f, t);
        if (ch.vibrato) {
          const lfo = ac.createOscillator();
          lfo.frequency.value = 5.5;
          const lg = ac.createGain();
          lg.gain.value = f * ch.vibrato;
          lfo.connect(lg).connect(o.frequency);
          lfo.start(t + 0.06);
          lfo.stop(t + gate + 0.02);
          nodes.push(lfo);
        }
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + gate + 0.03);
        nodes.push(o);
        if (ch.melody) events.push({ time: t, midi: ev.midi, dur: d });
      }
      t += d;
    }
    endTime = Math.max(endTime, t);
  }

  if (tune.drums) {
    let t = t0;
    for (const c of tune.drums.replace(/[|\s]/g, "")) {
      if (c === "K" || c === "k") kick(ac, bus, t, 0.5);
      if (c === "s") snare(ac, bus, t, 0.3);
      if (c === "h" || c === "K") hat(ac, bus, t, 0.06);
      t += step;
    }
    endTime = Math.max(endTime, t);
  }

  let timer = 0;
  const handle = {
    events,
    endTime,
    playing: true,
    stop(fade = 0.15) {
      if (!handle.playing) return;
      handle.playing = false;
      clearTimeout(timer);
      const now = ac.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0.0001, now + fade);
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch (e) {
            /* already stopped */
          }
        }
        bus.disconnect();
      }, fade * 1000 + 50);
    },
  };
  timer = setTimeout(() => {
    handle.playing = false;
    bus.disconnect();
    onEnd && onEnd();
  }, (endTime - ac.currentTime + 0.6) * 1000);
  return handle;
}

/** Play a tune on repeat, gapless. Returns { playing, stop() }. */
export function loopTune(tune) {
  const ac = audio();
  if (!ac) return null;
  let current = null;
  let timer = 0;
  const handle = {
    playing: true,
    stop(fade = 0.6) {
      if (!handle.playing) return;
      handle.playing = false;
      clearTimeout(timer);
      if (current) current.stop(fade);
    },
  };
  const go = (startAt) => {
    if (!handle.playing) return;
    current = playTune(tune, { startAt });
    // queue the next pass just before this one ends
    const wait = Math.max(0.05, current.endTime - ac.currentTime - 0.25);
    timer = setTimeout(() => go(current.endTime), wait * 1000);
  };
  go(ac.currentTime + 0.08);
  return handle;
}

// ---------------------------------------------------------------------------
// UI sounds
// ---------------------------------------------------------------------------
/** A short square-wave chirp (lamp switch). */
export function blip(freq = 660, dur = 0.07, a = 0.1) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(a, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A low motor hum that runs until .stop() is called (sit-stand desk). */
export function motor() {
  const ac = audio();
  if (!ac) return { stop() {} };
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = 54;
  const o2 = ac.createOscillator();
  o2.type = "square";
  o2.frequency.value = 108.5;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.2);
  const g2 = ac.createGain();
  g2.gain.value = 0.35;
  o.connect(lp);
  o2.connect(g2).connect(lp);
  lp.connect(g).connect(master);
  o.start(t);
  o2.start(t);
  return {
    stop() {
      const n = ac.currentTime;
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(g.gain.value, n);
      g.gain.linearRampToValueAtTime(0.0001, n + 0.18);
      o.stop(n + 0.22);
      o2.stop(n + 0.22);
      blip(180, 0.05, 0.06);
    },
  };
}

// ---------------------------------------------------------------------------
// The tune behind the Goku poster: "Cha-La Head-Cha-La" (DBZ opening), 8-bit
// ---------------------------------------------------------------------------
// Pitches: the piano letter-note transcription, verse 1 through "Sparking!",
// transposed up a whole step into the piano sheet's key (E, chorus in D).
// Rhythm, tempo (154) and the intro/pickup runs come from the piano sheet.
// Bars are 16 sixteenths; "C|D" splits a bar between two chords.
const BARS = [
  "riff1", "riff2", // intro riff
  "E", "E", "C", "D", // verse line 1-2
  "E", "C|D", // line 3
  "E", "E", "C", "D", // line 4
  "E", "C|D", // line 5
  "C#m", "A", // line 6
  "E", "A|E", "B", "A", // line 7 + pickup run
  "D", "D", // hook
  "D", "G", "G|A", "D", // answer 1
  "D", "D", // hook
  "D", "G|A", // answer 2
  "D|A#", "A#", "C", "D-end", // build + "Sparking!"
];
const ROOT = {
  E: ["E2", "E3"], D: ["D2", "D3"], C: ["C2", "C3"], A: ["A2", "A3"], B: ["B2", "B3"],
  "C#m": ["C#2", "C#3"], G: ["G2", "G3"], "A#": ["A#1", "A#2"],
};
const TRIAD = {
  E: ["E3", "G#3", "B3"], D: ["D3", "F#3", "A3"], C: ["C3", "E3", "G3"], A: ["A3", "C#4", "E4"], B: ["B3", "D#4", "F#4"],
  "C#m": ["C#3", "E3", "G#3"], G: ["G3", "B3", "D4"], "A#": ["A#3", "D4", "F4"],
};
const RIFF = {
  riff1: { bass: "E2:2 E2:2 E2:2 D2:2 E2:2 E2:2 E2:2 D2:2", arp: "E3:2 E3:2 E3:2 D3:2 E3:2 E3:2 E3:2 D3:2" },
  riff2: { bass: "E2:2 E2:2 E2:2 D2:2 C2:4 D2:4", arp: "E3:2 E3:2 E3:2 D3:2 C3:4 D3:4" },
};
function bassBar(bar) {
  if (RIFF[bar]) return RIFF[bar].bass;
  if (bar === "D-end") return "D2:8 R:8";
  const parts = bar.split("|");
  if (parts.length === 2) {
    return parts
      .map((c) => {
        const [lo, hi] = ROOT[c];
        return `${lo}:2 ${lo}:2 ${hi}:2 ${lo}:2`;
      })
      .join(" ");
  }
  const [lo, hi] = ROOT[bar];
  return `${lo}:2 ${lo}:2 ${hi}:2 ${lo}:2 ${lo}:2 ${hi}:2 ${lo}:2 ${hi}:2`;
}
function arpBar(bar) {
  if (RIFF[bar]) return RIFF[bar].arp;
  if (bar === "D-end") return "D3:8 R:8";
  const parts = bar.split("|");
  const one = (c, n) => {
    const [a, b, d] = TRIAD[c];
    return n === 4 ? `${a}:2 ${b}:2 ${d}:2 ${b}:2` : `${a}:2 ${b}:2 ${d}:2 ${b}:2 ${a}:2 ${b}:2 ${d}:2 ${b}:2`;
  };
  return parts.length === 2 ? parts.map((c) => one(c, 4)).join(" ") : one(bar, 8);
}

export const CHALA_TUNE = {
  bpm: 154,
  volume: 0.6,
  channels: [
    {
      melody: true,
      wave: "pulse",
      duty: 0.25,
      gain: 0.22,
      gate: 0.92,
      vibrato: 0.008,
      notes: [
        // intro riff (E D E D C)
        "E4:2 E4:2 E4:2 D4:2 E4:2 E4:2 E4:2 D4:2",
        "E4:2 E4:2 E4:2 D4:2 C4:4 D4:4",
        // line 1-2 (page: G F# D A A G F# G A A / G D A G D)
        "R:4 A4:4 G#4:2 E4:4 B4:2",
        "B4:2 A4:2 G#4:2 A4:2 B4:2 B4:4 A4:2",
        "E5:2 E5:4 E5:10",
        "B4:2 A4:4 E5:10",
        // line 3 (D E F G A A# C A# A# A A A G A)
        "E4:2 F#4:2 G4:2 A4:2 B4:2 C5:2 D5:2 C5:2",
        "C5:2 B4:2 B4:4 B4:2 A4:2 B4:4",
        // line 4 (G F# D D A A G G F# A G A G D A A G D)
        "R:4 A4:4 G#4:2 E4:4 E4:2",
        "B4:2 B4:2 A4:2 A4:2 G#4:2 B4:4 A4:2",
        "B4:2 A4:4 E5:10",
        "B4:2 B4:4 A4:2 E5:8",
        // line 5 (D E F G A A# C A# A# A A)
        "E4:2 F#4:2 G4:2 A4:2 B4:2 C5:2 D5:2 C5:2",
        "C5:2 B4:2 B4:8 R:4",
        // line 6 (B F# F# B A G F# E F# E F#)
        "C#5:4 G#4:2 G#4:2 C#5:2 B4:2 A4:2 G#4:2",
        "F#4:2 G#4:2 F#4:2 G#4:6 R:4",
        // line 7 (D G F# G F# D D G F# D G F# D G A A)
        "E4:4 A4:2 G#4:2 A4:4 G#4:2 E4:2",
        "E4:2 A4:2 G#4:2 E4:2 A4:2 G#4:2 E4:2 A4:2",
        "B4:6 B4:2 R:8",
        // pickup run into the chorus (from the sheet)
        "R:2 B3:2 C#4:2 D4:2 E4:2 F#4:2 G4:2 A4:2",
        // hook (C D C A D -> D E D B E)
        "D5:6 E5:6 R:4",
        "D5:2 R:2 B4:2 E5:6 R:4",
        // answer 1 (E F E D E F E D D C F F E D D C D)
        "R:4 F#5:4 G5:4 F#5:2 E5:2",
        "F#5:2 G5:2 F#5:4 E5:4 E5:2 D5:2",
        "G5:2 G5:2 F#5:2 E5:2 E5:2 D5:2 E5:4",
        "E5:12 R:4",
        // hook
        "D5:6 E5:6 R:4",
        "D5:2 R:2 B4:2 E5:6 R:4",
        // answer 2 (E F E D E F E D D C C)
        "R:4 F#5:4 G5:4 F#5:2 E5:2",
        "F#5:2 G5:2 F#5:4 E5:4 E5:2 D5:2",
        // build (A C D D# D# D# D# D#) and "Sparking!" (F D#)
        "D5:4 R:4 B4:2 D5:2 E5:2 F5:2",
        "F5:2 F5:2 F5:2 F5:6 R:4",
        "G5:6 F5:6 R:4",
        "D5:8 R:8",
      ].join(" | "),
    },
    { wave: "pulse", duty: 0.125, gain: 0.07, gate: 0.6, decay: 0.3, notes: BARS.map(arpBar).join(" | ") },
    { wave: "triangle", gain: 0.3, gate: 0.8, notes: BARS.map(bassBar).join(" | ") },
  ],
  drums: [Array(2).fill("K.h.s.h.K.h.s.h."), Array(4).fill("k.h...h.k.h...h."), Array(BARS.length - 7).fill("K.h.s.h.K.h.s.h."), ["K.......s......."]].flat().join("|"),
};

// ---------------------------------------------------------------------------
// The desk speaker: a gentle looping chiptune, soft and a little dreamy
// ---------------------------------------------------------------------------
const AMBIENT_CHORDS = ["C", "Am", "F", "G", "C", "Am", "F", "G"];
const AMB_ARP = {
  C: "C4:2 E4:2 G4:2 B4:2 C5:2 B4:2 G4:2 E4:2",
  Am: "A3:2 C4:2 E4:2 G4:2 A4:2 G4:2 E4:2 C4:2",
  F: "F3:2 A3:2 C4:2 E4:2 F4:2 E4:2 C4:2 A3:2",
  G: "G3:2 B3:2 D4:2 F#4:2 G4:2 F#4:2 D4:2 B3:2",
};
const AMB_BASS = { C: "C2:8 G2:8", Am: "A2:8 E2:8", F: "F2:8 C3:8", G: "G2:8 D3:8" };
export const AMBIENT_TUNE = {
  bpm: 92,
  volume: 0.42,
  echo: { time: 0.39, feedback: 0.35, mix: 0.3 },
  channels: [
    {
      // melody: soft triangle, long notes, gentle vibrato
      wave: "triangle",
      gain: 0.16,
      gate: 0.95,
      decay: 0.6,
      vibrato: 0.006,
      notes: [
        "E5:4 G5:4 A5:6 G5:2",
        "E5:8 D5:4 C5:4",
        "A4:4 C5:4 D5:6 C5:2",
        "D5:8 E5:8",
        "G5:4 E5:4 D5:4 C5:4",
        "A4:6 C5:2 D5:8",
        "E5:4 D5:4 C5:4 A4:4",
        "G4:12 R:4",
      ].join(" | "),
    },
    { wave: "pulse", duty: 0.125, gain: 0.05, gate: 0.7, decay: 0.4, notes: AMBIENT_CHORDS.map((c) => AMB_ARP[c]).join(" | ") },
    { wave: "triangle", gain: 0.2, gate: 0.95, notes: AMBIENT_CHORDS.map((c) => AMB_BASS[c]).join(" | ") },
  ],
};
