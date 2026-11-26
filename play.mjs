/**
 * 入力、向き、rAF、画面遷移の配線。
 *
 * エンジンインタフェース（engine/sim.mjs）:
 *   createInitialState({ seed, dateJst, bestScore, todayBestScore })
 *     → status は "playing"。タイトルはこちらで "title" にする。
 *   tick(state, input, dt) → 新しい state（非破壊）。dt は秒。最大 50ms。内部で 1/60 に分割。
 *   quitRun(state) → 未発射の発は 0 点のまま終了。
 *   input は { aim: { active, dx, dy }, fire, landscape }。
 *     dx, dy はそのフレームのパッド移動（論理 wu）。感度はエンジン側。
 *     fire はそのフレームの立ち上がりだけ true。
 *     landscape が false なら、tick は照準も発射も時間進行もしない。
 *   tick は input を書き換えない。
 */
import { tick, createInitialState, quitRun } from "./engine/sim.mjs";
import { MAX_DT, SHOT_COUNT } from "./engine/constants.mjs";
import {
  drawScene,
  clientToLogical,
  inPad,
  inFire,
  currentShot,
} from "./render/draw.mjs";
import { createFx, resetFx, syncFx } from "./render/fx.mjs";
import { createSfx, resetSfx, syncSound, unlockSfx, setMuted } from "./render/sound.mjs";
import { bindScreens } from "./render/screens.mjs";
import {
  getJstDate,
  seedString,
  loadBests,
  saveBests,
  shareText,
  sharePageUrl,
  tweetShareUrl,
  lineShareUrl,
} from "./render/share.mjs";

const screens = bindScreens(document);
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });

const motionQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

function reducedMotion() {
  return !!motionQuery.matches;
}

function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}

const { dateJst, dateLabel } = getJstDate();
const seed = seedString(dateJst);

let stored = loadBests(dateJst);
let state = titleStateFrom(stored);
let ended = false;
let landscape = isLandscape();

let aimPointer = null;
let aimLastX = 0;
let aimLastY = 0;
let aimActive = false;
let aimDx = 0;
let aimDy = 0;
let cancelledAim = false;

let firePointer = null;
let fireHeld = false;
let firePulse = false;
let spaceHeld = false;

let lastTs = 0;
let lastShare = shareText({ dateLabel, score: 0 });
const fx = createFx();
const sfx = createSfx();
screens.setMuteUi(sfx.muted);
screens.setPortrait(!landscape);

function titleStateFrom(bests) {
  const playing = createInitialState({
    seed,
    dateJst,
    bestScore: bests.bestScore ?? 0,
    todayBestScore: bests.todayBestScore ?? 0,
  });
  return { ...playing, status: "title" };
}

function freshRun() {
  stored = loadBests(dateJst);
  ended = false;
  clearPointers();
  lastTs = 0;
  resetFx(fx);
  resetSfx(sfx);
  return createInitialState({
    seed,
    dateJst,
    bestScore: stored.bestScore ?? 0,
    todayBestScore: stored.todayBestScore ?? 0,
  });
}

function finishRun(next) {
  if (ended) {
    state = next;
    return;
  }
  ended = true;
  clearPointers();
  state = next.status === "over" ? next : { ...next, status: "over" };
  const saved = saveBests({ dateJst, score: state.score });
  stored = { bestScore: saved.bestScore, todayBestScore: saved.todayBestScore };
  lastShare = shareText({ dateLabel, score: state.score });
  const stats = state.stats || {};
  screens.showOver({
    score: state.score,
    todayBestScore: saved.todayBestScore,
    bestScore: saved.bestScore,
    isNewBest: saved.isNewBest,
    isNewTodayBest: saved.isNewTodayBest,
    core: stats.core ?? 0,
    grades: (state.shots || []).map((s) => s?.grade ?? null),
  });
}

function takeInput() {
  const input = {
    aim: { active: aimActive, dx: aimDx, dy: aimDy },
    fire: firePulse,
    landscape,
  };
  aimDx = 0;
  aimDy = 0;
  firePulse = false;
  return input;
}

