import { PlaybackSpeed } from "../shared/defaults.js";

const isTop = window === window.top;
const OWN_WRITE_MS = 800;
// Hold a Slower/Faster hotkey this long before the smooth hundredths ramp
// starts. The initial press always applies one exact step immediately.
const HOLD_RAMP_DELAY_MS = 400;
// Ramp travel while held, in rate units per second (scaled by step size).
const HOLD_RAMP_MIN_PER_SECOND = 0.8;
const HOLD_RAMP_STEP_DIVISOR = 0.09;
const HOST_STYLE = {
  all: "initial",
  position: "fixed",
  inset: "auto",
  bottom: "auto",
  left: "auto",
  margin: "0",
  border: "none",
  padding: "0",
  background: "transparent",
  color: "inherit",
  "z-index": "2147483647",
  "pointer-events": "none",
  opacity: "1",
  visibility: "visible",
  display: "block",
  transform: "none",
  filter: "none",
  animation: "none",
  clip: "auto",
  "clip-path": "none",
  overflow: "visible",
  contain: "none",
  isolation: "auto",
  "box-sizing": "content-box",
  "min-width": "0",
  "min-height": "0",
  "max-width": "none"
};
const FULLSCREEN_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange"
];
const NESTED_FRAME_TAGS = new Set(["iframe", "frame", "object", "embed"]);
const VOID_HOST_TAGS = new Set([
  "iframe",
  "frame",
  "embed",
  "object",
  "input",
  "br",
  "hr",
  "source",
  "track",
  "col",
  "wbr",
  "area",
  "base",
  "link",
  "meta",
  "param",
  "img"
]);
const HOST_STYLE_NAMES = new Set([
  ...Object.keys(HOST_STYLE),
  "top",
  "right",
  "width",
  "height",
  "max-height",
  "--ps-scale"
]);

const media = new Set();

let started = false;
let announced = false;
let mediaAnnouncement = null;
let mediaReannounce = false;
let controllerGeneration = 0;
let tornDown = false;

let settings = PlaybackSpeed.mergeSettings(null);
let speed = PlaybackSpeed.DEFAULT_RATE;
let scope = "global";
let hostname = "";
let tabId = null;
let panelOpen = false;
let settingsOpen = false;
let recording = null;
let recordingKeys = [];
let recordingHeld = new Set();
let pressedKeys = new Set();
let suppressHotkeys = false;
let dragging = false;
let persistTimer = 0;
let appearanceDragging = false;
let appearanceSliderEl = null;
let appearancePointerId = null;
let lastActionToggle = 0;
let lastPanelOpenAt = 0;
let toastTimer = 0;
let speedUiAnim = 0;
let visualRate = PlaybackSpeed.DEFAULT_RATE;
let visualVel = 0;
let visualTarget = PlaybackSpeed.DEFAULT_RATE;
let visualAnimStamp = 0;
let sliderGesture = null;
let speedHold = null;
let visualHold = false;
let writingSpeedUi = false;
let overlayScrollTarget = 0;
let overlayScrollAnim = 0;
let nativeSyncTimer = 0;
let nativeSyncAttempts = 0;
let overlayCssText = "";
let overlayCssWait = null;

let host = null;
let shadow = null;
let els = {};
let overlayOutsideBound = false;
let overlayWheelBound = false;
let activeStepperStop = null;

let applying = false;
let lastOwnWriteAt = 0;
let mediaObserver = null;
let hostStyleObserver = null;
let idleHooks = null;
let uiHold = false;
let tabHasMedia = false;
let runtimeKeysBound = false;
let sessionEventsBound = false;
let uiEventsBound = false;
let fullscreenMode = null;
let onDisplayMode = null;
let paused = false;
let powerBusy = false;
let powerRaf = 0;
let powerGlyph = null;

function nowMs() {
  return performance.now();
}

function runtimeOk() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

async function send(message) {
  if (!runtimeOk()) return { error: "disconnected" };
  try {
    return await chrome.runtime.sendMessage({
      ...message,
      hasMedia: paused ? false : presentMediaCount() > 0
    });
  } catch {
    return { error: "disconnected" };
  }
}

function isEditableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = String(el.type || "text").toLowerCase();
  return type !== "button" && type !== "submit" && type !== "reset" &&
    type !== "checkbox" && type !== "radio" && type !== "file" &&
    type !== "color" && type !== "range" && type !== "hidden" &&
    type !== "image";
}

function isTypingTarget(event) {
  if (isEditableElement(shadow && shadow.activeElement)) return true;
  if (isEditableElement(document.activeElement)) return true;
  const path = event && typeof event.composedPath === "function"
    ? event.composedPath()
    : [event && event.target];
  for (let i = 0; i < path.length; i++) {
    if (isEditableElement(path[i])) return true;
  }
  return false;
}

function eventKey(event) {
  return PlaybackSpeed.normalizeKey(event.key);
}

function usableKey(key) {
  return Boolean(key) && key !== "unidentified" && key !== "dead" && key !== "process";
}

function comboMatchesPressed(combo) {
  const keys = PlaybackSpeed.comboKeys(combo);
  if (!keys.length) return false;
  if (!keys.every((key) => pressedKeys.has(key))) return false;
  const mods = ["ctrl", "alt", "shift", "meta"];
  for (const key of pressedKeys) {
    if (mods.includes(key) && !keys.includes(key)) return false;
  }
  return true;
}

function comboMatchesEvent(combo, event) {
  const keys = PlaybackSpeed.comboKeys(combo);
  if (!keys.length) return false;
  const key = eventKey(event);
  if (keys.length === 1) {
    if (keys[0] !== key) return false;
    if (keys[0] === "ctrl" || keys[0] === "alt" || keys[0] === "shift" || keys[0] === "meta") {
      return comboMatchesPressed(combo);
    }
    return !event.ctrlKey && !event.altKey && !event.metaKey;
  }
  return comboMatchesPressed(combo);
}

function presetCombo(preset) {
  return { keys: PlaybackSpeed.canonicalKeys(preset && preset.keys) };
}

function getSlotCombo(id) {
  if (id === "toggle") return settings.toggleCombo;
  if (id === "downOpen") return settings.speedDownOpen;
  if (id === "upOpen") return settings.speedUpOpen;
  if (id === "downClosed") return settings.speedDownClosed;
  if (id === "upClosed") return settings.speedUpClosed;
  if (String(id).startsWith("preset:")) {
    const preset = settings.presets.find((p) => p.id === String(id).slice(7));
    return presetCombo(preset);
  }
  return PlaybackSpeed.emptyCombo();
}

function setSlotCombo(id, combo) {
  const next = PlaybackSpeed.asCombo(combo, "");
  if (id === "toggle") settings.toggleCombo = next;
  else if (id === "downOpen") settings.speedDownOpen = next;
  else if (id === "upOpen") settings.speedUpOpen = next;
  else if (id === "downClosed") settings.speedDownClosed = next;
  else if (id === "upClosed") settings.speedUpClosed = next;
  else if (String(id).startsWith("preset:")) {
    const preset = settings.presets.find((p) => p.id === String(id).slice(7));
    if (preset) preset.keys = next.keys.slice();
  }
}

function stealCombo(combo, ownerId) {
  const signature = PlaybackSpeed.comboSignature(combo);
  if (!signature) return;
  const slots = ["toggle", "downOpen", "upOpen", "downClosed", "upClosed"];
  for (const slot of slots) {
    if (slot === ownerId) continue;
    if (PlaybackSpeed.comboSignature(getSlotCombo(slot)) === signature) {
      setSlotCombo(slot, PlaybackSpeed.emptyCombo());
    }
  }
  for (const preset of settings.presets) {
    const recId = "preset:" + preset.id;
    if (recId === ownerId) continue;
    if (PlaybackSpeed.comboSignature(presetCombo(preset)) === signature) {
      preset.keys = [];
    }
  }
}

