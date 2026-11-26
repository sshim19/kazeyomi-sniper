/** tick(state, input, dt) → state. Aim, fire, flight, reveal, score. No DOM. */

import {
  FIRE_LOCK,
  FIXED_DT,
  MAX_DT,
  REVEAL_TIME,
  SENSITIVITY,
  SHOT_COUNT,
  swayMeters,
  wuPerMeter,
} from "./constants.mjs";
import { gradeForRadius, impactPoint, pointsForGrade } from "./ballistic.mjs";
import { hashSeed } from "./rng.mjs";
import { dailyShots } from "./shot.mjs";

function cloneState(s) {
  return {
    ...s,
    shots: s.shots.map((sh) => ({ ...sh })),
    locked: s.locked ? { ...s.locked } : null,
    stats: { ...s.stats },
  };
}

function emptyStats() {
  return { core: 0, good: 0, close: 0, rim: 0, miss: 0 };
}

function loadShotAim(s, index) {
  const shot = s.shots[index];
  s.shotIndex = index;
  s.aimX = shot.startAimX;
  s.aimY = shot.startAimY;
  s.swayPhiX = shot.swayPhiX;
  s.swayPhiY = shot.swayPhiY;
  s.locked = null;
  s.phase = "aim";
  s.phaseT = 0;
}

function updateBests(s) {
  if (s.score <= 0) return;
  if (s.score > s.bestScore) s.bestScore = s.score;
  if (s.score > s.todayBestScore) s.todayBestScore = s.score;
}

function endRun(s) {
  s.status = "over";
  updateBests(s);
}

function applyAim(s, input) {
  const aim = input?.aim;
  if (!aim || !aim.active) return;
  if (s.phase !== "aim") return;
  const dx = Number(aim.dx) || 0;
  const dy = Number(aim.dy) || 0;
  const k = wuPerMeter(s.shots[s.shotIndex].distance);
  s.aimX += (dx * SENSITIVITY) / k;
  s.aimY += (dy * SENSITIVITY) / k;
  if (dx !== 0 || dy !== 0) s.hintAim = false;
}

function applyFire(s, input) {
  if (!input?.fire) return;
  if (s.phase !== "aim") return;
  if (s.phaseT + 1e-9 < FIRE_LOCK) return;
  const shot = s.shots[s.shotIndex];
  if (shot.fired) return;

  const sw = swayMeters(s.phaseT, s.swayPhiX, s.swayPhiY, shot.distance);
  const usedX = s.aimX + sw.x;
  const usedY = s.aimY + sw.y;
  const hit = impactPoint({
    aimX: usedX,
    aimY: usedY,
    windX: shot.windX,
    windY: shot.windY,
    distance: shot.distance,
  });
  const grade = gradeForRadius(hit.r);
  const points = pointsForGrade(grade);

  s.locked = { aimX: s.aimX, aimY: s.aimY, swayX: sw.x, swayY: sw.y };
  shot.fired = true;
  shot.impactX = hit.impactX;
  shot.impactY = hit.impactY;
  shot.grade = grade;
  shot.points = points;
  s.score += points;
  s.stats[grade] += 1;
  if (grade === "core") s.coreStreak += 1;
  else s.coreStreak = 0;
  s.hintFire = false;
  s.phase = "flight";
  s.phaseT = 0;
  updateBests(s);
}

function applyInput(s, input) {
  applyAim(s, input);
  applyFire(s, input);
}

function advanceToNextShot(s) {
  if (s.shotIndex + 1 >= SHOT_COUNT) {
    endRun(s);
    return;
  }
  loadShotAim(s, s.shotIndex + 1);
}

function stepPhase(s, dt) {
  if (s.status !== "playing") return;
  s.phaseT += dt;
  if (s.phase === "flight") {
    const dur = s.shots[s.shotIndex].flightDur;
    if (s.phaseT + 1e-9 >= dur) {
      s.phaseT = Math.max(0, s.phaseT - dur);
      s.phase = "reveal";
    }
  }
  if (s.phase === "reveal" && s.phaseT + 1e-9 >= REVEAL_TIME) {
    // Do not carry remainder into aim: the 0.30s fire lock starts cleanly.
    advanceToNextShot(s);
  }
}

/**
 * Near-pure: same state+input+dt → same result. Does not mutate state or input.
 * Clamps dt to 50ms and steps at 1/60 + remainder.
 * When landscape is false, aim and fire are ignored and time does not advance.
 */
export function tick(state, input, dt) {
  if (state.status !== "playing") return cloneState(state);
  const s = cloneState(state);
  if (!input?.landscape) return s;
  applyInput(s, input);
  let left = Math.min(Math.max(Number(dt) || 0, 0), MAX_DT);
  while (left > 0 && s.status === "playing") {
    const stepDt = Math.min(FIXED_DT, left);
    stepPhase(s, stepDt);
    left -= stepDt;
  }
  return s;
}

/**
 * End a run early (「やめる」). Unfired shots stay unfired and add 0 points.
 * Best scores update only when score > 0.
 */
export function quitRun(state) {
  const s = cloneState(state);
  if (s.status === "playing") endRun(s);
  return s;
}

/** Fresh playing state for a run. bestScore / todayBestScore are in-memory; persist elsewhere. */
export function createInitialState({ seed, dateJst, bestScore = 0, todayBestScore = 0 } = {}) {
  const rng0 = hashSeed(seed);
  const built = dailyShots(rng0);
  const first = built.shots[0];
  return {
    status: "playing",
    phase: "aim",
    seed,
    dateJst: dateJst ?? null,
    shotIndex: 0,
    phaseT: 0,
    score: 0,
    coreStreak: 0,
    rngState: built.rngState,
    aimX: first.startAimX,
    aimY: first.startAimY,
    swayPhiX: first.swayPhiX,
    swayPhiY: first.swayPhiY,
    shots: built.shots,
    locked: null,
    bestScore: bestScore || 0,
    todayBestScore: todayBestScore || 0,
    hintAim: true,
    hintFire: true,
    stats: emptyStats(),
  };
}