function clearPointers() {
  aimPointer = null;
  aimActive = false;
  aimDx = 0;
  aimDy = 0;
  cancelledAim = false;
  firePointer = null;
  fireHeld = false;
  firePulse = false;
}

function paint() {
  drawScene(ctx, state, {
    reducedMotion: reducedMotion(),
    fx,
    aimActive,
    fireHeld: fireHeld || spaceHeld,
  });
  if (state.status === "playing") {
    const shot = currentShot(state);
    screens.updateHud({
      shotIndex: state.shotIndex ?? 0,
      shotCount: SHOT_COUNT,
      distance: shot?.distance,
      score: state.score,
    });
    screens.setHints(!!state.hintAim, !!state.hintFire);
  }
}

function frame(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(Math.max((ts - lastTs) / 1000, 0), MAX_DT);
  lastTs = ts;

  if (state.status === "playing") {
    const input = takeInput();
    const next = tick(state, input, dt);
    syncFx(fx, next, dt, { reducedMotion: reducedMotion() });
    syncSound(sfx, next);
    if (next.status === "over") {
      finishRun(next);
    } else {
      state = next;
    }
  } else {
    if (state.status !== "over") clearPointers();
    syncFx(fx, state, dt, { reducedMotion: reducedMotion() });
    syncSound(sfx, state);
  }

  paint();
  requestAnimationFrame(frame);
}

function startPlay() {
  if (!landscape) {
    screens.setPortrait(true);
    return;
  }
  state = freshRun();
  state = tick(state, { aim: { active: false, dx: 0, dy: 0 }, fire: false, landscape }, 0);
  screens.showPlay();
  const shot = currentShot(state);
  screens.updateHud({
    shotIndex: state.shotIndex ?? 0,
    shotCount: SHOT_COUNT,
    distance: shot?.distance,
    score: state.score ?? 0,
  });
  screens.setHints(state.hintAim !== false, state.hintFire !== false);
  paint();
}

function quitToOver() {
  if (state.status !== "playing") return;
  const next = quitRun(state);
  finishRun(next.status === "over" ? next : { ...next, status: "over" });
  paint();
}

function unlockAudio() {
  unlockSfx(sfx);
}

window.addEventListener("pointerdown", unlockAudio, { capture: true });
window.addEventListener("touchstart", unlockAudio, { capture: true });
window.addEventListener("keydown", unlockAudio);

screens.el.btnMute?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  unlockSfx(sfx);
  setMuted(sfx, !sfx.muted);
  screens.setMuteUi(sfx.muted);
});

screens.el.btnStart?.addEventListener("click", () => {
  unlockSfx(sfx);
  startPlay();
});

screens.el.btnRetry?.addEventListener("click", () => {
  unlockSfx(sfx);
  startPlay();
});

screens.el.btnQuit?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  quitToOver();
});

function currentShare() {
  return {
    text: lastShare,
    url: sharePageUrl(),
  };
}

function guardClick(fn) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  };
}

