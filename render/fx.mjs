/**
 * 発射の寄りと跳ね、軌跡、穴、吹き出し、揺れ。
 * エンジンは触らず、state の変化から起こす。
 */

import {
  GRADE_BALLOONS,
  JUDGE_BALLOON_OFFSET,
  REVEAL_TIME,
  SHOT_COUNT,
  TARGET_RADIUS,
  calloutForStreak,
} from "../engine/constants.mjs";
import { formatScore } from "./share.mjs";

export const PARTICLE_CAP = 160;
export const SHAKE_MAX_PX = 5;
export const SHAKE_MAX_S = 0.18;
export const KICK_ZOOM = 1.08;
export const KICK_ZOOM_DUR = 0.12;
export const KICK_BOUNCE_WU = 3;
export const KICK_BOUNCE_DUR = 0.08;
export const REVEAL_ZOOM = 1.28;
export const REVEAL_ZOOM_DUR = 0.4;
export const GROUND_Y = 0.7;

export function gradeBalloon(grade) {
  return GRADE_BALLOONS[grade] || null;
}

function shotOf(state) {
  const shots = state?.shots || [];
  const i = Math.max(0, Math.min(shots.length - 1, Math.floor(Number(state?.shotIndex) || 0)));
  return shots[i] || null;
}

