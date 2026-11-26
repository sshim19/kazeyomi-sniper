/**
 * Web Audio だけで鳴らす効果音。ファイルもライブラリも使わない。
 * エンジンは触らず、state の変化から鳴らす音を決める。
 */

import { STORAGE_MUTED } from "../engine/constants.mjs";

export const MUTE_KEY = STORAGE_MUTED;
const MASTER_GAIN = 0.42;

function readMuted(storage) {
  if (!storage) return false;
  try {
    const v = storage.getItem(MUTE_KEY);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function writeMuted(muted, storage) {
  if (!storage) return;
  try {
    storage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadMuted(storage = globalThis.localStorage) {
  return readMuted(storage);
}

function shotOf(state) {
  const shots = state?.shots || [];
  const i = Math.max(0, Math.min(shots.length - 1, Math.floor(Number(state?.shotIndex) || 0)));
  return shots[i] || null;
}

function snapshot(state) {
  const shot = shotOf(state);
  return {
    status: state?.status || "title",
    phase: state?.phase || "aim",
    shotIndex: state?.shotIndex ?? 0,
    fired: !!shot?.fired,
    grade: shot?.grade ?? null,
    points: shot?.points ?? 0,
    skin: shot?.skin || "kami",
    flightDur: Number(shot?.flightDur) || 0,
    distance: Number(shot?.distance) || 0,
    coreStreak: Math.max(0, Math.floor(Number(state?.coreStreak) || 0)),
  };
}

/**
 * 直前の snapshot と新しい state から、鳴らすべき音を決める。純関数。
 * @returns {{ type: "shot"|"impact"|"miss", skin?: string, grade?: string, streak?: number, flightDur?: number, distance?: number } | null}
 */
export function soundEvent(prev, state) {
  if (!prev || !state) return null;
  if (state.status !== "playing" && state.status !== "over") return null;
  const now = snapshot(state);
  if (prev.phase !== "flight" && now.phase === "flight") {
    return {
      type: "shot",
      skin: now.skin,
      flightDur: now.flightDur,
      distance: now.distance,
    };
  }
  if (prev.phase !== "reveal" && now.phase === "reveal") {
    const grade = now.grade || "miss";
    return {
      type: grade === "miss" ? "miss" : "impact",
      grade,
      skin: now.skin,
      streak: now.coreStreak,
      points: now.points,
      distance: now.distance,
    };
  }
  return null;
}

export function createSfx() {
  return {
    prev: null,
    muted: loadMuted(),
    ctx: null,
    master: null,
    compressor: null,
    noiseBuf: null,
  };
}

export function resetSfx(sfx) {
  if (!sfx) return;
  sfx.prev = null;
}

function applyMuteGain(sfx, now) {
  if (!sfx?.master || !sfx.ctx) return;
  const g = sfx.master.gain;
  const t = now ?? sfx.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(sfx.muted ? 0 : MASTER_GAIN, t + 0.03);
}

export function setMuted(sfx, muted, storage = globalThis.localStorage) {
  if (!sfx) return;
  sfx.muted = !!muted;
  writeMuted(sfx.muted, storage);
  applyMuteGain(sfx);
}

export function isMuted(sfx) {
  return !!sfx?.muted;
}

/** 最初の操作で AudioContext を作り、iOS 向けに resume する。 */
export function unlockSfx(sfx) {
  if (!sfx) return;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  try {
    if (!sfx.ctx) {
      const ctx = new AC();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 10;
      compressor.ratio.value = 3.2;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.14;
      const master = ctx.createGain();
      master.gain.value = sfx.muted ? 0 : MASTER_GAIN;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      sfx.ctx = ctx;
      sfx.master = master;
      sfx.compressor = compressor;
    }
    if (sfx.ctx.state === "suspended") {
      const p = sfx.ctx.resume();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch {
    /* AudioContext unavailable */
  }
}

function noiseBuffer(sfx) {
  if (sfx.noiseBuf) return sfx.noiseBuf;
  const ctx = sfx.ctx;
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  sfx.noiseBuf = buf;
  return buf;
}

function playTone(ctx, dest, { freq, type = "sine", t0, dur, peak, attack = 0.012, endFreq }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq && endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {
      /* already gone */
    }
  };
}

function playNoise(sfx, dest, { t0, dur, peak, attack = 0.008, freq = 2400, type = "highpass", q = 0.7, endFreq }) {
  const ctx = sfx.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(sfx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
  src.onended = () => {
    try {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    } catch {
      /* already gone */
    }
  };
}

/** 乾いた「パン」。残響は付けない。 */
function playShot(sfx, ev) {
  const ctx = sfx.ctx;
  const dest = sfx.master;
  const t0 = ctx.currentTime + 0.002;
  playTone(ctx, dest, {
    freq: 148,
    endFreq: 72,
    type: "sine",
    t0,
    dur: 0.09,
    peak: 0.2,
    attack: 0.003,
  });
  playNoise(sfx, dest, {
    t0,
    dur: 0.07,
    peak: 0.16,
    attack: 0.002,
    freq: 1800,
    type: "highpass",
    q: 0.6,
    endFreq: 400,
  });
  const flight = Math.min(1.2, Math.max(0.18, Number(ev.flightDur) || 0.25));
  playNoise(sfx, dest, {
    t0: t0 + 0.04,
    dur: flight,
    peak: 0.035,
    attack: 0.04,
    freq: 1400,
    type: "bandpass",
    q: 0.7,
    endFreq: 600,
  });
}

function playImpact(sfx, ev) {
  const ctx = sfx.ctx;
  const dest = sfx.master;
  const t0 = ctx.currentTime + 0.002;
  const metal = ev.skin === "buriki" || ev.skin === "tetsu";
  if (metal) {
    playTone(ctx, dest, {
      freq: ev.skin === "tetsu" ? 920 : 1180,
      endFreq: ev.skin === "tetsu" ? 420 : 520,
      type: "triangle",
      t0,
      dur: 0.16,
      peak: 0.14,
      attack: 0.003,
    });
    playTone(ctx, dest, {
      freq: ev.skin === "tetsu" ? 1480 : 1760,
      endFreq: 700,
      type: "sine",
      t0,
      dur: 0.1,
      peak: 0.06,
      attack: 0.002,
    });
    playNoise(sfx, dest, {
      t0,
      dur: 0.07,
      peak: 0.07,
      freq: 2400,
      type: "highpass",
      q: 0.8,
    });
  } else {
    playNoise(sfx, dest, {
      t0,
      dur: 0.08,
      peak: 0.14,
      attack: 0.003,
      freq: 1600,
      type: "bandpass",
      q: 1.1,
      endFreq: 500,
    });
    playTone(ctx, dest, {
      freq: 240,
      endFreq: 120,
      type: "triangle",
      t0,
      dur: 0.07,
      peak: 0.07,
      attack: 0.003,
    });
  }

  if (ev.grade === "core") {
    const rise = Math.max(0, Math.min(4, (Number(ev.streak) || 1) - 1));
    const root = 784 * Math.pow(2, rise * 0.08);
    playTone(ctx, dest, {
      freq: root,
      type: "sine",
      t0: t0 + 0.02,
      dur: 0.16,
      peak: 0.11,
      attack: 0.008,
    });
    playTone(ctx, dest, {
      freq: root * 1.5,
      type: "sine",
      t0: t0 + 0.05,
      dur: 0.18,
      peak: 0.08,
      attack: 0.01,
    });
  }
}

function playMiss(sfx) {
  const ctx = sfx.ctx;
  const dest = sfx.master;
  const t0 = ctx.currentTime + 0.004;
  playNoise(sfx, dest, {
    t0,
    dur: 0.16,
    peak: 0.08,
    freq: 520,
    type: "bandpass",
    q: 0.8,
    endFreq: 180,
  });
  playTone(ctx, dest, {
    freq: 186,
    endFreq: 86,
    type: "sine",
    t0,
    dur: 0.16,
    peak: 0.06,
    attack: 0.01,
  });
}

/**
 * state の差分を見て効果音を鳴らす。
 * @param {object} sfx
 * @param {object} state
 */
export function syncSound(sfx, state) {
  if (!sfx) return null;
  const ev = soundEvent(sfx.prev, state);
  sfx.prev = snapshot(state);
  if (!ev || sfx.muted || !sfx.ctx) return ev;
  try {
    if (ev.type === "shot") playShot(sfx, ev);
    else if (ev.type === "miss") playMiss(sfx);
    else playImpact(sfx, ev);
  } catch {
    /* audio graph failed; ignore */
  }
  return ev;
}