function consume(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function overlayHasKeyboardFocus() {
  return Boolean(shadow && shadow.activeElement);
}

function isOverlayTypingTarget() {
  return isEditableElement(shadow && shadow.activeElement);
}

// Closed shadow retargets keys onto the overlay host, so the page never sees
// an INPUT. Sites like YouTube then treat 0-9 as seek. Stop the event from
// reaching the page, but do not preventDefault: that blocks typing in the field.
function isolateOverlayKeyFromPage(event) {
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function onOverlayPageKeyShield(event) {
  if (!event.isTrusted) return;
  if (recording) return;
  if (!isOverlayTypingTarget() && !overlayHasKeyboardFocus()) return;
  isolateOverlayKeyFromPage(event);
}

function bindOverlayPageKeyShield(target) {
  if (!target) return;
  target.addEventListener("keydown", onOverlayPageKeyShield, false);
  target.addEventListener("keyup", onOverlayPageKeyShield, false);
  target.addEventListener("keypress", onOverlayPageKeyShield, false);
}

function isMediaElement(el) {
  return Boolean(
    el &&
    el.nodeType === 1 &&
    (el.tagName === "VIDEO" || el.tagName === "AUDIO") &&
    el.isConnected
  );
}

function hasMediaSource(el) {
  if (!isMediaElement(el)) return false;
  if (el.srcObject || el.currentSrc) return true;
  if (el.getAttribute("src")) return true;
  if (typeof el.querySelector === "function" && el.querySelector("source[src]")) return true;
  if (el.readyState > 0) return true;
  return false;
}

function isLoadedMedia(el) {
  return Boolean(isMediaElement(el) && (el.currentSrc || el.srcObject));
}

function isPresentMedia(el) {
  return hasMediaSource(el);
}

function presentMediaCount() {
  let n = 0;
  for (const el of media) {
    if (isPresentMedia(el)) n += 1;
    else media.delete(el);
  }
  return n;
}

function dropDetachedMedia() {
  for (const el of media) {
    if (!isPresentMedia(el)) media.delete(el);
  }
}

function preservePitch(el) {
  try {
    if ("preservesPitch" in el) el.preservesPitch = true;
  } catch {
    /* ignore */
  }
  try {
    if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = true;
  } catch {
    /* ignore */
  }
  try {
    if ("mozPreservesPitch" in el) el.mozPreservesPitch = true;
  } catch {
    /* ignore */
  }
}

function markOwnWrite() {
  lastOwnWriteAt = nowMs();
}

function ownWriteCooldown() {
  return nowMs() - lastOwnWriteAt < OWN_WRITE_MS;
}

function applyTo(el) {
  if (paused) return;
  if (!isMediaElement(el)) return;
  if (!el.isConnected) {
    media.delete(el);
    return;
  }
  if (!isLoadedMedia(el)) return;
  preservePitch(el);
  applying = true;
  markOwnWrite();
  try {
    el.playbackRate = speed;
  } catch {
    /* ignore */
  } finally {
    applying = false;
  }
}

function applyAll() {
  dropDetachedMedia();
  for (const el of media) applyTo(el);
}

function isOverlayEvent(event) {
  if (!host) return false;
  const path = event && typeof event.composedPath === "function"
    ? event.composedPath()
    : [event && event.target];
  for (let i = 0; i < path.length && i < 24; i++) {
    if (path[i] === host) return true;
  }
  return false;
}

function isStrictNativeHost() {
  const h = String(location.hostname || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return (
    h === "youtube.com" ||
    h.endsWith(".youtube.com") ||
    h === "youtu.be" ||
    h === "youtube-nocookie.com" ||
    h.endsWith(".youtube-nocookie.com") ||
    h === "vimeo.com" ||
    h.endsWith(".vimeo.com") ||
    h === "twitch.tv" ||
    h.endsWith(".twitch.tv")
  );
}

function findPlayerApi(el) {
  let node = el && el.parentElement;
  for (let i = 0; i < 14 && node; i++) {
    if (typeof node.setPlaybackRate === "function") return node;
    node = node.parentElement;
  }
  return null;
}

function youtubePlayers() {
  return document.querySelectorAll(
    "#movie_player, #shorts-player, .html5-video-player, ytmusic-player"
  );
}

function rateIsAvailable(player, rate) {
  if (typeof player.getAvailablePlaybackRates === "function") {
    try {
      const list = player.getAvailablePlaybackRates();
      if (Array.isArray(list) && list.length) {
        return list.some((r) => Math.abs(Number(r) - rate) < 0.001);
      }
    } catch {
      /* fall through */
    }
  }
  return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].some((r) => Math.abs(r - rate) < 0.001);
}

function syncPlayerApis(rate) {
  const seen = new Set();
  const tryPlayer = (player) => {
    if (!player || seen.has(player)) return;
    if (typeof player.setPlaybackRate !== "function") return;
    seen.add(player);
    if (!rateIsAvailable(player, rate)) return;
    try {
      markOwnWrite();
      player.setPlaybackRate(rate);
    } catch {
      /* native API rejected an unsupported rate */
    }
  };
  const listed = youtubePlayers();
  for (let i = 0; i < listed.length; i++) tryPlayer(listed[i]);
  for (const el of media) tryPlayer(findPlayerApi(el));
}

function scheduleNativeSync() {
  if (paused || !isStrictNativeHost()) return;
  if (presentMediaCount() === 0) return;
  const next = PlaybackSpeed.clampRate(speed);
  syncPlayerApis(next);
  nativeSyncAttempts = 0;
  clearTimeout(nativeSyncTimer);
  const tick = () => {
    nativeSyncAttempts += 1;
    syncPlayerApis(PlaybackSpeed.clampRate(speed));
    if (nativeSyncAttempts < 3) nativeSyncTimer = setTimeout(tick, 280);
    else nativeSyncTimer = 0;
  };
  nativeSyncTimer = setTimeout(tick, 180);
}

async function announceMedia() {
  if (paused || tornDown || presentMediaCount() === 0) return;
  if (mediaAnnouncement) {
    if (!announced) mediaReannounce = true;
    return mediaAnnouncement;
  }
  const generation = controllerGeneration;
  // Mark the request before yielding so teardown can enqueue a matching retraction.
  announced = true;
  const pending = send({ type: "MEDIA_IN_TAB" }).then((state) => {
    if (generation !== controllerGeneration) return;
    if (!state || state.error) {
      announced = false;
      return;
    }
    if (paused || tornDown || presentMediaCount() === 0) return;
    if (state.tabId != null) tabId = state.tabId;
    if (state.hostname) hostname = state.hostname;
  }).finally(() => {
    if (mediaAnnouncement !== pending) return;
    mediaAnnouncement = null;
    const retry = mediaReannounce;
    mediaReannounce = false;
    if (retry && !announced && !paused && !tornDown && presentMediaCount() > 0) {
      announceMedia().catch(() => {});
    }
  });
  mediaAnnouncement = pending;
  return pending;
}

async function retractMedia() {
  if (!announced) return;
  announced = false;
  await send({ type: "MEDIA_GONE" });
}

function releaseTrackedMedia() {
  stopSpeedHold();
  clearTimeout(nativeSyncTimer);
  nativeSyncTimer = 0;
  applying = true;
  markOwnWrite();
  try {
    for (const el of media) {
      if (!isMediaElement(el) || !el.isConnected) continue;
      try {
        el.playbackRate = 1;
      } catch {
        /* ignore */
      }
    }
    if (isStrictNativeHost()) syncPlayerApis(1);
  } finally {
    applying = false;
  }
  media.clear();
  tabHasMedia = false;
  retractMedia().catch(() => {});
}

function applyPausedState(next, { animate = false } = {}) {
  const value = next === true;
  if (paused === value) {
    if (!powerBusy) syncPowerButton({ animate: false });
    return;
  }
  paused = value;
  if (paused) {
    stopSpeedHold();
    sliderGesture = null;
    dragging = false;
    releaseTrackedMedia();
    stopWatchingMediaEvents();
    if (!host && mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
  } else {
    watchMediaEvents();
    startMediaObserver();
    discover(document);
    applyAll();
    scheduleNativeSync();
    if (presentMediaCount() > 0) announceMedia().catch(() => {});
  }
  syncPowerButton({ animate });
  if (paused) {
    queueMicrotask(() => {
      if (paused && !tornDown) maybeIdle();
    });
  }
}

function track(el) {
  if (paused || !isPresentMedia(el)) return false;
  const added = !media.has(el);
  media.add(el);
  applyTo(el);
  if (!announced) announceMedia().catch(() => {});
  return added;
}

function discover(root) {
  if (paused || !root) return;
  if (root.tagName === "VIDEO" || root.tagName === "AUDIO") {
    track(root);
    return;
  }
  if (!root.querySelectorAll) return;
  const list = root.querySelectorAll("video, audio");
  for (let i = 0; i < list.length; i++) track(list[i]);
  if (root.shadowRoot) discover(root.shadowRoot);
}

function untrackRemoved(root) {
  if (!root) return false;
  let changed = media.delete(root);
  if (!root.querySelectorAll) return changed;
  const list = root.querySelectorAll("video, audio");
  for (let i = 0; i < list.length; i++) {
    if (media.delete(list[i])) changed = true;
  }
  return changed;
}

function afterMediaChange() {
  dropDetachedMedia();
  if (presentMediaCount() === 0) {
    retractMedia().catch(() => {});
    maybeIdle();
  } else if (!announced) announceMedia().catch(() => {});
}

function markChips() {
  if (!els.presets) return;
  const chips = els.presets.querySelectorAll(".ps-chip");
  for (let i = 0; i < chips.length; i++) {
    const value = Number(chips[i].dataset.speed);
    chips[i].setAttribute(
      "aria-pressed",
      Math.abs(value - speed) < 0.001 ? "true" : "false"
    );
  }
}

function cancelSpeedUiAnim() {
  if (!speedUiAnim) return;
  cancelAnimationFrame(speedUiAnim);
  speedUiAnim = 0;
  visualAnimStamp = 0;
}

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const POWER_RED = "#f87171";
const POWER_BLUE = "#60a5fa";
const POWER_GREEN = "#4ade80";
const POWER_CANVAS = 96;

function powerBootColor(i) {
  return hash32(i + 91) % 3 === 0 ? POWER_BLUE : POWER_GREEN;
}

function hash32(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function ensurePowerGlyph() {
  if (powerGlyph && powerGlyph.cells.length) return powerGlyph;
  const size = POWER_CANVAS;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Draw the exact same power-icon geometry as the visible SVG and the CSS
  // mask so the pixel cells line up with the outline (no double-edge /
  // rectangle distortion when the animation canvas is composited).
  const scale = size / 24;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.15;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D("M12 4.1v7.15"));
  ctx.stroke(new Path2D("M8.12 7.38a5.88 5.88 0 1 0 7.76 0"));
  ctx.restore();
  const data = ctx.getImageData(0, 0, size, size).data;
  const cell = 8;
  const cells = [];
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      let hits = 0;
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= size || py >= size) continue;
          if (data[(py * size + px) * 4 + 3] > 40) hits += 1;
        }
      }
      if (hits > cell) {
        const nx = (x + cell / 2) / size;
        const ny = (y + cell / 2) / size;
        cells.push({
          x: x + 0.6,
          y: y + 0.6,
          w: Math.min(cell - 1.4, size - x),
          h: Math.min(cell - 1.4, size - y),
          nx,
          ny,
          ang: Math.atan2(ny - 0.56, nx - 0.5),
          i: cells.length
        });
      }
    }
  }
  powerGlyph = { cells, size };
  return powerGlyph;
}