function rgba(hex, a) {
  const n = parseInt(String(hex || "#f5f0e6").replace("#", ""), 16);
  if (!Number.isFinite(n)) return `rgba(245, 240, 230, ${a})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function createFx() {
  return {
    particles: [],
    floats: [],
    flashes: [],
    kick: null,
    shake: null,
    flash: null,
    reveal: null,
    bullet: null,
    hole: null,
    clock: 0,
    prev: null,
  };
}

export function resetFx(fx) {
  if (!fx) return;
  fx.particles.length = 0;
  fx.floats.length = 0;
  fx.flashes.length = 0;
  fx.kick = null;
  fx.shake = null;
  fx.flash = null;
  fx.reveal = null;
  fx.bullet = null;
  fx.hole = null;
  fx.clock = 0;
  fx.prev = null;
}

function capParticles(fx) {
  const extra = fx.particles.length - PARTICLE_CAP;
  if (extra > 0) fx.particles.splice(0, extra);
}

function addParticle(fx, p) {
  if (fx.particles.length >= PARTICLE_CAP) fx.particles.shift();
  fx.particles.push(p);
}

function addFloat(fx, f) {
  fx.floats.push({
    life: 1.05,
    scale: 1,
    color: "#1c2430",
    space: "target",
    x: 0,
    yWu: -JUDGE_BALLOON_OFFSET,
    ...f,
  });
}

function triggerShake(fx, reduced, amp = SHAKE_MAX_PX) {
  if (reduced) return;
  fx.shake = { t: 0, dur: SHAKE_MAX_S, amp: Math.min(SHAKE_MAX_PX, amp) };
  fx.flash = { t: 0, dur: 0.14, alpha: 0.1, color: "#f5f0e6" };
}

function spawnDust(fx, wx, wy, reduced) {
  const count = reduced ? 3 : 14;
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const sp = 0.18 + Math.random() * 0.35;
    addParticle(fx, {
      kind: "dust",
      x: wx + (Math.random() - 0.5) * 0.08,
      y: wy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.12,
      color: "#8a6a3a",
      r: 0.03 + Math.random() * 0.04,
      life: 0.45 + Math.random() * 0.3,
      max: 0.7,
    });
  }
}

function spawnSparks(fx, wx, wy, color, amount, reduced) {
  const count = reduced ? Math.min(3, amount) : amount;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.25 + Math.random() * 0.55;
    addParticle(fx, {
      kind: "spark",
      x: wx,
      y: wy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      color,
      r: 0.012 + Math.random() * 0.018,
      life: 0.28 + Math.random() * 0.2,
      max: 0.5,
    });
  }
}

function eventFromDiff(prev, state) {
  if (!prev || !state) return null;
  if (state.status !== "playing" && state.status !== "over") return null;
  const shot = shotOf(state);
  const phase = state.phase;
  if (prev.phase !== "flight" && phase === "flight") {
    return {
      kind: "shot",
      flightDur: Number(shot?.flightDur) || 0.25,
      impactX: Number(shot?.impactX) || 0,
      impactY: Number(shot?.impactY) || 0,
      skin: shot?.skin || "kami",
    };
  }
  if (prev.phase !== "reveal" && phase === "reveal") {
    return {
      kind: "reveal",
      grade: shot?.grade || "miss",
      points: Number(shot?.points) || 0,
      impactX: Number(shot?.impactX) || 0,
      impactY: Number(shot?.impactY) || 0,
      skin: shot?.skin || "kami",
      streak: Math.max(0, Math.floor(Number(state.coreStreak) || 0)),
      prevStreak: Math.max(0, Math.floor(Number(prev.coreStreak) || 0)),
    };
  }
  if (
    prev.shotIndex !== (state.shotIndex ?? 0) &&
    phase === "aim"
  ) {
    if ((state.shotIndex ?? 0) === SHOT_COUNT && state.extended) {
      return { kind: "extension" };
    }
    return { kind: "next" };
  }
  return null;
}

function startKick(fx, ev, reduced) {
  fx.bullet = {
    t: 0,
    dur: Math.max(0.08, Number(ev.flightDur) || 0.25),
    impactX: ev.impactX,
    impactY: ev.impactY,
  };
  fx.hole = null;
  fx.reveal = null;
  fx.floats.length = 0;
  if (reduced) {
    fx.kick = null;
    return;
  }
  fx.kick = { t: 0, dur: KICK_ZOOM_DUR };
}

function startReveal(fx, ev, reduced) {
  fx.bullet = null;
  fx.hole = {
    x: ev.impactX,
    y: ev.impactY,
    grade: ev.grade,
    skin: ev.skin,
  };
  fx.reveal = {
    t: 0,
    dur: REVEAL_TIME,
    impactX: ev.impactX,
    impactY: ev.impactY,
  };

  const onTarget = ev.grade && ev.grade !== "miss";
  const ground = ev.impactY >= GROUND_Y;
  if (onTarget) {
    fx.flashes.push({
      x: ev.impactX,
      y: ev.impactY,
      r: ev.grade === "core" ? 0.04 : ev.grade === "good" ? 0.12 : ev.grade === "close" ? 0.22 : TARGET_RADIUS,
      life: 0.22,
      max: 0.22,
    });
    const color = ev.skin === "kami" ? "#f3eee3" : ev.skin === "tetsu" ? "#c8cdd2" : "#d8d0b8";
    spawnSparks(fx, ev.impactX, ev.impactY, color, ev.grade === "core" ? 14 : 8, reduced);
  } else if (ground) {
    spawnDust(fx, ev.impactX, ev.impactY, reduced);
  } else {
    addParticle(fx, {
      kind: "speck",
      x: ev.impactX,
      y: ev.impactY,
      vx: 0,
      vy: 0,
      color: "#3a3428",
      r: 0.02,
      life: 0.9,
      max: 0.9,
    });
    spawnDust(fx, ev.impactX, ev.impactY, reduced);
  }

  const label = gradeBalloon(ev.grade);
  if (label) {
    addFloat(fx, {
      kind: "grade",
      text: label,
      yWu: -JUDGE_BALLOON_OFFSET,
      color: ev.grade === "miss" ? "#4a3a28" : "#1c2430",
      scale: ev.grade === "core" ? 1.1 : 1,
    });
  }
  if (ev.points > 0) {
    addFloat(fx, {
      kind: "score",
      text: `+${formatScore(ev.points)}点`,
      yWu: -JUDGE_BALLOON_OFFSET + 22,
      color: ev.grade === "core" ? "#6b3a10" : "#1c2430",
      scale: ev.grade === "core" ? 1.05 : 1,
    });
  }
  const callout = ev.grade === "core" ? calloutForStreak(ev.streak) : null;
  if (callout) {
    addFloat(fx, {
      kind: "callout",
      text: callout,
      yWu: -JUDGE_BALLOON_OFFSET - 26,
      color: "#6b3a10",
      scale: ev.streak >= 5 ? 1.16 : ev.streak >= 4 ? 1.08 : 1,
    });
  }
  if (ev.grade === "core") triggerShake(fx, reduced, SHAKE_MAX_PX);
}

/**
 * state の差分を見て演出を起こし、既存の粒子を進める。
 */
export function syncFx(fx, state, dt, opts = {}) {
  if (!fx) return;
  const reduced = !!opts.reducedMotion;
  const t = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
  const ev = eventFromDiff(fx.prev, state);
  if (ev?.kind === "shot") startKick(fx, ev, reduced);
  else if (ev?.kind === "reveal") startReveal(fx, ev, reduced);
  else if (ev?.kind === "next" || ev?.kind === "extension") {
    fx.bullet = null;
    fx.hole = null;
    fx.reveal = null;
    fx.kick = null;
    if (ev.kind === "extension") {
      addFloat(fx, {
        kind: "callout",
        text: "延長戦！",
        yWu: -JUDGE_BALLOON_OFFSET,
        color: "#6b3a10",
        scale: 1.2,
        life: 1.2,
      });
    }
  }

  if (t > 0) {
    fx.clock += t;
    if (fx.kick) {
      fx.kick.t += t;
      if (fx.kick.t >= fx.kick.dur) fx.kick = null;
    }
    if (fx.bullet) {
      fx.bullet.t += t;
      if (fx.bullet.t >= fx.bullet.dur) fx.bullet.t = fx.bullet.dur;
    }
    if (fx.reveal) {
      fx.reveal.t += t;
      if (fx.reveal.t >= fx.reveal.dur) {
        /* keep final zoom until the next shot */
      }
    }
    if (fx.shake) {
      fx.shake.t += t;
      if (fx.shake.t >= fx.shake.dur) fx.shake = null;
    }
    if (fx.flash) {
      fx.flash.t += t;
      if (fx.flash.t >= fx.flash.dur) fx.flash = null;
    }
    for (const p of fx.particles) {
      p.life -= t;
      p.x += p.vx * t;
      p.y += p.vy * t;
      if (p.kind === "dust") {
        p.vy += 0.9 * t;
        p.vx *= 1 - Math.min(1, 1.8 * t);
      } else if (p.kind === "spark") {
        p.vx *= 1 - Math.min(1, 2.2 * t);
        p.vy *= 1 - Math.min(1, 2.2 * t);
      }
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    for (const f of fx.floats) f.life -= t;
    fx.floats = fx.floats.filter((f) => f.life > 0);
    for (const c of fx.flashes) c.life -= t;
    fx.flashes = fx.flashes.filter((c) => c.life > 0);
  }

  capParticles(fx);
  const shot = shotOf(state);
  fx.prev = {
    status: state?.status || "title",
    phase: state?.phase || "aim",
    shotIndex: state?.shotIndex ?? 0,
    coreStreak: state?.coreStreak ?? 0,
    grade: shot?.grade ?? null,
  };
}

export function scopeZoom(fx, reduced) {
  if (reduced) return 1;
  const k = fx?.kick;
  if (!k || k.dur <= 0) return 1;
  const u = Math.max(0, Math.min(1, k.t / k.dur));
  // Punch in quickly, settle back by the end of 0.12s.
  const peakAt = 0.35;
  const env = u < peakAt ? u / peakAt : 1 - (u - peakAt) / (1 - peakAt);
  return 1 + (KICK_ZOOM - 1) * Math.max(0, env);
}

export function kickBounceY(fx, reduced) {
  if (reduced) return 0;
  const k = fx?.kick;
  if (!k) return 0;
  const u = Math.max(0, Math.min(1, k.t / KICK_BOUNCE_DUR));
  if (k.t >= KICK_BOUNCE_DUR) return 0;
  const env = Math.sin(u * Math.PI);
  return -KICK_BOUNCE_WU * env;
}

export function revealZoom(fx, reduced) {
  if (reduced) return 1;
  const r = fx?.reveal;
  if (!r) return 1;
  const u = Math.max(0, Math.min(1, r.t / REVEAL_ZOOM_DUR));
  const eased = 1 - (1 - u) * (1 - u);
  return 1 + (REVEAL_ZOOM - 1) * eased;
}

export function shakeOffset(fx) {
  const s = fx?.shake;
  if (!s || s.dur <= 0) return { x: 0, y: 0 };
  const u = Math.max(0, 1 - s.t / s.dur);
  const amp = Math.min(SHAKE_MAX_PX, s.amp) * u * u;
  return {
    x: Math.sin(s.t * 92) * amp,
    y: Math.cos(s.t * 80) * amp * 0.7,
  };
}

export function bulletProgress(fx) {
  const b = fx?.bullet;
  if (!b || b.dur <= 0) return null;
  return {
    p: Math.max(0, Math.min(1, b.t / b.dur)),
    dur: b.dur,
    impactX: b.impactX,
    impactY: b.impactY,
  };
}

/**
 * 吹き出し・粒・輪の光を描く。
 * @param {{ worldToView: Function, px: Function, metersToPx: Function, reducedMotion?: boolean }} view
 */
export function drawFx(ctx, fx, view) {
  if (!fx) return;
  const worldToView = view.worldToView;
  const px = view.px;
  const metersToPx = view.metersToPx;
  const reducedMotion = !!view.reducedMotion;
  const layer = view.layer || "all";
  const font = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;

  if (layer !== "floats") {
    for (const c of fx.flashes) {
      const u = Math.max(0, Math.min(1, c.life / (c.max || 0.22)));
      const p = worldToView(c.x, c.y);
      ctx.save();
      ctx.strokeStyle = rgba("#f5f0e6", 0.95 * u);
      ctx.lineWidth = Math.max(1.5, px(3) * (0.6 + 0.4 * u));
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, metersToPx(c.r)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of fx.particles) {
      const u = Math.max(0, Math.min(1, p.life / (p.max || 0.5)));
      const pos = worldToView(p.x, p.y);
      const rad = Math.max(0.8, metersToPx(p.r) * (0.55 + 0.45 * u));
      ctx.fillStyle = rgba(p.color || "#8a6a3a", 0.2 + 0.75 * u);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (layer === "world") return;

  const rim = Number(view.targetRimWu) || 0;
  const baseY = Math.min(-JUDGE_BALLOON_OFFSET, -rim - 22);
  for (const f of fx.floats) {
    const dur = 1.05;
    const u = Math.max(0, Math.min(1, f.life / dur));
    const age = 1 - u;
    let pop = 1;
    if (!reducedMotion) {
      if (age < 0.12) pop = 0.7 + 0.55 * (age / 0.12);
      else if (age < 0.22) pop = 1.25 - 0.25 * ((age - 0.12) / 0.1);
      else pop = 1;
    }
    const fade = u < 0.25 ? u / 0.25 : 1;
    const lift = age * (f.kind === "score" ? 16 : 10);
    const stack = (f.yWu || 0) + JUDGE_BALLOON_OFFSET;
    const anchor = worldToView(0, 0);
    const x = anchor.x;
    const y = anchor.y + px(baseY + stack - lift);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop * (f.scale || 1), pop * (f.scale || 1));
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size =
      f.kind === "callout"
        ? Math.max(22, px(26) * (f.scale || 1))
        : f.kind === "grade"
          ? Math.max(18, px(22) * (f.scale || 1))
          : Math.max(14, px(16) * (f.scale || 1));
    ctx.font = `700 ${size}px ${font}`;
    const tw = ctx.measureText(f.text).width;
    ctx.fillStyle = rgba("#f5f0e6", 0.88);
    const padX = 8;
    const padY = 4;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(-tw / 2 - padX, -size / 2 - padY, tw + padX * 2, size + padY * 2, 6);
    } else {
      ctx.rect(-tw / 2 - padX, -size / 2 - padY, tw + padX * 2, size + padY * 2);
    }
    ctx.fill();
    ctx.fillStyle = f.color || "#1c2430";
    ctx.shadowColor = "rgba(245, 240, 230, 0.5)";
    ctx.shadowBlur = 2;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
}

export function drawFlash(ctx, cssW, cssH, fx) {
  const f = fx?.flash;
  if (!f || f.dur <= 0) return;
  const u = Math.max(0, 1 - f.t / f.dur);
  ctx.fillStyle = rgba(f.color || "#f5f0e6", f.alpha * u * u);
  ctx.fillRect(0, 0, cssW, cssH);
}

export { rgba };