function openShareTab(href) {
  if (!href) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

screens.el.btnShareX?.addEventListener(
  "click",
  guardClick(() => {
    openShareTab(tweetShareUrl(currentShare()));
  }),
);

screens.el.btnShareLine?.addEventListener(
  "click",
  guardClick(() => {
    openShareTab(lineShareUrl(currentShare()));
  }),
);

function eventPoint(e) {
  return clientToLogical(canvas, e.clientX, e.clientY);
}

function maybeCapture(e) {
  if (e.pointerType && e.pointerType !== "touch") {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
}

function isHudTarget(e) {
  const t = e.target;
  if (!t || typeof t.closest !== "function") return false;
  return !!t.closest("#btn-mute, #btn-quit, #btn-start, #btn-retry, .share-btn, .panel, .portrait");
}

function pointerDown(e) {
  if (state.status !== "playing" || !landscape) return;
  if (isHudTarget(e)) return;
  const pt = eventPoint(e);
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;

  const canAim =
    aimPointer == null || (cancelledAim && e.pointerId !== aimPointer);
  if (canAim && inPad(pt.x, pt.y)) {
    cancelledAim = false;
    aimPointer = e.pointerId;
    aimLastX = pt.x;
    aimLastY = pt.y;
    aimActive = true;
    maybeCapture(e);
    if (e.cancelable) e.preventDefault();
    return;
  }

  if (firePointer == null && inFire(pt.x, pt.y)) {
    firePointer = e.pointerId;
    if (!fireHeld) firePulse = true;
    fireHeld = true;
    maybeCapture(e);
    if (e.cancelable) e.preventDefault();
  }
}

function pointerMove(e) {
  if (state.status !== "playing") return;
  if (e.pointerId === aimPointer) {
    if (e.cancelable) e.preventDefault();
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      const pt = eventPoint(e);
      if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        aimDx += pt.x - aimLastX;
        aimDy += pt.y - aimLastY;
        aimLastX = pt.x;
        aimLastY = pt.y;
      }
    }
  } else if (e.pointerId === firePointer) {
    if (e.cancelable) e.preventDefault();
  }
}

function endAimPointer(e, fromCancel) {
  if (e.pointerId !== aimPointer) return false;
  if (fromCancel) {
    cancelledAim = e.pointerType === "touch";
  } else {
    cancelledAim = false;
  }
  if (!fromCancel && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
    const pt = eventPoint(e);
    if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      aimDx += pt.x - aimLastX;
      aimDy += pt.y - aimLastY;
      aimLastX = pt.x;
      aimLastY = pt.y;
    }
  }
  aimPointer = null;
  aimActive = false;
  return true;
}

function endFirePointer(e) {
  if (e.pointerId !== firePointer) return false;
  firePointer = null;
  fireHeld = spaceHeld;
  return true;
}

function pointerUp(e) {
  const aim = endAimPointer(e, false);
  const fire = endFirePointer(e);
  if ((aim || fire) && e.cancelable) e.preventDefault();
}

function pointerCancel(e) {
  // パッドはなぞりを終えてねらいは残す（跳ねない）。発射は離した扱い。
  if (e.pointerId === aimPointer) {
    if (e.cancelable) e.preventDefault();
    endAimPointer(e, true);
    return;
  }
  if (e.pointerId === firePointer) {
    if (e.cancelable) e.preventDefault();
    endFirePointer(e);
  }
}

canvas.addEventListener("pointerdown", pointerDown, { passive: false });
window.addEventListener("pointermove", pointerMove, { passive: false });
window.addEventListener("pointerup", pointerUp, { passive: false });
window.addEventListener("pointercancel", pointerCancel, { passive: false });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "touchstart",
  (e) => {
    if (state.status === "playing" && e.cancelable) e.preventDefault();
  },
  { passive: false },
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (state.status === "playing" && e.cancelable) e.preventDefault();
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.repeat) {
    if (state.status === "playing") e.preventDefault();
    return;
  }
  if (state.status !== "playing" || !landscape) return;
  e.preventDefault();
  spaceHeld = true;
  if (!fireHeld) firePulse = true;
  fireHeld = true;
});

window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  spaceHeld = false;
  if (firePointer == null) fireHeld = false;
});

function applyOrientation() {
  const next = isLandscape();
  if (next === landscape) {
    screens.setPortrait(!next);
    return;
  }
  landscape = next;
  screens.setPortrait(!landscape);
  if (!landscape) {
    // Keep aim, drop in-progress pointers so a rotate doesn't leave a stuck hold.
    aimPointer = null;
    aimActive = false;
    firePointer = null;
    fireHeld = false;
    firePulse = false;
    spaceHeld = false;
  }
}

window.addEventListener("resize", applyOrientation);
window.addEventListener("orientationchange", applyOrientation);

screens.showTitle({ dateLabel, bestScore: stored.bestScore });
screens.updateHud({ shotIndex: 0, shotCount: SHOT_COUNT, distance: 50, score: 0 });
paint();
requestAnimationFrame(frame);
