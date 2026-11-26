/** Dimensions, ballistics, the 5-shot table, scoring, and storage keys. Y is down. */

export const VIEW_W = 640;
export const VIEW_H = 360;

export const SCOPE_DIAMETER = 280;
export const FOV_REF_DISTANCE = 230;
export const FOV_HEIGHT_AT_REF = 5.6;
/** wu per meter at the reference distance (280 / 5.6 = 50). */
export const WU_PER_M_AT_REF = SCOPE_DIAMETER / FOV_HEIGHT_AT_REF;

export const TARGET_DIAMETER = 0.8;
export const TARGET_RADIUS = 0.4;
/** Flag stands 1.15 m to the right of the target center, on the target plane. */
export const FLAG_OFFSET_X = 1.15;

export const PAD_LEFT = 0;
export const PAD_RIGHT = 200;
export const PAD_TOP = 40;
export const PAD_BOTTOM = 360;
export const SENSITIVITY = 1.15;
export const FIRE_BTN_X = 584;
export const FIRE_BTN_Y = 300;
export const FIRE_BTN_R = 44;

export const SWAY_AMP = 2.4;
export const SWAY_PERIOD_X = 2.8;
export const SWAY_PERIOD_Y = 3.4;

export const BULLET_SPEED = 200;
export const GRAVITY = 1.6;
export const WIND_K = 0.22;
export const WIND_ANGLE_MAX = (18 * Math.PI) / 180;

export const START_OFFSET_WU_MIN = 28;
export const START_OFFSET_WU_MAX = 48;

export const FIRE_LOCK = 0.3;
export const REVEAL_TIME = 1.05;
export const FIXED_DT = 1 / 60;
export const MAX_DT = 0.05;
export const SHOT_COUNT = 5;
/** Extra shots after a perfect 5-for-5 (rim or better). Safety cap only. */
export const EXT_SHOT_CAP = 50;
export const EXT_DIST_MIN = 60;
export const EXT_DIST_MAX = 400;
/** Daily table tops out at 6.2 m/s; extension climbs toward this cap. */
export const EXT_WIND_MAX_START = 6.2;
export const EXT_WIND_MAX = 12;

export const CORE_R = 0.04;
export const GOOD_R = 0.12;
export const CLOSE_R = 0.22;
export const RIM_R = 0.4;
export const SCORE_CORE = 100;
export const SCORE_GOOD = 60;
export const SCORE_CLOSE = 30;
export const SCORE_RIM = 10;
export const SCORE_MISS = 0;

export const JUDGE_BALLOON_OFFSET = 70;

export const STORAGE_BEST = "kazeyomi-sniper:bestScore";
export const STORAGE_DAILY_PREFIX = "kazeyomi-sniper:daily:";
export const STORAGE_MUTED = "kazeyomi-sniper:muted";
export const SEED_PREFIX = "kazeyomi-sniper:";

export const SKINS = ["kami", "buriki", "tetsu"];

/** Wind-sock ticks: 1 for [0, 1.7), 2 for [1.7, 3.2), 3 for [3.2, 4.8), 4 for 4.8+. */
export const WIND_METER_BREAKS = [1.7, 3.2, 4.8, 8.0];

/**
 * Daily distances and wind-speed bands. Distances are the same every day;
 * only wind, start offset, sway phase, and skin change with the seed.
 */
export const SHOT_TABLE = [
  { distance: 50, windMin: 0.8, windMax: 2.4 },
  { distance: 85, windMin: 1.4, windMax: 3.2 },
  { distance: 125, windMin: 2.0, windMax: 4.2 },
  { distance: 175, windMin: 2.6, windMax: 5.2 },
  { distance: 230, windMin: 3.0, windMax: 6.2 },
];

export const GRADE_LABELS = {
  core: "どまんなか",
  good: "いいところ",
  close: "おしい",
  rim: "枠",
  miss: "はずれた",
};

export const GRADE_BALLOONS = {
  core: "どまんなか！",
  good: "いいところ",
  close: "おしい",
  rim: "枠",
  miss: "はずれた",
};

export const STREAK_CALLOUTS = {
  2: "連続！",
  3: "おみごと！",
  4: "すじがいい！",
  5: "5発どまんなか！",
};

/** Scope wu per target-plane meter at this distance. Angular FOV is constant. */
export function wuPerMeter(distance) {
  const d = Number(distance);
  if (!(d > 0)) return WU_PER_M_AT_REF;
  return WU_PER_M_AT_REF * (FOV_REF_DISTANCE / d);
}

export function wuToMeters(wu, distance) {
  return (Number(wu) || 0) / wuPerMeter(distance);
}

export function metersToWu(meters, distance) {
  return (Number(meters) || 0) * wuPerMeter(distance);
}

/** Sway offset on the screen, in wu, at aim-phase time phaseT. */
export function swayWu(phaseT, phiX, phiY) {
  const t = Number(phaseT) || 0;
  return {
    x: SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD_X + (Number(phiX) || 0)),
    y: SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD_Y + (Number(phiY) || 0)),
  };
}

export function swayMeters(phaseT, phiX, phiY, distance) {
  const sw = swayWu(phaseT, phiX, phiY);
  const k = wuPerMeter(distance);
  return { x: sw.x / k, y: sw.y / k };
}

/** Wind sock steps for a wind speed in m/s. Daily 5-shot bands still map to 1–4. */
export function windMeter(speed) {
  const s = Math.abs(Number(speed) || 0);
  if (s < WIND_METER_BREAKS[0]) return 1;
  if (s < WIND_METER_BREAKS[1]) return 2;
  if (s < WIND_METER_BREAKS[2]) return 3;
  if (s < WIND_METER_BREAKS[3]) return 4;
  return 5;
}

export function gradeForRadius(r) {
  const x = Math.abs(Number(r) || 0);
  if (x <= CORE_R) return "core";
  if (x <= GOOD_R) return "good";
  if (x <= CLOSE_R) return "close";
  if (x <= RIM_R) return "rim";
  return "miss";
}

export function pointsForGrade(grade) {
  if (grade === "core") return SCORE_CORE;
  if (grade === "good") return SCORE_GOOD;
  if (grade === "close") return SCORE_CLOSE;
  if (grade === "rim") return SCORE_RIM;
  return SCORE_MISS;
}

export function seedString(dateJst) {
  return SEED_PREFIX + dateJst;
}

export function dailyKey(dateJst) {
  return STORAGE_DAILY_PREFIX + dateJst;
}

export function calloutForStreak(streak) {
  return STREAK_CALLOUTS[streak] || null;
}