function powerCanvasCtx() {
  const canvas = els.powerCanvas;
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

function clearPowerCanvas() {
  const pack = powerCanvasCtx();
  if (!pack) return;
  pack.ctx.clearRect(0, 0, pack.canvas.width, pack.canvas.height);
}

function cancelPowerAnim() {
  if (powerRaf) {
    cancelAnimationFrame(powerRaf);
    powerRaf = 0;
  }
  powerBusy = false;
  if (els.power) els.power.classList.remove("ps-power-busy");
}

function paintPowerResting() {
  if (!els.power) return;
  els.power.classList.toggle("ps-power-paused", paused);
  els.power.setAttribute("aria-pressed", paused ? "true" : "false");
  els.power.setAttribute(
    "aria-label",
    paused ? "Resume Rapidplay" : "Pause Rapidplay"
  );
  els.power.title = paused ? "Resume Rapidplay" : "Pause Rapidplay";
  // Resting states are single clean layers: the smooth masked fill when paused,
  // the SVG outline when on. The pixel canvas is animation-only, so clear it
  // here to avoid stacking pixels over the solid fill.
  clearPowerCanvas();
}

function syncPowerButton({ animate = false } = {}) {
  if (!els.power) return;
  els.power.setAttribute("aria-pressed", paused ? "true" : "false");
  els.power.setAttribute(
    "aria-label",
    paused ? "Resume Rapidplay" : "Pause Rapidplay"
  );
  els.power.title = paused ? "Resume Rapidplay" : "Pause Rapidplay";
  if (powerBusy && !animate) return;
  if (animate && !prefersReducedMotion()) {
    if (paused) runPowerPauseAnim();
    else runPowerResumeAnim();
    return;
  }
  if (!powerBusy) paintPowerResting();
}

function runPowerPauseAnim() {
  const pack = powerCanvasCtx();
  if (!pack) {
    paintPowerResting();
    return;
  }
  const cells = ensurePowerGlyph().cells.slice().sort((a, b) => {
    const da = a.ny * 18 + (hash32(a.i + 7) % 10) / 10 + a.nx * 0.15;
    const db = b.ny * 18 + (hash32(b.i + 7) % 10) / 10 + b.nx * 0.15;
    return da - db;
  });
  cancelPowerAnim();
  powerBusy = true;
  els.power.classList.add("ps-power-busy");
  els.power.classList.remove("ps-power-paused");
  const startedAt = nowMs();
  const duration = 640;
  const tick = () => {
    if (!els.powerCanvas) {
      cancelPowerAnim();
      return;
    }
    const t = Math.min(1, (nowMs() - startedAt) / duration);
    const ctx = pack.ctx;
    ctx.clearRect(0, 0, pack.canvas.width, pack.canvas.height);
    ctx.fillStyle = POWER_RED;
    const n = cells.length;
    for (let i = 0; i < n; i++) {
      const appear = i / Math.max(1, n - 1);
      const local = (t - appear * 0.72) / 0.28;
      if (local <= 0) continue;
      const cell = cells[i];
      const flicker = hash32(i * 17 + Math.floor(t * 20)) % 17 === 0 && t < 0.9;
      ctx.globalAlpha = flicker ? 0.28 : Math.min(1, local);
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
    ctx.globalAlpha = 1;
    if (t < 1) {
      powerRaf = requestAnimationFrame(tick);
      return;
    }
    powerRaf = 0;
    powerBusy = false;
    if (els.power) els.power.classList.remove("ps-power-busy");
    paintPowerResting();
  };
  powerRaf = requestAnimationFrame(tick);
}

function runPowerResumeAnim() {
  const pack = powerCanvasCtx();
  if (!pack) {
    paintPowerResting();
    return;
  }
  const glyph = ensurePowerGlyph();
  const drain = glyph.cells.slice().sort((a, b) => {
    const da = (1 - a.ny) * 18 + (hash32(a.i + 3) % 10) / 10;
    const db = (1 - b.ny) * 18 + (hash32(b.i + 3) % 10) / 10;
    return da - db;
  });
  const rush = glyph.cells.slice().sort((a, b) => {
    const da = ((a.ang + Math.PI * 1.5) % (Math.PI * 2)) + a.ny * 0.2;
    const db = ((b.ang + Math.PI * 1.5) % (Math.PI * 2)) + b.ny * 0.2;
    return da - db;
  });
  cancelPowerAnim();
  powerBusy = true;
  els.power.classList.add("ps-power-busy");
  els.power.classList.remove("ps-power-paused");
  const startedAt = nowMs();
  const drainDur = 360;
  const rushDur = 440;
  const fadeDur = 200;
  const total = drainDur + rushDur + fadeDur;
  const tick = () => {
    if (!els.powerCanvas) {
      cancelPowerAnim();
      return;
    }
    const elapsed = nowMs() - startedAt;
    const ctx = pack.ctx;
    ctx.clearRect(0, 0, pack.canvas.width, pack.canvas.height);
    const n = drain.length;
    if (elapsed < drainDur) {
      const t = elapsed / drainDur;
      for (let i = 0; i < n; i++) {
        const gone = i / Math.max(1, n - 1);
        if (t > gone * 0.78 + 0.12) continue;
        const cell = drain[i];
        const flicker = hash32(i * 11 + Math.floor(t * 16)) % 19 === 0;
        ctx.globalAlpha = flicker ? 0.38 : 1;
        ctx.fillStyle = POWER_RED;
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    } else if (elapsed < drainDur + rushDur) {
      const t = (elapsed - drainDur) / rushDur;
      for (let i = 0; i < rush.length; i++) {
        const appear = i / Math.max(1, rush.length - 1);
        const local = (t - appear * 0.6) / 0.24;
        if (local <= 0 || local > 1.4) continue;
        const cell = rush[i];
        ctx.fillStyle = powerBootColor(cell.i);
        ctx.globalAlpha = local < 1 ? Math.min(1, local * 1.45) : Math.max(0, 1.4 - local);
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    } else {
      const t = Math.min(1, (elapsed - drainDur - rushDur) / fadeDur);
      for (let i = 0; i < rush.length; i++) {
        const cell = rush[i];
        ctx.fillStyle = powerBootColor(cell.i);
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    }
    ctx.globalAlpha = 1;
    if (elapsed < total) {
      powerRaf = requestAnimationFrame(tick);
      return;
    }
    powerRaf = 0;
    powerBusy = false;
    if (els.power) els.power.classList.remove("ps-power-busy");
    paintPowerResting();
  };
  powerRaf = requestAnimationFrame(tick);
}

async function togglePausedFromUi() {
  if (powerBusy || tornDown) return;
  const next = !paused;
  applyPausedState(next, { animate: true });
  const reply = await send({ type: "SET_PAUSED", paused: next });
  if (reply && reply.error) applyPausedState(!next, { animate: true });
}

function smoothDamp(current, target, velocity, smoothTime, dt, maxSpeed) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const originalTo = target;
  const maxChange = maxSpeed * Math.max(0.0001, smoothTime);
  change = Math.min(maxChange, Math.max(-maxChange, change));
  target = current - change;
  const temp = (velocity + omega * change) * dt;
  velocity = (velocity - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  if (originalTo - current > 0 === output > originalTo) {
    output = originalTo;
    velocity = dt > 0 ? (output - originalTo) / dt : 0;
  }
  return { value: output, velocity };
}

function assignSliderValue(value) {
  if (!els.slider) return;
  writingSpeedUi = true;
  els.slider.value = String(value);
  writingSpeedUi = false;
}

function writeSpeedUi(rate) {
  visualRate = PlaybackSpeed.clampRate(rate);
  visualTarget = visualRate;
  assignSliderValue(PlaybackSpeed.formatRate(visualRate));
  if (els.readout) els.readout.textContent = PlaybackSpeed.formatRate(visualRate) + "x";
}

function snapSpeedUi(rate) {
  cancelSpeedUiAnim();
  visualVel = 0;
  visualHold = false;
  writeSpeedUi(rate);
}

function paintSpeedUi() {
  assignSliderValue(visualRate);
  if (els.readout) els.readout.textContent = PlaybackSpeed.formatRate(visualRate) + "x";
}

function pinSpeedUiToCommitted(rate) {
  visualRate = PlaybackSpeed.clampRate(rate);
  visualVel = 0;
  visualTarget = visualRate;
  assignSliderValue(PlaybackSpeed.formatRate(visualRate));
  if (els.readout) els.readout.textContent = PlaybackSpeed.formatRate(visualRate) + "x";
}

function tickSpeedUi(stamp) {
  if (dragging) {
    speedUiAnim = 0;
    visualAnimStamp = 0;
    visualVel = 0;
    return;
  }
  let dt = visualAnimStamp ? (stamp - visualAnimStamp) / 1000 : 1 / 60;
  visualAnimStamp = stamp;
  if (dt > 0.064) dt = 0.064;
  const smoothTime = visualHold ? 0.05 : 0.16;
  const maxSpeed = visualHold ? 22 : 14;
  const next = smoothDamp(visualRate, visualTarget, visualVel, smoothTime, dt, maxSpeed);
  visualRate = next.value;
  visualVel = next.velocity;
  paintSpeedUi();
  if (
    !visualHold &&
    Math.abs(visualTarget - visualRate) < 0.0008 &&
    Math.abs(visualVel) < 0.04
  ) {
    writeSpeedUi(visualTarget);
    visualVel = 0;
    speedUiAnim = 0;
    visualAnimStamp = 0;
    return;
  }
  speedUiAnim = requestAnimationFrame(tickSpeedUi);
}

function animateSpeedUiTo(rate, { hold = false } = {}) {
  if (!els.slider && !els.readout) return;
  const to = PlaybackSpeed.clampRate(rate);
  visualHold = hold;
  visualTarget = to;
  if (
    dragging ||
    !panelOpen ||
    prefersReducedMotion() ||
    (!hold && Math.abs(to - visualRate) < 0.001)
  ) {
    snapSpeedUi(to);
    return;
  }
  if (!speedUiAnim) speedUiAnim = requestAnimationFrame(tickSpeedUi);
}

function syncSpeedUi() {
  if (!els.readout) return;
  if (speedUiAnim && !dragging) markChips();
  else {
    snapSpeedUi(speed);
    markChips();
  }
}

function setSpeedLocal(rate, { toast = false, fromSlider = false, snap = false } = {}) {
  speed = PlaybackSpeed.clampRate(rate);
  applyAll();
  scheduleNativeSync();
  if (overlayHasUi() && els.readout) {
    if (fromSlider || snap || dragging || !els.slider) snapSpeedUi(speed);
    else animateSpeedUiTo(speed);
    markChips();
  }
  if (toast && !panelOpen && !paused && shouldOwnOverlay()) {
    if (overlayHasUi()) {
      if (els.toast && els.toast.classList.contains("ps-toast-show")) {
        els.toast.textContent = PlaybackSpeed.formatRate(speed) + "x";
      } else {
        showToast();
      }
    } else {
      buildOverlayDom().then(() => {
        if (!tornDown && !paused && !panelOpen && shouldOwnOverlay()) showToast();
      }).catch(() => {});
    }
  }
  schedulePersist();
}

function applyHotkeyStep(dir, { toast = false } = {}) {
  const from = PlaybackSpeed.clampRate(speed);
  if (!dragging) pinSpeedUiToCommitted(from);
  setSpeedLocal(PlaybackSpeed.stepRate(from, dir, settings.increment), { toast });
}

function stopSpeedHold() {
  if (!speedHold) return;
  clearTimeout(speedHold.delayTimer);
  if (speedHold.raf) cancelAnimationFrame(speedHold.raf);
  speedHold = null;
  visualHold = false;
}

// Held hotkey: glide in whole hundredths until release or a bound. Each
// committed cent snaps the slider and readout directly (no accel/decel).
function beginSpeedHoldRamp() {
  if (!speedHold) return;
  speedHold.holding = true;
  speedHold.lastStamp = 0;
  speedHold.carryCents = 0;
  if (!dragging) pinSpeedUiToCommitted(speed);
  const tick = (stamp) => {
    if (!speedHold || !speedHold.holding) return;
    let dt = speedHold.lastStamp ? (stamp - speedHold.lastStamp) / 1000 : 1 / 60;
    speedHold.lastStamp = stamp;
    if (dt > 0.064) dt = 0.064;
    const perSecond = Math.max(
      HOLD_RAMP_MIN_PER_SECOND,
      PlaybackSpeed.clampIncrement(settings.increment) / HOLD_RAMP_STEP_DIVISOR
    );
    speedHold.carryCents += perSecond * dt * 100;
    const wholeCents = Math.floor(speedHold.carryCents);
    if (wholeCents >= 1) {
      speedHold.carryCents -= wholeCents;
      const next = PlaybackSpeed.stepRate(speed, speedHold.dir, wholeCents / 100);
      if (next === speed) {
        speedHold.raf = 0;
        return;
      }
      setSpeedLocal(next, { toast: speedHold.toast, snap: true });
    }
    speedHold.raf = requestAnimationFrame(tick);
  };
  speedHold.raf = requestAnimationFrame(tick);
}

function startSpeedHold(dir, { toast = false } = {}) {
  if (speedHold && speedHold.dir === dir) return;
  stopSpeedHold();
  applyHotkeyStep(dir, { toast });
  speedHold = {
    dir,
    toast,
    holding: false,
    delayTimer: setTimeout(beginSpeedHoldRamp, HOLD_RAMP_DELAY_MS),
    raf: 0,
    lastStamp: 0,
    carryCents: 0
  };
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSpeed, 50);
}

function applyResolvedSpeed(next, { animate = false } = {}) {
  const rate = PlaybackSpeed.clampRate(next);
  const speedChanged = Math.abs(rate - speed) > 0.001;
  if (speedChanged) {
    speed = rate;
    applyAll();
    scheduleNativeSync();
  }
  if (!overlayHasUi()) return;
  syncScopeButtons();
  if (!els.readout || !speedChanged) return;
  if (els.slider && !dragging && animate && panelOpen) animateSpeedUiTo(speed);
  else snapSpeedUi(speed);
  markChips();
}

function applyRemoteState(state, { animate = false, ignoreSpeed = false } = {}) {
  if (!state || state.error) return false;
  if (state.paused === true || state.paused === false) {
    applyPausedState(state.paused, { animate: false });
  }
  if (state.tabId != null) tabId = state.tabId;
  if (state.hostname) hostname = state.hostname;
  if (state.scope === "tab" || state.scope === "site" || state.scope === "global") {
    scope = state.scope;
  }
  if (!ignoreSpeed && state.speed != null) {
    applyResolvedSpeed(state.speed, { animate });
  } else if (overlayHasUi()) {
    syncScopeButtons();
  }
  if (state.settings) {
    const incoming = PlaybackSpeed.mergeSettings(state.settings);
    if (appearanceDragging) {
      incoming.panelOpacity = settings.panelOpacity;
      incoming.panelHue = settings.panelHue;
      settings = incoming;
    } else {
      settings = incoming;
      if (overlayHasUi() && shadow && !ignoreSpeed) {
        syncOverlay();
        applyAppearance();
      }
    }
  }
  return true;
}

async function persistSpeed() {
  clearTimeout(persistTimer);
  persistTimer = 0;
  const state = await send({
    type: "SET_SPEED",
    speed,
    scope
  });
  applyRemoteState(state, { ignoreSpeed: true });
}

async function refreshState({ animate = false } = {}) {
  if (dragging || appearanceDragging) return;
  const state = await send({ type: "GET_STATE" });
  applyRemoteState(state, { animate });
}

async function setScope(next) {
  const wanted = next === "tab" || next === "site" ? next : "global";
  const pending = persistTimer;
  clearTimeout(persistTimer);
  persistTimer = 0;
  if (pending) await persistSpeed();
  const previous = scope;
  scope = wanted;
  if (overlayHasUi()) syncScopeButtons();
  const state = await send({ type: "SET_SCOPE", scope: wanted });
  if (!state || state.error) {
    scope = previous;
    if (overlayHasUi()) syncScopeButtons();
    return;
  }
  applyRemoteState(state, { animate: true });
}

async function saveSettings(next) {
  settings = PlaybackSpeed.mergeSettings(next);
  if (overlayHasUi() && !appearanceDragging) {
    syncOverlay();
    applyAppearance();
  }
  const reply = await send({ type: "SAVE_SETTINGS", settings });
  if (reply && reply.settings && !appearanceDragging) {
    settings = PlaybackSpeed.mergeSettings(reply.settings);
  }
}

function blurForOpacity(alpha) {
  if (alpha >= 0.9) return 0;
  if (alpha < 0.55) return Math.round(12 * ((alpha - 0.1) / 0.45));
  return Math.round(12 * ((0.9 - alpha) / 0.35));
}

function applyAppearance() {
  if (!els.panel) return;
  const alpha = PlaybackSpeed.clampOpacity(settings.panelOpacity);
  const hue = PlaybackSpeed.clampHue(settings.panelHue);
  const sat = Math.round(10 + (1 - alpha) * 14);
  const light = Math.round(10 + (1 - alpha) * 14);
  const borderA = (0.08 + (1 - alpha) * 0.22).toFixed(2);
  const blur = blurForOpacity(alpha);
  const backdrop = blur > 0 ? "blur(" + blur + "px) saturate(1.12)" : "none";
  const panel = els.panel.style;
  panel.setProperty("--ps-hue", String(hue));
  panel.setProperty("--ps-sat", sat + "%");
  panel.setProperty("--ps-light", light + "%");
  panel.setProperty("--ps-alpha", String(alpha));
  panel.setProperty("--ps-border-a", borderA);
  if (!appearanceDragging) panel.setProperty("--ps-backdrop", backdrop);
  if (els.toast) {
    els.toast.style.background = "hsla(" + hue + ", " + sat + "%, " + light + "%, " + Math.min(1, alpha + 0.08) + ")";
  }
  if (els.opacityValue) {
    els.opacityValue.textContent = Math.round(alpha * 100) + "%";
  }
  if (els.hueValue) els.hueValue.textContent = String(hue);
  if (els.opacitySlider && !appearanceDragging) els.opacitySlider.value = String(alpha);
  if (els.hueSlider) {
    if (!appearanceDragging) els.hueSlider.value = String(hue);
    els.hueSlider.style.accentColor = "hsl(" + hue + ", 70%, 55%)";
  }
}

function commitAppearanceFromSliders() {
  if (!els.opacitySlider || !els.hueSlider) return;
  settings.panelOpacity = PlaybackSpeed.clampOpacity(els.opacitySlider.value);
  settings.panelHue = PlaybackSpeed.clampHue(els.hueSlider.value);
}

function appearanceValueFromClientX(slider, clientX) {
  const rect = slider.getBoundingClientRect();
  const min = Number(slider.min);
  const max = Number(slider.max);
  const width = rect.width || 1;
  const t = Math.min(1, Math.max(0, (clientX - rect.left) / width));
  const raw = min + t * (max - min);
  const step = Number(slider.step);
  if (!Number.isFinite(step) || step <= 0) return raw;
  return Math.round(raw / step) * step;
}

function onAppearanceInput() {
  appearanceDragging = true;
  commitAppearanceFromSliders();
  applyAppearance();
}

function onAppearancePointerDown(event) {
  if (event.button != null && event.button !== 0) return;
  appearanceDragging = true;
  appearanceSliderEl = event.currentTarget;
  appearancePointerId = event.pointerId;
}

function onAppearancePointerMove(event) {
  if (!appearanceDragging || !appearanceSliderEl) return;
  if (event.pointerId != null && appearancePointerId != null && event.pointerId !== appearancePointerId) {
    return;
  }
  if (event.pointerType === "mouse" && event.buttons === 0) {
    endAppearanceDrag();
    return;
  }
  const rect = appearanceSliderEl.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (inside) return;
  const next = appearanceValueFromClientX(appearanceSliderEl, event.clientX);
  if (String(appearanceSliderEl.value) === String(next)) return;
  appearanceSliderEl.value = String(next);
  onAppearanceInput();
}

function preventOverlayDrag(event) {
  event.preventDefault();
}

function preventAppearancePageDrag(event) {
  if (appearanceDragging) event.preventDefault();
}

function endAppearanceDrag() {
  if (!appearanceDragging) return;
  appearanceDragging = false;
  appearanceSliderEl = null;
  appearancePointerId = null;
  commitAppearanceFromSliders();
  if (overlayHasUi()) applyAppearance();
  saveSettings(settings).catch(() => {});
}

function showToast() {
  if (!els.toast) return;
  els.toast.textContent = PlaybackSpeed.formatRate(speed) + "x";
  els.toast.hidden = false;
  els.toast.classList.add("ps-toast-show");
  placeHost({ restack: Boolean(getFullscreenElement()) });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("ps-toast-show");
    toastTimer = setTimeout(() => {
      if (els.toast && !els.toast.classList.contains("ps-toast-show")) {
        els.toast.hidden = true;
        if (!panelOpen) destroyOverlay();
      }
    }, 180);
  }, 700);
}

function bindOverlayOutside(on) {
  if (on && !overlayOutsideBound) {
    document.addEventListener("pointerdown", onPagePointerDown, true);
    overlayOutsideBound = true;
  } else if (!on && overlayOutsideBound) {
    document.removeEventListener("pointerdown", onPagePointerDown, true);
    overlayOutsideBound = false;
  }
}

function bindOverlayWheel(on) {
  if (on && !overlayWheelBound) {
    document.addEventListener("wheel", onOverlayWheel, { capture: true, passive: false });
    overlayWheelBound = true;
  } else if (!on && overlayWheelBound) {
    document.removeEventListener("wheel", onOverlayWheel, true);
    overlayWheelBound = false;
  }
}

function hidePanel() {
  if (tornDown) return;
  panelOpen = false;
  stopSpeedHold();
  sliderGesture = null;
  dragging = false;
  if (appearanceDragging) endAppearanceDrag();
  if (speedUiAnim) snapSpeedUi(speed);
  if (activeStepperStop) activeStepperStop();
  pressedKeys.clear();
  stopOverlayScrollAnim();
  blurOverlayControl();
  if (els.panel) els.panel.hidden = true;
  clearRecordingState();
  updateBindLabels();
  bindOverlayOutside(false);
  bindOverlayWheel(false);
  destroyOverlay();
  maybeIdle();
}

function openPanel() {
  panelOpen = true;
  lastPanelOpenAt = Date.now();
  pressedKeys.clear();
  if (els.toast) {
    els.toast.classList.remove("ps-toast-show");
    els.toast.hidden = true;
  }
  if (els.panel) els.panel.hidden = false;
  bindOverlayOutside(true);
  bindOverlayWheel(true);
  placeHost({ restack: Boolean(getFullscreenElement()) });
  focusOverlayPanel();
  syncSpeedUi();
  refreshState({ animate: true })
    .then(() => setScope(scope))
    .catch(() => {});
}

async function togglePanel(source) {
  if (tornDown) return;
  if (!shouldOwnOverlay()) {
    if (!isTop) send({ type: "TOGGLE_OVERLAY_FROM_FRAME" });
    return;
  }
  if (source === "action") {
    const now = Date.now();
    if (now - lastActionToggle < 250) return;
    lastActionToggle = now;
  }
  if (!document.documentElement) return;
  if (panelOpen) {
    hidePanel();
    return;
  }
  uiHold = true;
  try {
    if (!shadow) await buildOverlayDom();
    if (tornDown || !shadow) return;
    openPanel();
  } catch {
    /* extension context invalidated */
  } finally {
    uiHold = false;
  }
}

function presetLabel(preset) {
  return PlaybackSpeed.formatRate(preset.speed) + "x";
}

function syncScopeButtons() {
  if (!els.scope) return;
  els.scope.dataset.active = scope;
  const buttons = els.scope.querySelectorAll("button");
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].setAttribute(
      "aria-pressed",
      buttons[i].dataset.scope === scope ? "true" : "false"
    );
  }
  const siteBtn = els.scope.querySelector('[data-scope="site"]');
  if (siteBtn) {
    siteBtn.title = hostname ? "Session override for " + hostname : "This Site";
  }
}

