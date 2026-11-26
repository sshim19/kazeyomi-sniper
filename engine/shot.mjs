/** dailyShots(rngState) → { shots, rngState }. Idempotent 5-shot stream. Extension shots follow the same stream. */

import {
  SHOT_COUNT,
  SHOT_TABLE,
  SKINS,
  START_OFFSET_WU_MAX,
  START_OFFSET_WU_MIN,
  WIND_ANGLE_MAX,
  EXT_DIST_MIN,
  EXT_DIST_MAX,
  EXT_WIND_MAX_START,
  EXT_WIND_MAX,
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
 * One shot record from a spec. Always consumes 8 RNG draws so the stream stays aligned:
 * wind speed, side, angle, offset magnitude, offset angle, swayPhiX, swayPhiY, skin.
 */
export function makeShotFromSpec(rngState, spec) {
  const distance = Number(spec.distance) || 0;
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
 * One shot record. Always consumes 8 RNG draws so the stream stays aligned:
 * wind speed, side, angle, offset magnitude, offset angle, swayPhiX, swayPhiY, skin.
 */
export function makeShot(rngState, index) {
  const spec = SHOT_TABLE[index] || SHOT_TABLE[0];
  return makeShotFromSpec(rngState, spec);
}

/**
 * Extra shot after a 5-for-5. Consumes 1 distance draw, the usual 8, then 1 gust draw.
 * Distance climbs from 60–260m toward 60–400m; indicated wind toward 12 m/s.
 * windGust is a signed multiplier on the true wind at impact (0 on the daily five).
 * The sock and flag show the indicated wind only — strong late winds are gusty.
 */
export function makeExtShot(rngState, extIndex) {
  const i = Math.max(0, Math.floor(Number(extIndex) || 0));
  const t = Math.min(1, i / 16);
  let a = rngState >>> 0;
  const dMin = EXT_DIST_MIN + t * 140;
  const dMax = 260 + t * (EXT_DIST_MAX - 260);
  const distRoll = rngRange(a, dMin, dMax);
  a = distRoll.a;
  const distance = Math.max(EXT_DIST_MIN, Math.min(EXT_DIST_MAX, Math.round(distRoll.value)));
  const windMax = EXT_WIND_MAX_START + t * (EXT_WIND_MAX - EXT_WIND_MAX_START);
  const windMin = Math.min(3.0 + i * 0.35, Math.max(1.2, windMax - 0.7));
  const built = makeShotFromSpec(a, { distance, windMin, windMax });
  a = built.rngState;
  const gustAmp = 0.025 + 0.014 * i;
  const gustRoll = rngRange(a, -gustAmp, gustAmp);
  built.shot.windGust = gustRoll.value;
  built.rngState = gustRoll.a >>> 0;
  return built;
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
