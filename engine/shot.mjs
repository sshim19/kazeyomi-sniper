/** dailyShots(rngState) → { shots, rngState }. Idempotent 5-shot stream. */

import {
  SHOT_COUNT,
  SHOT_TABLE,
  SKINS,
  START_OFFSET_WU_MAX,
  START_OFFSET_WU_MIN,
  WIND_ANGLE_MAX,
  wuToMeters,
} from "./constants.mjs";
import { flightTime } from "./ballistic.mjs";
import { rngRange, rngStep } from "./rng.mjs";

function pickIndexed(roll, list) {
  if (!list.length) return list[0];
  const i = Math.min(list.length - 1, Math.floor(roll * list.length));
  return list[i];
}

function emptyResult() {
  return {
    fired: false,
    impactX: 0,
    impactY: 0,
    grade: null,
    points: 0,
  };
}

/**
 * One shot record. Always consumes 8 RNG draws so the stream stays aligned:
 * wind speed, side, angle, offset magnitude, offset angle, swayPhiX, swayPhiY, skin.
 */
export function makeShot(rngState, index) {
  const spec = SHOT_TABLE[index] || SHOT_TABLE[0];
  const distance = spec.distance;
  let a = rngState >>> 0;

  const speedRoll = rngRange(a, spec.windMin, spec.windMax);
  a = speedRoll.a;
  const sideRoll = rngStep(a);
  a = sideRoll.a;
  const angleRoll = rngRange(a, -WIND_ANGLE_MAX, WIND_ANGLE_MAX);
  a = angleRoll.a;
  const offMagRoll = rngRange(a, START_OFFSET_WU_MIN, START_OFFSET_WU_MAX);
  a = offMagRoll.a;
  const offAngRoll = rngRange(a, 0, Math.PI * 2);
  a = offAngRoll.a;
  const phiXRoll = rngRange(a, 0, Math.PI * 2);
  a = phiXRoll.a;
  const phiYRoll = rngRange(a, 0, Math.PI * 2);
  a = phiYRoll.a;
  const skinRoll = rngStep(a);
  a = skinRoll.a;

  const speed = speedRoll.value;
  const fromRight = sideRoll.value < 0.5;
  const angle = angleRoll.value;
  const sign = fromRight ? -1 : 1;
  const windX = sign * speed * Math.cos(angle);
  const windY = speed * Math.sin(angle);

  const offsetWu = offMagRoll.value;
  const offsetAng = offAngRoll.value;
  const startAimX = wuToMeters(offsetWu * Math.cos(offsetAng), distance);
  const startAimY = wuToMeters(offsetWu * Math.sin(offsetAng), distance);

  const shot = {
    distance,
    windX,
    windY,
    startAimX,
    startAimY,
    swayPhiX: phiXRoll.value,
    swayPhiY: phiYRoll.value,
    skin: pickIndexed(skinRoll.value, SKINS),
    flightDur: flightTime(distance),
    ...emptyResult(),
  };
  return { shot, rngState: a >>> 0 };
}

/**
 * Build the day's five shots from a uint32 RNG state (already hashed).
 * Same starting state always yields the same five shots, in stream order.
 */
export function dailyShots(rngState) {
  let a = rngState >>> 0;
  const shots = [];
  for (let i = 0; i < SHOT_COUNT; i++) {
    const next = makeShot(a, i);
    shots.push(next.shot);
    a = next.rngState;
  }
  return { shots, rngState: a >>> 0 };
}