function syncOverlay() {
  if (!els.slider) return;
  syncSpeedUi();
  syncScopeButtons();
  els.presets.innerHTML = "";
  for (const preset of settings.presets) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ps-chip";
    chip.dataset.speed = String(preset.speed);
    chip.textContent = presetLabel(preset);
    chip.addEventListener("click", () => setSpeedLocal(preset.speed));
    els.presets.appendChild(chip);
  }
  markChips();
  syncPowerButton();
  if (els.increment) els.increment.value = PlaybackSpeed.clampIncrement(settings.increment).toFixed(2);
  if (els.opacitySlider && !appearanceDragging) {
    els.opacitySlider.value = String(settings.panelOpacity);
  }
  if (els.hueSlider && !appearanceDragging) els.hueSlider.value = String(settings.panelHue);
  applyAppearance();
  applySettingsOpenUi();
  updateBindLabels();
  renderPresetEditors();
}

function applySettingsOpenUi() {
  if (!els.settingsToggle || !els.settings) return;
  els.settingsToggle.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
  els.settingsToggle.setAttribute(
    "aria-label",
    settingsOpen ? "Hide Settings" : "Settings"
  );
  els.settings.classList.toggle("ps-settings-open", settingsOpen);
  els.settings.setAttribute("aria-hidden", settingsOpen ? "false" : "true");
  els.settings.inert = !settingsOpen;
  if (els.settingsHead) {
    els.settingsHead.classList.toggle("ps-settings-open", settingsOpen);
  }
  if (els.resetHotkeys) {
    els.resetHotkeys.setAttribute("aria-hidden", settingsOpen ? "false" : "true");
    els.resetHotkeys.inert = !settingsOpen;
  }
}

function bindLabel(recordingId, combo) {
  if (recording !== recordingId) return PlaybackSpeed.formatCombo(combo);
  if (!recordingKeys.length) return "Press…";
  return recordingKeys.map((key) => PlaybackSpeed.formatKeyLabel(key)).join(" + ") + "...";
}

