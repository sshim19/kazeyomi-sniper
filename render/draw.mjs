/** 景色・旗・草・的・スコープ・十字・パッドとボタン。state の読み取りのみ。Y は下向き。 */

import {
  VIEW_W,
  VIEW_H,
  SCOPE_DIAMETER,
  FLAG_OFFSET_X,
  EXT_WIND_MAX,
  PAD_LEFT,
  PAD_RIGHT,
  PAD_TOP,
  PAD_BOTTOM,
  FIRE_BTN_X,
  FIRE_BTN_Y,
  FIRE_BTN_R,
  TARGET_RADIUS,
  CORE_R,
  GOOD_R,
  CLOSE_R,
  RIM_R,
  metersToWu,
  swayMeters,
  windMeter,
} from "../engine/constants.mjs";
import {
  GROUND_Y,
  bulletProgress,
  drawFlash,
  drawFx,
  kickBounceY,
  revealZoom,
  rgba,
  scopeZoom,
  shakeOffset,
} from "./fx.mjs";

export {
  VIEW_W,
  VIEW_H,
  PAD_LEFT,
  PAD_RIGHT,
  PAD_TOP,
  PAD_BOTTOM,
  FIRE_BTN_X,
  FIRE_BTN_Y,
  FIRE_BTN_R,
};

export const SCOPE_CX = VIEW_W / 2;
export const SCOPE_CY = VIEW_H / 2;
export const SCOPE_R = SCOPE_DIAMETER / 2;

const SKY_A = "#c5d8ea";
const SKY_B = "#e8d7b8";
const HILL_A = "#5c7a3a";
const HILL_B = "#7a9a4a";
const HILL_C = "#3f5a28";
const SCOPE_FRAME = "#1a1e22";
const SCOPE_BRASS = "#b08a4a";
const PAPER = "#f3eee3";
const INK = "#1c1c1c";
const TEXT = "#1c2430";
const HUD_CREAM = "#f5f0e6";
const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;

export function currentShot(state) {
  const shots = state?.shots || [];
  if (!shots.length) return null;
  const i = Math.max(0, Math.min(shots.length - 1, Math.floor(Number(state?.shotIndex) || 0)));
  return shots[i] || null;
}

export function lookPoint(state) {
  const shot = currentShot(state);
  const dist = shot?.distance || 125;
  const locked = state?.locked;
  if (locked && (state.phase === "flight" || state.phase === "reveal")) {
    return {
      x: (Number(locked.aimX) || 0) + (Number(locked.swayX) || 0),
      y: (Number(locked.aimY) || 0) + (Number(locked.swayY) || 0),
    };
  }
  const phiX = state?.swayPhiX ?? shot?.swayPhiX ?? 0;
  const phiY = state?.swayPhiY ?? shot?.swayPhiY ?? 0;
  const t = state?.phase === "aim" ? state.phaseT : 0;
  const sw = swayMeters(t, phiX, phiY, dist);
  return {
    x: (Number(state?.aimX) || 0) + sw.x,
    y: (Number(state?.aimY) || 0) + sw.y,
  };
}

export function inPad(x, y) {
  return x >= PAD_LEFT && x <= PAD_RIGHT && y >= PAD_TOP && y <= PAD_BOTTOM;
}

export function inFire(x, y) {
  return Math.hypot(x - FIRE_BTN_X, y - FIRE_BTN_Y) <= FIRE_BTN_R;
}

/**
 * キャンバスを CSS サイズ × DPR に合わせ、描画は CSS ピクセル座標で行う。
 * @returns {{ cssW: number, cssH: number, dpr: number }}
 */
export function syncCanvasSize(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = Math.max(1, canvas.clientWidth || VIEW_W);
  const cssH = Math.max(1, canvas.clientHeight || VIEW_H);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { cssW, cssH, dpr };
}

/**
 * 高さに合わせて 640×360 を伸ばし、幅が足りなければ contain する。
 * 余った部分は同じ空色で埋める。Y は下向き。
 */
