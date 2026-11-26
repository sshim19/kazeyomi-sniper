/** Flight time, drop, wind drift, impact, grade, and points. No DOM. */

import {
  BULLET_SPEED,
  GRAVITY,
  WIND_K,
  gradeForRadius,
  pointsForGrade,
} from "./constants.mjs";

export { gradeForRadius, pointsForGrade };

export function flightTime(distance) {
  return (Number(distance) || 0) / BULLET_SPEED;
}

export function dropAt(t) {
  const x = Number(t) || 0;
  return 0.5 * GRAVITY * x * x;
}

export function driftAt(wind, t) {
  const x = Number(t) || 0;
  return (Number(wind) || 0) * x * x * WIND_K;
}

/**
 * Impact on the target plane (meters, Y down).
 * aimX / aimY already include sway if this is a fired shot.
 * @returns {{ t: number, drop: number, driftX: number, driftY: number, impactX: number, impactY: number, r: number }}
 */
export function impactPoint({ aimX, aimY, windX, windY, distance }) {
  const t = flightTime(distance);
  const drop = dropAt(t);
  const driftX = driftAt(windX, t);
  const driftY = driftAt(windY, t);
  const impactX = (Number(aimX) || 0) + driftX;
  const impactY = (Number(aimY) || 0) + drop + driftY;
  const r = Math.hypot(impactX, impactY);
  return { t, drop, driftX, driftY, impactX, impactY, r };
}

/** Hand aim that cancels wind and drop, so a no-sway shot lands at the center. */
export function compensationAim(windX, windY, distance) {
  const hit = impactPoint({ aimX: 0, aimY: 0, windX, windY, distance });
  return {
    aimX: -hit.driftX,
    aimY: -(hit.drop + hit.driftY),
    t: hit.t,
    drop: hit.drop,
    driftX: hit.driftX,
    driftY: hit.driftY,
  };
}

export function gradeShot(args) {
  const hit = impactPoint(args);
  const grade = gradeForRadius(hit.r);
  return { ...hit, grade, points: pointsForGrade(grade) };
}