function updateBindLabels() {
  if (!els.toggleBind) return;
  const map = [
    ["toggleBind", "toggle", settings.toggleCombo],
    ["downOpenBind", "downOpen", settings.speedDownOpen],
    ["upOpenBind", "upOpen", settings.speedUpOpen],
    ["downClosedBind", "downClosed", settings.speedDownClosed],
    ["upClosedBind", "upClosed", settings.speedUpClosed]
  ];
  for (const [elKey, rec, combo] of map) {
    const btn = els[elKey];
    if (!btn) continue;
    btn.textContent = bindLabel(rec, combo);
    btn.dataset.recording = recording === rec ? "true" : "false";
  }
  if (!els.presetEditors) return;
  for (const preset of settings.presets) {
    const recId = "preset:" + preset.id;
    const btn = els.presetEditors.querySelector('[data-rec="' + recId + '"]');
    if (!btn) continue;
    btn.textContent = bindLabel(recId, presetCombo(preset));
    btn.dataset.recording = recording === recId ? "true" : "false";
  }
}

function clearRecordingState() {
  recording = null;
  recordingKeys = [];
  recordingHeld = new Set();
}

function startRecording(id) {
  recording = id;
  recordingKeys = [];
  recordingHeld = new Set();
  updateBindLabels();
}

function attachSteppers(input, commit) {
  const steppers = document.createElement("div");
  steppers.className = "ps-steppers";
  steppers.setAttribute("aria-hidden", "true");

  const startStepper = (delta) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button != null && event.button !== 0) return;
    if (activeStepperStop) activeStepperStop();
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId != null) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    commit(Number(input.value) + delta);
    let stopped = false;
    let intervalId = 0;
    const holdId = setTimeout(() => {
      intervalId = setInterval(() => {
        commit(Number(input.value) + delta);
      }, 50);
    }, 380);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(holdId);
      clearInterval(intervalId);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      if (activeStepperStop === stop) activeStepperStop = null;
      saveSettings(settings).catch(() => {});
    };
    activeStepperStop = stop;
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  };

  const up = document.createElement("button");
  up.type = "button";
  up.className = "ps-stepper ps-stepper-up";
  up.tabIndex = -1;
  up.title = "Increase by 0.01";
  up.addEventListener("pointerdown", startStepper(0.01));

  const down = document.createElement("button");
  down.type = "button";
  down.className = "ps-stepper ps-stepper-down";
  down.tabIndex = -1;
  down.title = "Decrease by 0.01";
  down.addEventListener("pointerdown", startStepper(-0.01));

  steppers.append(up, down);
  input.parentElement.appendChild(steppers);
}

function renderPresetEditors() {
  if (!els.presetEditors) return;
  els.presetEditors.innerHTML = "";
  settings.presets.forEach((preset, index) => {
    const row = document.createElement("div");
    row.className = "ps-preset-edit";

    const speedWrap = document.createElement("div");
    speedWrap.className = "ps-num-wrap ps-preset-speed";

    const speedInput = document.createElement("input");
    speedInput.type = "number";
    speedInput.min = String(PlaybackSpeed.MIN);
    speedInput.max = String(PlaybackSpeed.MAX);
    speedInput.step = "0.01";
    speedInput.size = 5;
    speedInput.inputMode = "decimal";
    speedInput.value = PlaybackSpeed.formatRate(preset.speed);
    speedInput.title = "Preset Speed";
    speedInput.addEventListener("change", () => {
      settings.presets[index].speed = PlaybackSpeed.clampRate(speedInput.value);
      saveSettings(settings).catch(() => {});
    });

    speedWrap.appendChild(speedInput);
    attachSteppers(speedInput, (next) => {
      const rate = PlaybackSpeed.clampRate(next);
      speedInput.value = PlaybackSpeed.formatRate(rate);
      settings.presets[index].speed = rate;
    });

    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    keyBtn.className = "ps-bind";
    const recId = "preset:" + preset.id;
    keyBtn.dataset.rec = recId;
    keyBtn.textContent = bindLabel(recId, presetCombo(preset));
    keyBtn.dataset.recording = recording === recId ? "true" : "false";
    keyBtn.title = "Shortcut While the Panel Is Open";
    keyBtn.addEventListener("click", () => startRecording(recId));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ps-icon-btn";
    const delMark = document.createElement("span");
    delMark.className = "ps-icon-btn-mark";
    delMark.textContent = "×";
    del.appendChild(delMark);
    del.title = "Remove Preset";
    del.addEventListener("click", () => {
      settings.presets = settings.presets.filter((p) => p.id !== preset.id);
      saveSettings(settings).catch(() => {});
    });

    row.append(speedWrap, keyBtn, del);
    els.presetEditors.appendChild(row);
  });
  syncAddPresetButton();
}

function syncAddPresetButton() {
  if (!els.addPreset) return;
  els.addPreset.hidden = settings.presets.length >= PlaybackSpeed.MAX_PRESETS;
}

function commitRecording(stillHeld) {
  if (!recording || !recordingKeys.length) {
    clearRecordingState();
    updateBindLabels();
    return;
  }
  const id = recording;
  const combo = { keys: recordingKeys.slice(0, 3) };
  if (stillHeld) {
    for (const key of recordingKeys) pressedKeys.add(key);
    suppressHotkeys = true;
  }
  clearRecordingState();
  stealCombo(combo, id);
  setSlotCombo(id, combo);
  saveSettings(settings).catch(() => {});
}

function clearSlotToUnset() {
  if (!recording) return;
  const id = recording;
  clearRecordingState();
  setSlotCombo(id, PlaybackSpeed.emptyCombo());
  saveSettings(settings).catch(() => {});
}

function handleRecordingDown(event) {
  if (!recording) return false;
  if (event.repeat) return true;
  const key = eventKey(event);
  if (key === "escape" || key === "delete" || key === "backspace") {
    clearSlotToUnset();
    return true;
  }
  if (!usableKey(key) || recordingKeys.includes(key)) return true;
  if (recordingKeys.length >= 3) return true;
  recordingKeys.push(key);
  recordingHeld.add(key);
  if (recordingKeys.length === 3) {
    commitRecording(true);
    return true;
  }
  updateBindLabels();
  return true;
}

function handleRecordingUp(event) {
  if (!recording) return false;
  const key = eventKey(event);
  recordingHeld.delete(key);
  if (recordingKeys.length > 0 && recordingHeld.size === 0) {
    commitRecording(false);
  }
  return true;
}

function blurOverlayControl() {
  const active = shadow && shadow.activeElement;
  if (!active || isEditableElement(active) || active === els.panel) return;
  active.blur();
}

function afterOverlayHotkey() {
  blurOverlayControl();
  if (panelOpen && getFullscreenElement()) focusOverlayPanel();
}

function onKeyDown(event) {
  if (!event.isTrusted) return;
  if (handleRecordingDown(event)) {
    consume(event);
    return;
  }
  if (isTypingTarget(event)) {
    if (isOverlayTypingTarget()) isolateOverlayKeyFromPage(event);
    return;
  }

  const key = eventKey(event);
  if (usableKey(key) && !event.repeat) pressedKeys.add(key);

  if (suppressHotkeys) {
    consume(event);
    return;
  }

  if (comboMatchesEvent(settings.toggleCombo, event)) {
    consume(event);
    afterOverlayHotkey();
    if (!event.repeat) togglePanel("hotkey");
    return;
  }

  if (paused && !panelOpen) return;

  const down = panelOpen ? settings.speedDownOpen : settings.speedDownClosed;
  const up = panelOpen ? settings.speedUpOpen : settings.speedUpClosed;
  if (comboMatchesEvent(down, event)) {
    consume(event);
    afterOverlayHotkey();
    if (!event.repeat) startSpeedHold(-1, { toast: !panelOpen });
    return;
  }
  if (comboMatchesEvent(up, event)) {
    consume(event);
    afterOverlayHotkey();
    if (!event.repeat) startSpeedHold(1, { toast: !panelOpen });
    return;
  }

  if (!panelOpen) {
    if (overlayHasKeyboardFocus()) isolateOverlayKeyFromPage(event);
    return;
  }
  const preset = settings.presets.find((p) => comboMatchesEvent(presetCombo(p), event));
  if (preset) {
    consume(event);
    afterOverlayHotkey();
    stopSpeedHold();
    setSpeedLocal(preset.speed);
    return;
  }
  if (overlayHasKeyboardFocus()) isolateOverlayKeyFromPage(event);
  if (getFullscreenElement()) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    const fromOverlay = Boolean(
      (els.panel && path.includes(els.panel)) ||
      (host && path.includes(host))
    );
    if (!fromOverlay) consume(event);
  }
}

function onKeyUp(event) {
  if (!event.isTrusted) return;
  const key = eventKey(event);
  if (handleRecordingUp(event)) {
    pressedKeys.delete(key);
    consume(event);
    return;
  }
  if (speedHold) {
    const combo = speedHold.dir < 0
      ? (panelOpen ? settings.speedDownOpen : settings.speedDownClosed)
      : (panelOpen ? settings.speedUpOpen : settings.speedUpClosed);
    const keys = PlaybackSpeed.comboKeys(combo);
    if (!keys.length || keys.includes(key)) stopSpeedHold();
  }
  pressedKeys.delete(key);
  if (suppressHotkeys && pressedKeys.size === 0) suppressHotkeys = false;
  if (isOverlayTypingTarget() || overlayHasKeyboardFocus()) isolateOverlayKeyFromPage(event);
}

function onKeyPress(event) {
  if (!event.isTrusted) return;
  if (recording || isOverlayTypingTarget() || overlayHasKeyboardFocus()) {
    isolateOverlayKeyFromPage(event);
  }
}

function onWindowBlur() {
  pressedKeys.clear();
  suppressHotkeys = false;
  stopSpeedHold();
  endAppearanceDrag();
  recordingHeld = new Set();
  if (recording && recordingKeys.length) {
    commitRecording(false);
    return;
  }
  if (recording) {
    clearRecordingState();
    updateBindLabels();
  }
}

function overlayHasUi() {
  return Boolean(shadow && els && els.panel);
}

function focusOverlayPanel() {
  if (!els.panel || els.panel.hidden) return;
  if (els.panel.tabIndex < 0) els.panel.tabIndex = -1;
  try {
    els.panel.focus({ preventScroll: true });
  } catch {
    try {
      els.panel.focus();
    } catch {
      /* ignore */
    }
  }
}

function onPagePointerDown(event) {
  if (!panelOpen || !host) return;
  if (Date.now() - lastPanelOpenAt < 300) return;
  const path = event.composedPath ? event.composedPath() : [];
  const mount = host.firstElementChild;
  if (mount && path.includes(mount)) return;
  if (els.panel && path.includes(els.panel)) return;
  if (els.toast && path.includes(els.toast)) return;
  hidePanel();
}

function fullscreenFrom(root) {
  if (!root) return null;
  return (
    root.fullscreenElement ||
    root.webkitFullscreenElement ||
    root.mozFullScreenElement ||
    root.msFullscreenElement ||
    null
  );
}

function getFullscreenElement() {
  let el = fullscreenFrom(document);
  while (el && el.shadowRoot) {
    const inner = fullscreenFrom(el.shadowRoot);
    if (!inner) break;
    el = inner;
  }
  return el;
}