export function makeView(cssW, cssH) {
  let scale = cssH / VIEW_H;
  if (VIEW_W * scale > cssW + 0.5) scale = cssW / VIEW_W;
  const drawW = VIEW_W * scale;
  const drawH = VIEW_H * scale;
  const ox = (cssW - drawW) / 2;
  const oy = (cssH - drawH) / 2;
  return {
    scale,
    ox,
    oy,
    drawW,
    drawH,
    cssW,
    cssH,
    sx(x) {
      return ox + x * scale;
    },
    sy(y) {
      return oy + y * scale;
    },
    px(wu) {
      return wu * scale;
    },
    worldX(cssX) {
      return (cssX - ox) / scale;
    },
    worldY(cssY) {
      return (cssY - oy) / scale;
    },
  };
}

/**
 * クライアント座標をキャンバス論理座標（0..640, 0..360, Y 下向き）へ。
 * @returns {{ x: number, y: number }}
 */
export function clientToLogical(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cssW = canvas.clientWidth || rect.width || VIEW_W;
  const cssH = canvas.clientHeight || rect.height || VIEW_H;
  const view = makeView(cssW, cssH);
  const cssX = ((clientX - rect.left) / (rect.width || 1)) * cssW;
  const cssY = ((clientY - rect.top) / (rect.height || 1)) * cssH;
  return { x: view.worldX(cssX), y: view.worldY(cssY) };
}

function fillSky(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY_A);
  g.addColorStop(1, SKY_B);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function u32(n) {
  return n >>> 0;
}