function canHostOverlay(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = String(el.localName || el.tagName || "").toLowerCase();
  if (!tag || VOID_HOST_TAGS.has(tag) || NESTED_FRAME_TAGS.has(tag)) return false;
  if (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
  return true;
}

function isNestedFrameElement(el) {
  const tag = String((el && (el.localName || el.tagName)) || "").toLowerCase();
  return NESTED_FRAME_TAGS.has(tag);
}

function thisDocumentOwnsFullscreen() {
  const fs = getFullscreenElement();
  return Boolean(fs && !isNestedFrameElement(fs));
}

function thisFrameIsFullscreenIframe() {
  if (isTop) return false;
  try {
    const frame = window.frameElement;
    if (!frame || !parent.document) return false;
    const pfs = parent.document.fullscreenElement || parent.document.webkitFullscreenElement;
    return pfs === frame;
  } catch {
    return false;
  }
}

function shouldOwnOverlay() {
  if (thisDocumentOwnsFullscreen() || thisFrameIsFullscreenIframe()) return true;
  return isTop && !getFullscreenElement();
}

function overlayParent() {
  const fs = getFullscreenElement();
  if (fs && canHostOverlay(fs)) return fs;
  return document.documentElement || document.body || null;
}

function hostIsModal() {
  try {
    return Boolean(host && host.matches(":modal"));
  } catch {
    return false;
  }
}

function hostInTopLayer() {
  return hostIsModal();
}

function hostWantsVisible() {
  return Boolean(panelOpen || (els.toast && !els.toast.hidden));
}

function closeHostSurface() {
  if (!host) return;
  try {
    if (host.tagName === "DIALOG" && host.open) host.close();
  } catch {
    /* ignore */
  }
}

function syncHostOpenState() {
  if (!host) return;
  if (panelOpen) host.setAttribute("data-ps-open", "");
  else host.removeAttribute("data-ps-open");
  setHostProperty("pointer-events", panelOpen ? "auto" : "none");
}

function promoteHostLayer({ restack = false } = {}) {
  if (!host) return;
  try {
    if (!host.hasAttribute("data-ps-host")) host.setAttribute("data-ps-host", "");
    if (host.hasAttribute("popover")) host.removeAttribute("popover");
    ensureHostBackdropStyle();
    syncHostOpenState();
    if (!host.isConnected) return;

    if (!hostWantsVisible()) {
      closeHostSurface();
      return;
    }

    const fs = getFullscreenElement();
    const wantModal = Boolean(fs || thisFrameIsFullscreenIframe()) &&
      typeof host.showModal === "function";
    const alreadyRightMode = wantModal ? hostIsModal() : (host.open && !hostIsModal());
    if (restack || (host.open && !alreadyRightMode)) closeHostSurface();

    if (wantModal) {
      if (!hostIsModal()) host.showModal();
      if (panelOpen) focusOverlayPanel();
      return;
    }

    if (host.tagName === "DIALOG") {
      if (!host.open) host.show();
      return;
    }
  } catch {
    try {
      if (host.tagName === "DIALOG" && !host.open) host.show();
    } catch {
      /* ignore */
    }
  }
}

function ensureHostBackdropStyle() {
  if (!document.documentElement) return;
  if (document.getElementById("ps-host-backdrop")) return;
  const style = document.createElement("style");
  style.id = "ps-host-backdrop";
  style.textContent =
    "[data-ps-host]::backdrop{pointer-events:none!important;background:none!important}" +
    "[data-ps-host][data-ps-open]::backdrop{pointer-events:auto!important}";
  (document.head || document.documentElement).appendChild(style);
}

function overlayViewport() {
  const fs = getFullscreenElement();
  if (
    !hostInTopLayer() &&
    fs &&
    host &&
    canHostOverlay(fs) &&
    fs.contains(host) &&
    fs !== document.documentElement
  ) {
    const width = fs.clientWidth || window.innerWidth;
    const height = fs.clientHeight || window.innerHeight;
    return { width, height, offsetTop: 0, offsetLeft: 0, containerWidth: width };
  }
  const vv = window.visualViewport;
  return {
    width: vv && vv.width ? vv.width : window.innerWidth,
    height: vv && vv.height ? vv.height : window.innerHeight,
    offsetTop: vv && vv.offsetTop ? vv.offsetTop : 0,
    offsetLeft: vv && vv.offsetLeft ? vv.offsetLeft : 0,
    containerWidth: window.innerWidth
  };
}

function setHostProperty(name, value) {
  if (!host) return;
  if (
    host.style.getPropertyValue(name) === value &&
    host.style.getPropertyPriority(name) === "important"
  ) {
    return;
  }
  host.style.setProperty(name, value, "important");
}

function ensureHostStyle() {
  if (!host) return;
  for (let i = host.style.length - 1; i >= 0; i--) {
    const name = host.style.item(i);
    if (!HOST_STYLE_NAMES.has(name)) host.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(HOST_STYLE)) {
    setHostProperty(name, value);
  }
  syncOverlayLayout();
  syncHostOpenState();
}

function syncOverlayLayout() {
  if (!host) return;
  const view = overlayViewport();
  const margin = Math.max(8, Math.round(Math.min(view.width, view.height) * 0.012));
  const visualW = Math.min(view.width * 0.23, view.width - margin * 2);
  const visualH = Math.max(120, view.height - margin * 2);
  const scale = visualW / 380;
  const px = (value) => Math.round(value * 1000) / 1000 + "px";
  const containerWidth = view.containerWidth || window.innerWidth;
  setHostProperty("top", px(view.offsetTop + margin));
  setHostProperty("right", px(containerWidth - view.offsetLeft - view.width + margin));
  setHostProperty("width", px(visualW));
  setHostProperty("height", "auto");
  setHostProperty("max-height", px(visualH));
  setHostProperty("--ps-scale", String(Math.round(scale * 1000000) / 1000000));
  if (els.root) els.root.style.maxHeight = visualH / scale + "px";
  if (els.panel) els.panel.style.maxHeight = visualH / scale + "px";
}

function overlayScrollMax() {
  if (!els.panel) return 0;
  return Math.max(0, els.panel.scrollHeight - els.panel.clientHeight);
}

function stopOverlayScrollAnim() {
  if (!overlayScrollAnim) return;
  cancelAnimationFrame(overlayScrollAnim);
  overlayScrollAnim = 0;
}

function tickOverlayScroll() {
  overlayScrollAnim = 0;
  if (!els.panel) return;
  overlayScrollTarget = Math.min(overlayScrollMax(), Math.max(0, overlayScrollTarget));
  const cur = els.panel.scrollTop;
  const ease = prefersReducedMotion() ? 1 : 0.14;
  const next = cur + (overlayScrollTarget - cur) * ease;
  if (Math.abs(overlayScrollTarget - next) < 0.5) {
    els.panel.scrollTop = overlayScrollTarget;
    return;
  }
  els.panel.scrollTop = next;
  overlayScrollAnim = requestAnimationFrame(tickOverlayScroll);
}

function onOverlayWheel(event) {
  if (!host || !els.panel || els.panel.hidden) return;
  const path = event.composedPath ? event.composedPath() : [];
  if (!path.includes(host) && !path.includes(els.panel)) return;
  event.preventDefault();
  event.stopPropagation();

  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 18;
  else if (event.deltaMode === 2) delta = Math.sign(delta) * 72;
  else delta *= 0.42;

  const maxStep = 36;
  if (delta > maxStep) delta = maxStep;
  else if (delta < -maxStep) delta = -maxStep;

  const scale = Number.parseFloat(host.style.getPropertyValue("--ps-scale")) || 1;
  const from = overlayScrollAnim ? overlayScrollTarget : els.panel.scrollTop;
  overlayScrollTarget = Math.min(
    overlayScrollMax(),
    Math.max(0, from + delta / (scale || 1))
  );
  if (!overlayScrollAnim) overlayScrollAnim = requestAnimationFrame(tickOverlayScroll);
}

function placeHost({ restack = false } = {}) {
  if (!host) return;
  const parent = overlayParent();
  if (!parent) return;
  const fs = getFullscreenElement();
  const needLast = Boolean(fs && parent === fs && parent.lastElementChild !== host);
  if (host.parentNode !== parent || needLast) parent.appendChild(host);
  promoteHostLayer({ restack });
  ensureHostStyle();
}

function onFullscreenChange() {
  if (!isTop && !thisDocumentOwnsFullscreen() && panelOpen) hidePanel();
  else placeHost({ restack: true });
  if (panelOpen) focusOverlayPanel();
}

function sliderRateFromClientX(clientX) {
  if (!els.slider) return speed;
  const rect = els.slider.getBoundingClientRect();
  const min = Number(els.slider.min);
  const max = Number(els.slider.max);
  const width = rect.width || 1;
  const t = Math.min(1, Math.max(0, (clientX - rect.left) / width));
  return PlaybackSpeed.clampRate(min + t * (max - min));
}

function beginSliderDrag(rate) {
  if (!sliderGesture || sliderGesture.drag || !els.slider) return;
  sliderGesture.drag = true;
  dragging = true;
  cancelSpeedUiAnim();
  visualVel = 0;
  setSpeedLocal(rate, { fromSlider: true });
}

function onSliderPointerMove(event) {
  if (!sliderGesture || sliderGesture.drag) return;
  if (event.pointerId != null && event.pointerId !== sliderGesture.id) return;
  const dx = event.clientX - sliderGesture.startX;
  const dy = event.clientY - sliderGesture.startY;
  if (dx * dx + dy * dy < 9) return;
  beginSliderDrag(sliderRateFromClientX(event.clientX));
}

function endSliderDrag(event) {
  if (
    sliderGesture &&
    event &&
    event.pointerId != null &&
    sliderGesture.id != null &&
    event.pointerId !== sliderGesture.id
  ) {
    return;
  }
  const gesture = sliderGesture;
  const wasDrag = dragging || (gesture && gesture.drag);
  sliderGesture = null;
  if (!wasDrag) {
    if (gesture && gesture.clickRate != null) setSpeedLocal(gesture.clickRate);
    if (event && String(event.type).startsWith("pointer")) blurOverlayControl();
    return;
  }
  dragging = false;
  visualVel = 0;
  writeSpeedUi(speed);
  persistSpeed();
  if (event && String(event.type).startsWith("pointer")) blurOverlayControl();
}

async function loadOverlayCss() {
  if (overlayCssText) return overlayCssText;
  if (overlayCssWait) return overlayCssWait;
  if (!runtimeOk()) return "";
  try {
    overlayCssWait = fetch(chrome.runtime.getURL("content/overlay.css"))
      .then((res) => res.text())
      .then((text) => {
        overlayCssText = text;
        return text;
      })
      .catch(() => "")
      .finally(() => {
        overlayCssWait = null;
      });
  } catch {
    overlayCssWait = null;
    return "";
  }
  return overlayCssWait;
}

async function buildOverlayDom() {
  if (host || tornDown) return;
  if (!shouldOwnOverlay()) return;
  const css = await loadOverlayCss();
  if (host || tornDown) return;
  if (!shouldOwnOverlay()) return;
  if (!css) return;
  host = document.createElement("dialog");
  host.setAttribute("data-ps-host", "");
  host.draggable = false;
  host.addEventListener("dragstart", preventOverlayDrag);
  host.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  host.addEventListener("keydown", onKeyDown, true);
  host.addEventListener("keyup", onKeyUp, true);
  host.addEventListener("keypress", onKeyPress, true);
  bindOverlayPageKeyShield(host);
  ensureHostBackdropStyle();
  ensureHostStyle();
  hostStyleObserver = new MutationObserver(() => {
    if (!hostStyleObserver || !host) return;
    hostStyleObserver.disconnect();
    ensureHostStyle();
    hostStyleObserver.observe(host, {
      attributes: true,
      attributeFilter: ["style", "data-ps-host"]
    });
  });
  hostStyleObserver.observe(host, {
    attributes: true,
    attributeFilter: ["style", "data-ps-host"]
  });
  const mount = document.createElement("div");
  mount.setAttribute("data-ps-mount", "");
  mount.style.setProperty("display", "block", "important");
  mount.style.setProperty("width", "100%", "important");
  host.appendChild(mount);
  try {
    shadow = mount.attachShadow({ mode: "closed" });
  } catch {
    if (hostStyleObserver) {
      hostStyleObserver.disconnect();
      hostStyleObserver = null;
    }
    if (host.parentNode) host.parentNode.removeChild(host);
    host = null;
    return;
  }

  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  bindOverlayPageKeyShield(shadow);

  const root = document.createElement("div");
  root.id = "ps-root";
  root.innerHTML = `
      <div id="ps-panel" hidden tabindex="-1">
        <div class="ps-row">
          <div id="ps-readout">1.00x</div>
          <button type="button" id="ps-power" aria-pressed="false" aria-label="Pause Rapidplay" title="Pause Rapidplay">
            <span class="ps-power-face">
              <span class="ps-power-fill" aria-hidden="true"></span>
              <span class="ps-power-glow" aria-hidden="true"></span>
              <canvas class="ps-power-pixels" width="96" height="96" aria-hidden="true"></canvas>
              <svg class="ps-power-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" d="M12 4.1v7.15"/>
                <path fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" d="M8.12 7.38a5.88 5.88 0 1 0 7.76 0"/>
              </svg>
            </span>
          </button>
        </div>
        <input id="ps-slider" type="range" min="0.25" max="5" step="0.01" value="1" aria-label="Playback Speed">
        <div class="ps-segment" id="ps-scope" data-active="global">
          <div class="ps-segment-thumb" aria-hidden="true"></div>
          <button type="button" data-scope="global">All Tabs</button>
          <button type="button" data-scope="tab">This Tab</button>
          <button type="button" data-scope="site">This Site</button>
        </div>
        <div id="ps-presets"></div>
        <div class="ps-settings-head">
          <button type="button" id="ps-settings-toggle" aria-expanded="false" aria-controls="ps-settings" aria-label="Settings">
            <svg class="ps-gear" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" fill-rule="evenodd" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35c-.59.24-1.13.57-1.62.94L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>
            </svg>
            <span class="ps-toggle-words">
              <span class="ps-hide-slot" aria-hidden="true">
                <span class="ps-hide-word">Hide&nbsp;</span>
              </span>
              <span class="ps-settings-word">Settings</span>
            </span>
          </button>
          <button type="button" id="ps-reset-hotkeys" aria-hidden="true" inert title="Clear Toggle Panel, Slower, and Faster hotkeys">Reset Hotkeys</button>
        </div>
        <div id="ps-settings" aria-hidden="true">
          <div class="ps-settings-inner">
          <div class="ps-settings-body">
          <div class="ps-field">
            <span>Toggle Panel</span>
            <button type="button" class="ps-bind" id="ps-toggle-bind">Alt+X</button>
          </div>
          <div class="ps-label">While Panel Is Open</div>
          <div class="ps-field">
            <span>Slower</span>
            <button type="button" class="ps-bind" id="ps-down-open">Z</button>
          </div>
          <div class="ps-field">
            <span>Faster</span>
            <button type="button" class="ps-bind" id="ps-up-open">C</button>
          </div>
          <div class="ps-label">While Panel Is Closed</div>
          <div class="ps-field">
            <span>Slower</span>
            <button type="button" class="ps-bind" id="ps-down-closed">Not Set</button>
          </div>
          <div class="ps-field">
            <span>Faster</span>
            <button type="button" class="ps-bind" id="ps-up-closed">Not Set</button>
          </div>
          <div class="ps-field">
            <span>Step Size</span>
            <div class="ps-num-wrap ps-increment-wrap">
              <input id="ps-increment" type="number" min="0.01" max="1" step="0.01" value="0.25">
            </div>
          </div>
          <div class="ps-label">Appearance</div>
          <div class="ps-field-stack">
            <div class="ps-field-top">
              <span>Opacity</span>
              <span id="ps-opacity-value">90%</span>
            </div>
            <input id="ps-opacity" type="range" min="0.5" max="1" step="0.01" value="0.9" aria-label="Panel Opacity">
          </div>
          <div class="ps-field-stack">
            <div class="ps-field-top">
              <span>Hue</span>
              <span id="ps-hue-value">220</span>
            </div>
            <input id="ps-hue" type="range" min="0" max="360" step="1" value="220" aria-label="Panel Hue">
          </div>
          <div class="ps-label">Presets</div>
          <div id="ps-preset-editors"></div>
          <button type="button" id="ps-add-preset">Add Preset</button>
          </div>
          </div>
        </div>
      </div>
      <div id="ps-toast" hidden>1.00x</div>
    `;
  shadow.appendChild(root);

  els = {
    root,
    panel: root.querySelector("#ps-panel"),
    readout: root.querySelector("#ps-readout"),
    power: root.querySelector("#ps-power"),
    powerCanvas: root.querySelector(".ps-power-pixels"),
    slider: root.querySelector("#ps-slider"),
    scope: root.querySelector("#ps-scope"),
    presets: root.querySelector("#ps-presets"),
    settingsHead: root.querySelector(".ps-settings-head"),
    settingsToggle: root.querySelector("#ps-settings-toggle"),
    resetHotkeys: root.querySelector("#ps-reset-hotkeys"),
    settings: root.querySelector("#ps-settings"),
    toggleBind: root.querySelector("#ps-toggle-bind"),
    downOpenBind: root.querySelector("#ps-down-open"),
    upOpenBind: root.querySelector("#ps-up-open"),
    downClosedBind: root.querySelector("#ps-down-closed"),
    upClosedBind: root.querySelector("#ps-up-closed"),
    increment: root.querySelector("#ps-increment"),
    opacitySlider: root.querySelector("#ps-opacity"),
    opacityValue: root.querySelector("#ps-opacity-value"),
    hueSlider: root.querySelector("#ps-hue"),
    hueValue: root.querySelector("#ps-hue-value"),
    presetEditors: root.querySelector("#ps-preset-editors"),
    addPreset: root.querySelector("#ps-add-preset"),
    toast: root.querySelector("#ps-toast")
  };

  shadow.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (isEditableElement(target)) return;
    if (target.closest("input[type='range']")) return;
    if (!target.closest("button")) return;
    event.preventDefault();
  });
  shadow.addEventListener("dragstart", preventOverlayDrag);
  const blurRangeOnPointerUp = (event) => {
    const target = event.target;
    if (!target || typeof target.matches !== "function") return;
    if (target.matches("input[type='range']")) target.blur();
  };
  shadow.addEventListener("pointerup", blurRangeOnPointerUp);

  els.power.addEventListener("click", () => {
    togglePausedFromUi().catch(() => {});
  });

  els.slider.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    cancelSpeedUiAnim();
    visualVel = 0;
    sliderGesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originRate: visualRate,
      drag: false,
      clickRate: null
    };
  });
  els.slider.addEventListener("pointermove", onSliderPointerMove);
  els.slider.addEventListener("input", () => {
    if (!els.slider || writingSpeedUi) return;
    const native = PlaybackSpeed.clampRate(els.slider.value);
    if (dragging || (sliderGesture && sliderGesture.drag)) {
      setSpeedLocal(native, { fromSlider: true });
      return;
    }
    if (sliderGesture) {
      if (sliderGesture.clickRate == null) {
        sliderGesture.clickRate = native;
        assignSliderValue(sliderGesture.originRate);
        visualRate = sliderGesture.originRate;
        return;
      }
      if (Math.abs(native - sliderGesture.clickRate) > 0.001) {
        beginSliderDrag(native);
        return;
      }
      assignSliderValue(sliderGesture.originRate);
      return;
    }
    setSpeedLocal(native, { fromSlider: true });
  });
  els.slider.addEventListener("pointerup", endSliderDrag);
  els.slider.addEventListener("pointercancel", endSliderDrag);
  els.slider.addEventListener("change", (event) => {
    if (writingSpeedUi) return;
    endSliderDrag(event);
  });

  els.scope.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-scope]");
    if (btn) setScope(btn.dataset.scope);
  });

  els.settingsToggle.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    if (!settingsOpen) clearRecordingState();
    if (settingsOpen) {
      updateBindLabels();
      renderPresetEditors();
    }
    applySettingsOpenUi();
  });

  els.resetHotkeys.addEventListener("click", () => {
    clearRecordingState();
    settings.toggleCombo = PlaybackSpeed.emptyCombo();
    settings.speedDownOpen = PlaybackSpeed.emptyCombo();
    settings.speedUpOpen = PlaybackSpeed.emptyCombo();
    settings.speedDownClosed = PlaybackSpeed.emptyCombo();
    settings.speedUpClosed = PlaybackSpeed.emptyCombo();
    saveSettings(settings).catch(() => {});
  });

  const startBindRecording = (id) => () => startRecording(id);
  els.toggleBind.addEventListener("click", startBindRecording("toggle"));
  els.downOpenBind.addEventListener("click", startBindRecording("downOpen"));
  els.upOpenBind.addEventListener("click", startBindRecording("upOpen"));
  els.downClosedBind.addEventListener("click", startBindRecording("downClosed"));
  els.upClosedBind.addEventListener("click", startBindRecording("upClosed"));
  els.panel.addEventListener("pointerdown", (event) => {
    if (!recording) return;
    const target = event.target;
    if (target && target.closest && target.closest(".ps-bind, #ps-reset-hotkeys")) return;
    clearRecordingState();
    updateBindLabels();
  });
  els.increment.addEventListener("change", () => {
    settings.increment = PlaybackSpeed.clampIncrement(els.increment.value);
    els.increment.value = settings.increment.toFixed(2);
    saveSettings(settings).catch(() => {});
  });
  attachSteppers(els.increment, (next) => {
    const value = PlaybackSpeed.clampIncrement(next);
    els.increment.value = value.toFixed(2);
    settings.increment = value;
  });
  els.opacitySlider.addEventListener("pointerdown", onAppearancePointerDown);
  els.hueSlider.addEventListener("pointerdown", onAppearancePointerDown);
  els.opacitySlider.addEventListener("input", onAppearanceInput);
  els.hueSlider.addEventListener("input", onAppearanceInput);
  els.opacitySlider.addEventListener("pointerup", endAppearanceDrag);
  els.hueSlider.addEventListener("pointerup", endAppearanceDrag);
  els.opacitySlider.addEventListener("pointercancel", endAppearanceDrag);
  els.hueSlider.addEventListener("pointercancel", endAppearanceDrag);
  els.opacitySlider.addEventListener("change", endAppearanceDrag);
  els.hueSlider.addEventListener("change", endAppearanceDrag);
  els.addPreset.addEventListener("click", () => {
    if (settings.presets.length >= PlaybackSpeed.MAX_PRESETS) return;
    settings.presets.push({
      id: "p" + Date.now().toString(36),
      speed: 1,
      keys: []
    });
    saveSettings(settings).catch(() => {});
  });

  bindUiEvents();
  startMediaObserver();
  placeHost();
  syncOverlay();
}

function navigationWasReload() {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return Boolean(entry && entry.type === "reload");
  } catch {
    return false;
  }
}

function onMessage(message) {
  if (!message || tornDown) return;
  if (message.type === "TAB_HAS_MEDIA") {
    if (paused) return;
    tabHasMedia = true;
    return;
  }
  if (message.type === "TAB_MEDIA_CLEARED") {
    tabHasMedia = false;
    maybeIdle();
    return;
  }
  if (message.type === "MEDIA_STATUS_REQUEST") {
    if (paused) return;
    if (presentMediaCount() > 0) announceMedia().catch(() => {});
    return;
  }
  if (message.type === "APPLY_STATE") {
    if (dragging || appearanceDragging) return;
    if (message.reload) {
      refreshState({ animate: panelOpen }).catch(() => {});
      return;
    }
    applyRemoteState(message, { animate: panelOpen });
  }
}

function onMediaEvent(event) {
  if (paused) return;
  const el = event.target;
  if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) return;
  if (!event.isTrusted) return;
  if (
    event.type === "play" ||
    event.type === "loadedmetadata" ||
    event.type === "playing" ||
    event.type === "seeking" ||
    event.type === "seeked" ||
    event.type === "loadstart" ||
    event.type === "emptied"
  ) {
    if (event.type === "emptied" && !isPresentMedia(el)) {
      media.delete(el);
      afterMediaChange();
      return;
    }
    if (event.type === "seeking" || event.type === "seeked") return;
    track(el);
    if (event.type === "play" || event.type === "loadedmetadata") scheduleNativeSync();
    return;
  }
  if (event.type === "ratechange") {
    if (applying) return;
    track(el);
    const actual = el.playbackRate;
    if (Math.abs(actual - speed) <= 0.001) {
      return;
    }
    applyTo(el);
  }
}