function mix(a, b) {
  let h = u32(a);
  h = Math.imul(h ^ u32(b), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return u32(h ^ (h >>> 16));
}

function rand01(h) {
  return u32(h) / 4294967296;
}

function makeCam(state, fx, reduced) {
  const shot = currentShot(state);
  const dist = shot?.distance || 125;
  const look = lookPoint(state);
  const zoom = scopeZoom(fx, reduced) * revealZoom(fx, reduced);
  const bounceY = kickBounceY(fx, reduced);
  const impactX = fx?.reveal?.impactX;
  const impactY = fx?.reveal?.impactY;
  let originX = SCOPE_CX;
  let originY = SCOPE_CY;
  if (fx?.reveal && Number.isFinite(impactX) && Number.isFinite(impactY)) {
    originX = SCOPE_CX + metersToWu(impactX - look.x, dist);
    originY = SCOPE_CY + metersToWu(impactY - look.y, dist);
  }
  return { dist, look, zoom, bounceY, originX, originY, shot };
}

function worldToScope(wx, wy, cam) {
  const ux = SCOPE_CX + metersToWu(wx - cam.look.x, cam.dist);
  const uy = SCOPE_CY + metersToWu(wy - cam.look.y, cam.dist);
  return {
    x: cam.originX + (ux - cam.originX) * cam.zoom,
    y: cam.originY + (uy - cam.originY) * cam.zoom + cam.bounceY,
  };
}

function drawHills(ctx, view, cam, seed) {
  const layers = [
    { color: "#6a8aa8", y: -2.8, amp: 0.55, k: 1 },
    { color: HILL_A, y: 0.15, amp: 0.7, k: 2 },
    { color: HILL_C, y: 0.85, amp: 0.5, k: 3 },
  ];
  for (const layer of layers) {
    ctx.beginPath();
    const left = worldToScope(-8, layer.y, cam);
    ctx.moveTo(view.sx(-40), view.sy(VIEW_H + 20));
    ctx.lineTo(view.sx(-40), view.sy(left.y));
    for (let i = 0; i <= 16; i++) {
      const wx = -8 + i * 1.1;
      const h = mix(seed, layer.k * 17 + i);
      const wy = layer.y - layer.amp * (0.35 + 0.65 * rand01(h));
      const p = worldToScope(wx, wy, cam);
      ctx.lineTo(view.sx(p.x), view.sy(p.y));
    }
    ctx.lineTo(view.sx(VIEW_W + 40), view.sy(VIEW_H + 20));
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
  }
}

function drawGrass(ctx, view, cam, windX, windY, time, seed) {
  const speed = Math.hypot(windX, windY);
  const dir = Math.sign(windX || 1);
  const lean = Math.min(0.9, speed / EXT_WIND_MAX) * dir;
  const flap = Math.sin(time * (3.2 + speed * 0.6));
  for (let i = 0; i < 42; i++) {
    const h = mix(seed, 400 + i * 19);
    const wx = -1.6 + rand01(h) * 3.4;
    const wy = GROUND_Y - 0.02 + rand01(mix(h, 3)) * 0.28;
    const tall = 0.16 + rand01(mix(h, 7)) * 0.22;
    const base = worldToScope(wx, wy, cam);
    const tip = worldToScope(
      wx + lean * tall * 0.7 + flap * 0.04 * dir * (0.5 + rand01(mix(h, 9))),
      wy - tall,
      cam,
    );
    ctx.strokeStyle = rand01(mix(h, 11)) > 0.5 ? HILL_B : HILL_C;
    ctx.lineWidth = Math.max(0.8, view.px(1.2));
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(view.sx(base.x), view.sy(base.y));
    ctx.quadraticCurveTo(
      view.sx((base.x + tip.x) / 2 + (tip.x - base.x) * 0.15),
      view.sy((base.y + tip.y) / 2),
      view.sx(tip.x),
      view.sy(tip.y),
    );
    ctx.stroke();
  }
}

function skinPalette(skin) {
  if (skin === "buriki") {
    return { fill: "#c9c3b4", dark: "#8a8370", ring: "#3a2a18", inner: "#d9d3c4" };
  }
  if (skin === "tetsu") {
    return { fill: "#4a4e52", dark: "#2c3034", ring: "#e8e0d0", inner: "#5a6066" };
  }
  return { fill: PAPER, dark: "#d4cbb8", ring: INK, inner: "#faf6ee" };
}

function drawStand(ctx, view, cam) {
  const feet = [
    worldToScope(-0.22, GROUND_Y, cam),
    worldToScope(0.22, GROUND_Y, cam),
  ];
  const tops = [
    worldToScope(-0.18, TARGET_RADIUS + 0.04, cam),
    worldToScope(0.18, TARGET_RADIUS + 0.04, cam),
  ];
  ctx.strokeStyle = "#6d4c32";
  ctx.lineWidth = Math.max(1.6, view.px(3));
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(view.sx(feet[i].x), view.sy(feet[i].y));
    ctx.lineTo(view.sx(tops[i].x), view.sy(tops[i].y));
    ctx.stroke();
  }
  const a = worldToScope(-0.28, TARGET_RADIUS + 0.05, cam);
  const b = worldToScope(0.28, TARGET_RADIUS + 0.05, cam);
  ctx.beginPath();
  ctx.moveTo(view.sx(a.x), view.sy(a.y));
  ctx.lineTo(view.sx(b.x), view.sy(b.y));
  ctx.stroke();
}

function drawTarget(ctx, view, cam, skin) {
  const pal = skinPalette(skin);
  const center = worldToScope(0, 0, cam);
  const cx = view.sx(center.x);
  const cy = view.sy(center.y);
  const r = (m) => Math.max(1, view.px(metersToWu(m, cam.dist) * cam.zoom));
  const rings = [
    { rad: TARGET_RADIUS, fill: pal.fill },
    { rad: CLOSE_R, fill: pal.inner },
    { rad: GOOD_R, fill: pal.fill },
    { rad: CORE_R, fill: pal.inner },
  ];
  ctx.save();
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, r(ring.rad), 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, view.px(1.2));
    ctx.strokeStyle = pal.ring;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r(RIM_R), 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.4, view.px(1.8));
  ctx.strokeStyle = pal.ring;
  ctx.stroke();
  ctx.restore();
}

function drawHole(ctx, view, cam, hole) {
  if (!hole) return;
  const p = worldToScope(hole.x, hole.y, cam);
  const on = hole.grade && hole.grade !== "miss";
  const rad = view.px(metersToWu(on ? 0.018 : 0.012, cam.dist) * cam.zoom);
  ctx.save();
  ctx.fillStyle = on ? "#1a1612" : "#3a3428";
  ctx.beginPath();
  ctx.arc(view.sx(p.x), view.sy(p.y), Math.max(1.2, rad), 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    ctx.strokeStyle = "rgba(245, 240, 230, 0.45)";
    ctx.lineWidth = Math.max(0.8, view.px(0.9));
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlag(ctx, view, cam, windX, windY, time) {
  const speed = Math.hypot(windX, windY);
  const level = windMeter(speed);
  const dir = Math.sign(windX || 1);
  const lift = [0.12, 0.4, 0.68, 0.9, 0.98][level - 1];
  const flap = Math.sin(time * (3 + level * 2.2)) * (0.05 + level * 0.03);
  const baseX = FLAG_OFFSET_X;
  const baseY = GROUND_Y;
  const topY = GROUND_Y - 1.05;
  const base = worldToScope(baseX, baseY, cam);
  const top = worldToScope(baseX, topY, cam);
  ctx.strokeStyle = "#6d4c32";
  ctx.lineWidth = Math.max(1.4, view.px(2.2));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(view.sx(base.x), view.sy(base.y));
  ctx.lineTo(view.sx(top.x), view.sy(top.y));
  ctx.stroke();

  const hoistY = topY + 0.08;
  const length = 0.42;
  const tipX = baseX + dir * length * (0.25 + 0.75 * lift);
  const tipY = hoistY + (1 - lift) * 0.38 + flap * 0.15;
  const midX = baseX + dir * length * (0.2 + 0.55 * lift);
  const midY = hoistY + (1 - lift) * 0.22 + Math.sin(time * (4 + level) + 1) * 0.06 * level * 0.08;
  const hoist = worldToScope(baseX, hoistY, cam);
  const hoist2 = worldToScope(baseX, hoistY + 0.28, cam);
  const mid = worldToScope(midX, midY, cam);
  const tip = worldToScope(tipX, tipY, cam);
  ctx.fillStyle = "#c45c2a";
  ctx.beginPath();
  ctx.moveTo(view.sx(hoist.x), view.sy(hoist.y));
  ctx.quadraticCurveTo(view.sx(mid.x), view.sy(mid.y), view.sx(tip.x), view.sy(tip.y));
  ctx.quadraticCurveTo(
    view.sx(mid.x),
    view.sy(worldToScope(midX, midY + 0.16, cam).y),
    view.sx(hoist2.x),
    view.sy(hoist2.y),
  );
  ctx.closePath();
  ctx.fill();
}

function drawBullet(ctx, view, cam, fx) {
  const b = bulletProgress(fx);
  if (!b) return;
  const p = b.p;
  const start = { x: cam.look.x, y: cam.look.y };
  const wx = start.x + (b.impactX - start.x) * p;
  const wy = start.y + (b.impactY - start.y) * p;
  const now = worldToScope(wx, wy, cam);
  const prevP = Math.max(0, p - (b.dur < 0.45 ? 0.32 : 0.18));
  const px = start.x + (b.impactX - start.x) * prevP;
  const py = start.y + (b.impactY - start.y) * prevP;
  const prev = worldToScope(px, py, cam);
  ctx.save();
  ctx.strokeStyle = rgba("#f5f0e6", 0.92);
  ctx.lineWidth = Math.max(1.6, view.px((b.dur < 0.45 ? 3.2 : 2.2) * (0.55 + 0.45 * p)));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(view.sx(prev.x), view.sy(prev.y));
  ctx.lineTo(view.sx(now.x), view.sy(now.y));
  ctx.stroke();
  ctx.fillStyle = "#f5f0e6";
  ctx.beginPath();
  ctx.arc(view.sx(now.x), view.sy(now.y), Math.max(1.8, view.px(b.dur < 0.45 ? 3.2 : 2.4)), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScopeBody(ctx, view) {
  ctx.fillStyle = SCOPE_FRAME;
  ctx.fillRect(view.sx(0), view.sy(0), view.px(VIEW_W), view.px(VIEW_H));
}

function drawScopeRim(ctx, view) {
  const cx = view.sx(SCOPE_CX);
  const cy = view.sy(SCOPE_CY);
  const r = view.px(SCOPE_R);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + view.px(10), 0, Math.PI * 2);
  ctx.strokeStyle = SCOPE_FRAME;
  ctx.lineWidth = view.px(20);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + view.px(2), 0, Math.PI * 2);
  ctx.strokeStyle = SCOPE_BRASS;
  ctx.lineWidth = view.px(4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - view.px(1.5), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(245, 240, 230, 0.18)";
  ctx.lineWidth = view.px(2);
  ctx.stroke();
  ctx.restore();
}

function drawCrosshair(ctx, view, cam) {
  const cx = view.sx(SCOPE_CX);
  const cy = view.sy(SCOPE_CY);
  const r = view.px(SCOPE_R - 8);
  ctx.save();
  ctx.strokeStyle = rgba(TEXT, 0.92);
  ctx.lineWidth = Math.max(1, view.px(1.2));
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  const step = metersToWu(0.2, cam.dist) * cam.zoom;
  if (step >= 4) {
    const ticks = Math.min(8, Math.floor((SCOPE_R - 16) / step));
    ctx.lineWidth = Math.max(1, view.px(1));
    for (let i = 1; i <= ticks; i++) {
      const d = view.px(step * i);
      const len = view.px(i % 5 === 0 ? 8 : 5);
      ctx.beginPath();
      ctx.moveTo(cx + d, cy - len);
      ctx.lineTo(cx + d, cy + len);
      ctx.moveTo(cx - d, cy - len);
      ctx.lineTo(cx - d, cy + len);
      ctx.moveTo(cx - len, cy + d);
      ctx.lineTo(cx + len, cy + d);
      ctx.moveTo(cx - len, cy - d);
      ctx.lineTo(cx + len, cy - d);
      ctx.stroke();
    }
  }
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.2, view.px(1.6)), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundHud(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Always-visible wind cue in the right-hand frame (outside the lens).
 * The in-world flag sits 1.15m to the right of the target, so at 50m it
 * falls outside the scope; this HUD plus foreground grass cover every shot.
 * No m/s numbers: a sock, a direction chevron, and a 4-step meter.
 */
function drawWindsock(ctx, view, windX, windY, time) {
  const speed = Math.hypot(windX, windY);
  const level = windMeter(speed);
  const dir = Math.sign(windX || 1);
  const lift = [0.22, 0.5, 0.74, 0.94, 1][level - 1];
  const t = Number(time) || 0;
  const flap = Math.sin(t * (3 + level * 2.1)) * (0.05 + level * 0.035);

  const cx = view.sx(SCOPE_CX + SCOPE_R + 68);
  const cy = view.sy(96);
  const w = view.px(112);
  const h = view.px(58);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = rgba(HUD_CREAM, 0.92);
  ctx.strokeStyle = rgba(TEXT, 0.72);
  ctx.lineWidth = Math.max(1, view.px(1.2));
  roundHud(ctx, -w / 2, -h / 2, w, h, view.px(8));
  ctx.fill();
  ctx.stroke();

  // Pole sits on the windward side so the sock has room to blow downwind.
  const poleX = dir > 0 ? -w * 0.18 : w * 0.18;
  const poleTop = -h * 0.38;
  const poleBot = view.px(4);
  ctx.strokeStyle = "#6d4c32";
  ctx.lineWidth = Math.max(1.6, view.px(2.4));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(poleX, poleBot);
  ctx.lineTo(poleX, poleTop);
  ctx.stroke();

  const length = view.px(20 + lift * 22);
  const hang = (1 - lift) * view.px(14);
  const tipX = poleX + dir * length;
  const tipY = poleTop + hang + flap * view.px(6);
  const midX = poleX + dir * length * 0.55;
  const midY = poleTop + hang * 0.5 + Math.sin(t * (4 + level) + 0.8) * view.px(3);
  ctx.fillStyle = "#c45c2a";
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop + view.px(1));
  ctx.quadraticCurveTo(midX, midY, tipX, tipY);
  ctx.quadraticCurveTo(midX, midY + view.px(10), poleX, poleTop + view.px(12));
  ctx.closePath();
  ctx.fill();

  // Lower row: a clear direction chevron and a 4-step meter (no numbers).
  const rowY = h / 2 - view.px(16);
  const tip = -w * 0.08 + dir * view.px(16);
  const tail = -w * 0.08 - dir * view.px(14);
  ctx.strokeStyle = TEXT;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = Math.max(1.4, view.px(2));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tail, rowY);
  ctx.lineTo(tip - dir * view.px(6), rowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip, rowY);
  ctx.lineTo(tip - dir * view.px(9), rowY - view.px(5.5));
  ctx.lineTo(tip - dir * view.px(9), rowY + view.px(5.5));
  ctx.closePath();
  ctx.fill();

  const gap = view.px(3.5);
  const bw = view.px(6);
  const heights = [view.px(7), view.px(10), view.px(13), view.px(16), view.px(19)];
  const total = 5 * bw + 4 * gap;
  let bx = w / 2 - view.px(9) - total;
  const base = h / 2 - view.px(6);
  for (let i = 1; i <= 5; i++) {
    const bh = heights[i - 1];
    ctx.fillStyle = i <= level ? "#6b3a10" : rgba(TEXT, 0.18);
    ctx.fillRect(bx, base - bh, bw, bh);
    bx += bw + gap;
  }
  ctx.restore();
}

/** 手前の草。的面ではなくスコープ下端に常に置き、風と同じ向きへなびく。 */
function drawForegroundGrass(ctx, view, windX, windY, time) {
  const speed = Math.hypot(windX, windY);
  const dir = Math.sign(windX || 1);
  const lean = Math.min(0.9, speed / EXT_WIND_MAX) * dir;
  const flap = Math.sin((Number(time) || 0) * (3.2 + speed * 0.6));
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 28; i++) {
    const hsh = mix(0x51a55, 900 + i * 23);
    const t = 0.08 + rand01(hsh) * 0.84;
    const x = SCOPE_CX - 118 + t * 236;
    const dx = x - SCOPE_CX;
    const inside = SCOPE_R * SCOPE_R - dx * dx;
    if (inside <= 16) continue;
    const maxY = SCOPE_CY + Math.sqrt(inside) - 2;
    const y = maxY - rand01(mix(hsh, 3)) * 9;
    const tall = 15 + rand01(mix(hsh, 7)) * 20;
    const tipX = x + lean * tall * 0.55 + flap * 3.4 * dir * (0.4 + rand01(mix(hsh, 9)));
    const tipY = y - tall;
    ctx.strokeStyle = rand01(mix(hsh, 11)) > 0.5 ? HILL_B : "#2e481c";
    ctx.lineWidth = Math.max(1, view.px(1.6 + rand01(mix(hsh, 13))));
    ctx.beginPath();
    ctx.moveTo(view.sx(x), view.sy(y));
    ctx.quadraticCurveTo(
      view.sx((x + tipX) / 2 + (tipX - x) * 0.12),
      view.sy((y + tipY) / 2),
      view.sx(tipX),
      view.sy(tipY),
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawPad(ctx, view, active) {
  const x = view.sx(PAD_LEFT + 10);
  const y = view.sy(PAD_TOP + 8);
  const w = view.px(PAD_RIGHT - PAD_LEFT - 28);
  const h = view.px(PAD_BOTTOM - PAD_TOP - 22);
  ctx.save();
  ctx.fillStyle = rgba("#1a1e22", active ? 0.22 : 0.14);
  ctx.strokeStyle = rgba(HUD_CREAM, active ? 0.28 : 0.16);
  ctx.lineWidth = Math.max(1, view.px(1.2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, view.px(14));
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFireButton(ctx, view, held) {
  const c = { x: view.sx(FIRE_BTN_X), y: view.sy(FIRE_BTN_Y) };
  const r = view.px(FIRE_BTN_R);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.x, c.y + view.px(held ? 2 : 0), r, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(c.x, c.y - r, c.x, c.y + r);
  g.addColorStop(0, held ? "#8a6a32" : "#c4a264");
  g.addColorStop(1, held ? "#5c4520" : "#8a6a32");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = view.px(3);
  ctx.strokeStyle = SCOPE_BRASS;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, c.y + view.px(held ? 2 : 0), r - view.px(6), 0, Math.PI * 2);
  ctx.strokeStyle = rgba(SCOPE_FRAME, 0.55);
  ctx.lineWidth = view.px(2);
  ctx.stroke();
  ctx.fillStyle = HUD_CREAM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(14, view.px(18))}px ${FONT}`;
  ctx.fillText("打つ", c.x, c.y + view.px(held ? 2 : 0));
  ctx.restore();
}

function hashSeed(state) {
  const raw = state?.seed;
  if (typeof raw === "number" && Number.isFinite(raw)) return u32(raw);
  const s = String(raw || "kazeyomi-sniper");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return u32(h);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {{ reducedMotion?: boolean, fx?: object, aimActive?: boolean, fireHeld?: boolean }} [opts]
 */
export function drawScene(ctx, state, opts = {}) {
  const canvas = ctx.canvas;
  const { cssW, cssH, dpr } = syncCanvasSize(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fillSky(ctx, cssW, cssH);

  const view = makeView(cssW, cssH);
  const reduced = !!opts.reducedMotion;
  const fx = opts.fx;
  const shot = currentShot(state);
  const cam = makeCam(state, fx, reduced);
  const shake = reduced ? { x: 0, y: 0 } : shakeOffset(fx);
  const seed = hashSeed(state);
  const windX = Number(shot?.windX) || 0;
  const windY = Number(shot?.windY) || 0;
  const time = fx?.clock || 0;

  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawScopeBody(ctx, view);

  // World inside the lens.
  ctx.save();
  ctx.beginPath();
  ctx.arc(view.sx(SCOPE_CX), view.sy(SCOPE_CY), view.px(SCOPE_R), 0, Math.PI * 2);
  ctx.clip();
  fillSky(ctx, cssW, cssH);
  drawHills(ctx, view, cam, seed);
  const groundL = worldToScope(-6, GROUND_Y, cam);
  const groundR = worldToScope(6, GROUND_Y, cam);
  ctx.fillStyle = HILL_B;
  ctx.beginPath();
  ctx.moveTo(view.sx(-40), view.sy(groundL.y));
  ctx.lineTo(view.sx(VIEW_W + 40), view.sy(groundR.y));
  ctx.lineTo(view.sx(VIEW_W + 40), view.sy(VIEW_H + 40));
  ctx.lineTo(view.sx(-40), view.sy(VIEW_H + 40));
  ctx.closePath();
  ctx.fill();
  drawStand(ctx, view, cam);
  drawTarget(ctx, view, cam, shot?.skin || "kami");
  drawFlag(ctx, view, cam, windX, windY, time);
  drawGrass(ctx, view, cam, windX, windY, time, seed);
  drawForegroundGrass(ctx, view, windX, windY, time);
  drawHole(ctx, view, cam, fx?.hole);
  drawBullet(ctx, view, cam, fx);
  const worldToViewCss = (wx, wy) => {
    const p = worldToScope(wx, wy, cam);
    return { x: view.sx(p.x), y: view.sy(p.y) };
  };
  const fxView = {
    worldToView: worldToViewCss,
    px: (wu) => view.px(wu),
    metersToPx: (m) => view.px(metersToWu(m, cam.dist) * cam.zoom),
    targetRimWu: metersToWu(TARGET_RADIUS, cam.dist) * cam.zoom,
    reducedMotion: reduced,
  };
  drawFx(ctx, fx, { ...fxView, layer: "world" });
  ctx.restore();

  drawScopeRim(ctx, view);
  drawCrosshair(ctx, view, cam);

  if (state?.status === "playing") {
    drawWindsock(ctx, view, windX, windY, time);
    drawFx(ctx, fx, { ...fxView, layer: "floats" });
    drawPad(ctx, view, !!opts.aimActive);
    drawFireButton(ctx, view, !!opts.fireHeld);
  }

  ctx.restore();
  drawFlash(ctx, cssW, cssH, fx);
}