function startMediaObserver() {
  if (mediaObserver) return;
  mediaObserver = new MutationObserver((mutations) => {
    if (host) {
      const parent = overlayParent();
      const fs = getFullscreenElement();
      if (!host.isConnected) placeHost();
      else if (parent && host.parentNode !== parent) placeHost();
      else if (fs && parent === fs && parent.lastElementChild !== host) placeHost();
    }
    if (paused) return;
    let changed = false;
    for (let i = 0; i < mutations.length; i++) {
      const mutation = mutations[i];
      const added = mutation.addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.tagName === "VIDEO" || node.tagName === "AUDIO") {
          if (track(node)) changed = true;
        } else if (node.querySelectorAll) {
          const list = node.querySelectorAll("video, audio");
          if (list.length) {
            for (let k = 0; k < list.length; k++) {
              if (track(list[k])) changed = true;
            }
          }
        }
      }
      const removed = mutation.removedNodes;
      for (let j = 0; j < removed.length; j++) {
        if (untrackRemoved(removed[j])) changed = true;
      }
    }
    if (changed) afterMediaChange();
  });
  if (document.documentElement) {
    mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
}

function notifyIdle() {
  const fn = idleHooks && idleHooks.onIdle;
  idleHooks = null;
  if (typeof fn === "function") {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function maybeIdle() {
  if (uiHold || tornDown || panelOpen) return;
  if (presentMediaCount() > 0 || tabHasMedia) return;
  teardown();
  notifyIdle();
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  if (paused) {
    if (panelOpen) refreshState({ animate: false }).catch(() => {});
    return;
  }
  if (presentMediaCount() > 0) announceMedia().catch(() => {});
  refreshState({ animate: false }).catch(() => {});
}

function onPageShow() {
  if (paused) {
    if (panelOpen) refreshState({ animate: false }).catch(() => {});
    return;
  }
  if (presentMediaCount() > 0) announceMedia().catch(() => {});
  refreshState({ animate: false }).catch(() => {});
}

function onPageHide(event) {
  if (event.persisted) return;
  teardown();
  notifyIdle();
}

function bindRuntimeKeys() {
  if (runtimeKeysBound) return;
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("keypress", onKeyPress, true);
  window.addEventListener("blur", onWindowBlur);
  runtimeKeysBound = true;
}

function unbindRuntimeKeys() {
  if (!runtimeKeysBound) return;
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("keyup", onKeyUp, true);
  window.removeEventListener("keypress", onKeyPress, true);
  window.removeEventListener("blur", onWindowBlur);
  runtimeKeysBound = false;
}

function bindSessionEvents() {
  if (sessionEventsBound) return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);
  sessionEventsBound = true;
}

function unbindSessionEvents() {
  if (!sessionEventsBound) return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pageshow", onPageShow);
  window.removeEventListener("pagehide", onPageHide);
  sessionEventsBound = false;
}

function bindUiEvents() {
  if (uiEventsBound || tornDown) return;
  window.addEventListener("pointermove", onSliderPointerMove, true);
  window.addEventListener("pointermove", onAppearancePointerMove, true);
  window.addEventListener("pointerup", endSliderDrag, true);
  window.addEventListener("pointercancel", endSliderDrag, true);
  window.addEventListener("pointerup", endAppearanceDrag, true);
  window.addEventListener("pointercancel", endAppearanceDrag, true);
  window.addEventListener("dragstart", preventAppearancePageDrag, true);
  window.addEventListener("selectstart", preventAppearancePageDrag, true);
  window.addEventListener("resize", syncOverlayLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncOverlayLayout);
    window.visualViewport.addEventListener("scroll", syncOverlayLayout);
  }
  for (let i = 0; i < FULLSCREEN_EVENTS.length; i++) {
    document.addEventListener(FULLSCREEN_EVENTS[i], onFullscreenChange);
  }
  document.addEventListener("webkitbeginfullscreen", onFullscreenChange, true);
  document.addEventListener("webkitendfullscreen", onFullscreenChange, true);
  if (window.matchMedia) {
    fullscreenMode = window.matchMedia("(display-mode: fullscreen)");
    onDisplayMode = () => placeHost({ restack: Boolean(getFullscreenElement()) });
    if (typeof fullscreenMode.addEventListener === "function") {
      fullscreenMode.addEventListener("change", onDisplayMode);
    } else if (typeof fullscreenMode.addListener === "function") {
      fullscreenMode.addListener(onDisplayMode);
    }
  }
  uiEventsBound = true;
}

function unbindUiEvents() {
  if (!uiEventsBound) return;
  window.removeEventListener("pointermove", onSliderPointerMove, true);
  window.removeEventListener("pointermove", onAppearancePointerMove, true);
  window.removeEventListener("pointerup", endSliderDrag, true);
  window.removeEventListener("pointercancel", endSliderDrag, true);
  window.removeEventListener("pointerup", endAppearanceDrag, true);
  window.removeEventListener("pointercancel", endAppearanceDrag, true);
  window.removeEventListener("dragstart", preventAppearancePageDrag, true);
  window.removeEventListener("selectstart", preventAppearancePageDrag, true);
  window.removeEventListener("resize", syncOverlayLayout);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener("resize", syncOverlayLayout);
    window.visualViewport.removeEventListener("scroll", syncOverlayLayout);
  }
  for (let i = 0; i < FULLSCREEN_EVENTS.length; i++) {
    document.removeEventListener(FULLSCREEN_EVENTS[i], onFullscreenChange);
  }
  document.removeEventListener("webkitbeginfullscreen", onFullscreenChange, true);
  document.removeEventListener("webkitendfullscreen", onFullscreenChange, true);
  if (fullscreenMode && onDisplayMode) {
    if (typeof fullscreenMode.removeEventListener === "function") {
      fullscreenMode.removeEventListener("change", onDisplayMode);
    } else if (typeof fullscreenMode.removeListener === "function") {
      fullscreenMode.removeListener(onDisplayMode);
    }
  }
  fullscreenMode = null;
  onDisplayMode = null;
  uiEventsBound = false;
}

function destroyOverlay() {
  clearTimeout(toastTimer);
  toastTimer = 0;
  bindOverlayOutside(false);
  bindOverlayWheel(false);
  stopOverlayScrollAnim();
  cancelSpeedUiAnim();
  cancelPowerAnim();
  unbindUiEvents();
  if (hostStyleObserver) {
    hostStyleObserver.disconnect();
    hostStyleObserver = null;
  }
  if (host) {
    closeHostSurface();
    if (host.parentNode) host.parentNode.removeChild(host);
  }
  const backdropStyle = document.getElementById("ps-host-backdrop");
  if (backdropStyle && backdropStyle.parentNode) backdropStyle.parentNode.removeChild(backdropStyle);
  host = null;
  shadow = null;
  els = {};
  sliderGesture = null;
  dragging = false;
  appearanceDragging = false;
  appearanceSliderEl = null;
  appearancePointerId = null;
}

function teardown() {
  if (tornDown) return;
  tornDown = true;
  started = false;
  panelOpen = false;
  settingsOpen = false;
  recording = null;
  tabHasMedia = false;
  if (activeStepperStop) activeStepperStop();
  stopWatchingMediaEvents();
  if (mediaObserver) {
    mediaObserver.disconnect();
    mediaObserver = null;
  }
  bindOverlayOutside(false);
  bindOverlayWheel(false);
  stopSpeedHold();
  cancelSpeedUiAnim();
  cancelPowerAnim();
  stopOverlayScrollAnim();
  clearTimeout(persistTimer);
  clearTimeout(toastTimer);
  clearTimeout(nativeSyncTimer);
  persistTimer = 0;
  toastTimer = 0;
  nativeSyncTimer = 0;
  unbindRuntimeKeys();
  unbindSessionEvents();
  unbindUiEvents();
  destroyOverlay();
  media.clear();
  retractMedia().catch(() => {});
}

let mediaEventsBound = false;

const MEDIA_EVENTS = [
  "play",
  "loadedmetadata",
  "playing",
  "seeking",
  "seeked",
  "loadstart",
  "emptied",
  "ratechange"
];

function stopWatchingMediaEvents() {
  if (!mediaEventsBound) return;
  for (let i = 0; i < MEDIA_EVENTS.length; i++) {
    document.removeEventListener(MEDIA_EVENTS[i], onMediaEvent, true);
  }
  mediaEventsBound = false;
}

function watchMediaEvents() {
  if (mediaEventsBound) return;
  for (let i = 0; i < MEDIA_EVENTS.length; i++) {
    document.addEventListener(MEDIA_EVENTS[i], onMediaEvent, true);
  }
  mediaEventsBound = true;
}

const api = {
  togglePanel,
  onMessage,
  setPaused(next) {
    applyPausedState(next === true, { animate: panelOpen });
  },
  onMedia() {
    if (tornDown || !started || paused) return;
    discover(document);
    afterMediaChange();
  }
};

export function start(reason, hooks) {
  if (hooks && typeof hooks.onIdle === "function") idleHooks = hooks;
  if (started && !tornDown) {
    if (reason === "media" && !paused) {
      discover(document);
      afterMediaChange();
    }
    return api;
  }
  tornDown = false;
  started = true;
  controllerGeneration += 1;
  mediaAnnouncement = null;
  mediaReannounce = false;
  paused = Boolean(hooks && hooks.paused);
  panelOpen = false;
  settingsOpen = false;
  announced = false;
  tabHasMedia = false;
  uiHold = reason === "tab";
  if (!paused) {
    watchMediaEvents();
    startMediaObserver();
    discover(document);
    if (presentMediaCount() > 0 || reason === "media") {
      announceMedia().catch(() => {});
    }
  }

  bindRuntimeKeys();
  bindSessionEvents();
  send({
    type: "GET_STATE",
    forgetTab: isTop && navigationWasReload()
  }).then((state) => {
    if (tornDown || !started) return;
    if (!state || state.error) return;
    applyRemoteState(state, { animate: false });
  });

  return api;
}
