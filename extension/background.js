import { PlaybackSpeed } from "./shared/defaults.js";

const MESSAGE_TYPES = new Set([
  "MEDIA_IN_TAB",
  "MEDIA_GONE",
  "GET_STATE",
  "SET_SPEED",
  "SET_SCOPE",
  "SAVE_SETTINGS",
  "SET_PAUSED",
  "TOGGLE_OVERLAY_FROM_FRAME"
]);

const mediaFrames = new Map();
const messageHits = new Map();
let stateQueue = Promise.resolve();

function enqueueState(task) {
  const result = stateQueue.then(task, task);
  stateQueue = result.then(() => undefined, () => undefined);
  return result;
}

function enableActionGlobally() {
  chrome.action.enable().catch(() => {});
}

function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return "file";
    return parsed.hostname || "";
  } catch {
    return "";
  }
}

function hostnameFromSender(sender) {
  return hostnameFromUrl((sender && sender.url) || "");
}

function senderTabId(sender) {
  const tab = sender && sender.tab;
  return tab && tab.id != null ? tab.id : null;
}

function tooManyMessages(tabId) {
  const now = Date.now();
  const key = tabId == null ? "none" : String(tabId);
  let hits = messageHits.get(key) || [];
  hits = hits.filter((t) => now - t < 1000);
  if (hits.length >= 40) {
    messageHits.set(key, hits);
    return true;
  }
  hits.push(now);
  messageHits.set(key, hits);
  return false;
}

function rememberFrame(tabId, frameId, documentId) {
  let frames = mediaFrames.get(tabId);
  if (!frames) {
    frames = new Map();
    mediaFrames.set(tabId, frames);
  }
  frames.set(frameId, documentId || "");
}

function forgetFrame(tabId, frameId, documentId) {
  const frames = mediaFrames.get(tabId);
  if (!frames) return null;
  const currentDocumentId = frames.get(frameId);
  if (currentDocumentId === undefined) return false;
  if (documentId && currentDocumentId && documentId !== currentDocumentId) return false;
  frames.delete(frameId);
  if (!frames.size) {
    mediaFrames.delete(tabId);
    return true;
  }
  return false;
}

function forgetTabMedia(tabId) {
  mediaFrames.delete(tabId);
}

function broadcast(tabId, message) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function pingTop(tabId, message) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
}

function broadcastKnown(message, exceptTabId, session) {
  const known = session
    ? Object.keys(session.tabHosts || {}).map(Number).filter(Number.isFinite)
    : Array.from(mediaFrames.keys());
  for (const tabId of known) {
    if (tabId === exceptTabId) continue;
    broadcast(tabId, message);
  }
}

async function getSession() {
  return PlaybackSpeed.normalizeSession(await chrome.storage.session.get(null));
}

async function saveSession(session) {
  await chrome.storage.session.set({
    globalSpeed: session.globalSpeed,
    globalWrittenAt: session.globalWrittenAt || 0,
    siteOverrides: session.siteOverrides,
    siteWrittenAt: session.siteWrittenAt || {},
    tabOverrides: session.tabOverrides,
    tabScopes: session.tabScopes,
    tabTouched: session.tabTouched || {},
    tabHosts: session.tabHosts || {},
    preserveReloads: session.preserveReloads || {},
    lastActiveTabId: session.lastActiveTabId == null ? null : session.lastActiveTabId
  });
}

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return PlaybackSpeed.mergeSettings(data.settings);
}

async function getPaused() {
  const data = await chrome.storage.local.get("paused");
  return PlaybackSpeed.isPaused(data.paused);
}

function pruneTabCaches(session, { now = Date.now() } = {}) {
  const keys = new Set([
    ...Object.keys(session.tabOverrides),
    ...Object.keys(session.tabTouched)
  ]);
  for (const key of Object.keys(session.tabScopes)) {
    if (session.tabScopes[key] === "tab") keys.add(key);
  }

  let changed = false;
  for (const key of keys) {
    const hasOverride = session.tabOverrides[key] != null;
    const tabScoped = session.tabScopes[key] === "tab";
    if (!hasOverride && !tabScoped) {
      if (key in session.tabTouched) {
        delete session.tabTouched[key];
        changed = true;
      }
      continue;
    }
    const touched = Number(session.tabTouched[key]) || 0;
    const age = now - touched;
    if (age > PlaybackSpeed.TAB_CACHE_MS) {
      delete session.tabOverrides[key];
      delete session.tabTouched[key];
      if (tabScoped) delete session.tabScopes[key];
      changed = true;
    }
  }
  return changed;
}

async function loadPrunedSession() {
  const session = await getSession();
  const changed = pruneTabCaches(session);
  return { session, changed };
}

async function rememberHost(session, tabId, hostname) {
  if (tabId == null || !hostname) return false;
  if (PlaybackSpeed.isIgnoredHostname(hostname)) return false;
  const key = String(tabId);
  if (session.tabHosts[key] === hostname) return false;
  session.tabHosts[key] = hostname;
  return true;
}

async function requestTopHost(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "REQUEST_HOST" }, { frameId: 0 });
    return (reply && reply.hostname) || "";
  } catch {
    return "";
  }
}

function tabHostname(session, tabId, fallback) {
  const stored = tabId == null ? "" : session.tabHosts[String(tabId)];
  return stored || fallback || "";
}

async function buildState(tabId, hostname, primed) {
  const packed = primed || await loadPrunedSession();
  if (!primed && packed.changed) await saveSession(packed.session);
  const session = packed.session;
  const settings = await getSettings();
  const paused = await getPaused();
  const host = tabHostname(session, tabId, paused ? "" : hostname);
  return {
    tabId,
    speed: PlaybackSpeed.resolveSpeed(session, tabId, host),
    scope: PlaybackSpeed.effectiveScope(session, tabId, host),
    hostname: host,
    settings,
    paused
  };
}

function applyMessage(tabId, state, sourceFrameId) {
  if (!state || tabId == null) return;
  broadcast(tabId, {
    type: "APPLY_STATE",
    speed: state.speed,
    scope: state.scope,
    hostname: state.hostname,
    tabId: state.tabId,
    sourceFrameId
  });
}

async function forgetTabCache(tabId) {
  if (tabId == null) return false;
  const session = await getSession();
  const key = String(tabId);
  if (
    !(key in session.tabOverrides) &&
    !(key in session.tabScopes) &&
    !(key in session.tabTouched) &&
    !(key in session.tabHosts)
  ) {
    return false;
  }
  PlaybackSpeed.clearTabCache(session, tabId);
  await saveSession(session);
  return true;
}

async function markPreservedReload(tabId) {
  if (tabId == null) return;
  const session = await getSession();
  session.preserveReloads[String(tabId)] = true;
  await saveSession(session);
}

async function consumePreservedReload(tabId) {
  if (tabId == null) return false;
  const session = await getSession();
  const key = String(tabId);
  if (!session.preserveReloads[key]) return false;
  delete session.preserveReloads[key];
  await saveSession(session);
  return true;
}

async function setSpeedForTab(tabId, hostname, speed, scopeOverride, sourceFrameId) {
  if (tabId == null) return buildState(tabId, hostname);
  const packed = await loadPrunedSession();
  const session = packed.session;
  const paused = await getPaused();
  let host = tabHostname(session, tabId, !paused && sourceFrameId === 0 ? hostname : "");
  if (!host && !paused && sourceFrameId !== 0) {
    host = await requestTopHost(tabId);
    if (await rememberHost(session, tabId, host)) packed.changed = true;
  }
  const key = String(tabId);
  const requested = PlaybackSpeed.allowedScope(scopeOverride);
  if (scopeOverride === "tab" || scopeOverride === "site" || scopeOverride === "global") {
    session.tabScopes[key] = requested;
    if (requested !== "tab") PlaybackSpeed.dropTabOverride(session, tabId);
  }
  const scope = scopeOverride === "tab" || scopeOverride === "site" || scopeOverride === "global"
    ? requested
    : PlaybackSpeed.effectiveScope(session, tabId, host);
  if (scope === "site" && !host) return { error: "missing_host" };
  PlaybackSpeed.writeSpeed(session, tabId, host, scope, speed);
  await saveSession(session);
  const state = await buildState(tabId, host, { session, changed: false });
  applyMessage(tabId, state, sourceFrameId);
  if (scope === "global" || scope === "site") {
    broadcastKnown({
      type: "APPLY_STATE",
      speed: state.speed,
      scope: state.scope,
      reload: true
    }, tabId, session);
  }
  return state;
}

async function setScopeForTab(tabId, hostname, scope, sourceFrameId) {
  if (tabId == null) return buildState(tabId, hostname);
  const allowed = PlaybackSpeed.allowedScope(scope);
  const packed = await loadPrunedSession();
  const session = packed.session;
  const paused = await getPaused();
  let host = tabHostname(session, tabId, !paused && sourceFrameId === 0 ? hostname : "");
  if (!host && !paused && sourceFrameId !== 0) {
    host = await requestTopHost(tabId);
    if (await rememberHost(session, tabId, host)) packed.changed = true;
  }
  const current = PlaybackSpeed.resolveSpeed(session, tabId, host);
  if (allowed === "site" && !host) return { error: "missing_host" };
  PlaybackSpeed.setTabScope(session, tabId, host, allowed, current);

  await saveSession(session);
  const state = await buildState(tabId, host, { session, changed: false });
  applyMessage(tabId, state, sourceFrameId);
  broadcastKnown({ type: "APPLY_STATE", reload: true }, tabId, session);
  return state;
}

async function touchActivatedTab(tabId) {
  const now = Date.now();
  const session = await getSession();
  const prev = session.lastActiveTabId;
  let dirty = pruneTabCaches(session, { now });
  if (prev != null && prev !== tabId && session.tabOverrides[String(prev)] != null) {
    session.tabTouched[String(prev)] = now;
    dirty = true;
  }
  if (session.tabOverrides[String(tabId)] != null) {
    session.tabTouched[String(tabId)] = now;
    dirty = true;
  }
  if (Object.keys(session.tabOverrides).length && session.lastActiveTabId !== tabId) {
    session.lastActiveTabId = tabId;
    dirty = true;
  }
  if (dirty) await saveSession(session);
}

async function onMediaInTab(sender) {
  if (await getPaused()) return { ok: false, paused: true };
  const tabId = senderTabId(sender);
  if (tabId == null) return { ok: false };
  const frameId = sender.frameId == null ? 0 : sender.frameId;
  rememberFrame(tabId, frameId, sender.documentId);

  const session = await getSession();
  let host = frameId === 0 ? hostnameFromSender(sender) : session.tabHosts[String(tabId)] || "";
  if (!host && frameId !== 0) host = await requestTopHost(tabId);
  if (!host && frameId === 0) host = hostnameFromSender(sender);
  let dirty = pruneTabCaches(session);
  if (await rememberHost(session, tabId, host)) dirty = true;
  if (dirty) await saveSession(session);

  pingTop(tabId, { type: "TAB_HAS_MEDIA" });
  return { ok: true, hostname: host, tabId };
}

function onMediaGone(sender) {
  const tabId = senderTabId(sender);
  if (tabId == null) return { ok: false };
  const frameId = sender.frameId == null ? 0 : sender.frameId;
  const empty = forgetFrame(tabId, frameId, sender.documentId);
  if (empty === true) pingTop(tabId, { type: "TAB_MEDIA_CLEARED" });
  if (empty === null) {
    broadcast(tabId, { type: "MEDIA_STATUS_REQUEST" });
  }
  return { ok: true, empty };
}

function dropTab(tabId) {
  if (tabId == null) return;
  forgetTabMedia(tabId);
  messageHits.delete(String(tabId));
  enqueueState(() => forgetTabCache(tabId)).catch(() => {});
}

async function migrateTabCache(removedTabId, addedTabId) {
  const session = await getSession();
  const oldKey = String(removedTabId);
  const newKey = String(addedTabId);
  for (const field of [
    "tabOverrides",
    "tabScopes",
    "tabTouched",
    "tabHosts",
    "preserveReloads"
  ]) {
    if (Object.prototype.hasOwnProperty.call(session[field], oldKey)) {
      session[field][newKey] = session[field][oldKey];
    }
  }
  if (session.lastActiveTabId === removedTabId) session.lastActiveTabId = addedTabId;
  PlaybackSpeed.clearTabCache(session, removedTabId);
  await saveSession(session);
}

chrome.runtime.onInstalled.addListener(enableActionGlobally);
chrome.runtime.onStartup.addListener(enableActionGlobally);
enableActionGlobally();

chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY", source: "action" }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  dropTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  forgetTabMedia(removedTabId);
  messageHits.delete(String(removedTabId));
  enqueueState(async () => {
    await migrateTabCache(removedTabId, addedTabId);
    broadcast(addedTabId, { type: "MEDIA_STATUS_REQUEST" });
  }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueueState(() => touchActivatedTab(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.discarded === true) {
    forgetTabMedia(tabId);
    enqueueState(() => markPreservedReload(tabId)).catch(() => {});
    return;
  }
  if (changeInfo.frozen === true) {
    forgetTabMedia(tabId);
    return;
  }
  if (changeInfo.status === "loading") {
    forgetTabMedia(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = senderTabId(sender);
  const frameId = sender.frameId == null ? 0 : sender.frameId;
  const type = message && message.type;
  if (!type || !MESSAGE_TYPES.has(type)) {
    sendResponse({ error: "unknown_message" });
    return;
  }
  if (tabId == null) {
    sendResponse({ error: "no_tab" });
    return;
  }
  if (tooManyMessages(tabId)) {
    sendResponse({ error: "rate_limited" });
    return;
  }

  const senderHost = hostnameFromSender(sender);
  if (PlaybackSpeed.isIgnoredHostname(senderHost)) {
    sendResponse({ error: "ignored_host" });
    return;
  }

  const task = enqueueState(async () => {
    const paused = await getPaused();
    if (!paused && type !== "MEDIA_GONE" && message.hasMedia === true) {
      rememberFrame(tabId, frameId, sender.documentId);
    }
    switch (type) {
      case "MEDIA_IN_TAB":
        return onMediaInTab(sender);
      case "MEDIA_GONE":
        return onMediaGone(sender);
      case "GET_STATE": {
        const preservedReload = frameId === 0
          ? await consumePreservedReload(tabId)
          : false;
        if (message.forgetTab && frameId === 0 && !preservedReload) {
          await forgetTabCache(tabId);
        }
        const packed = await loadPrunedSession();
        if (!paused && frameId === 0) {
          const host = hostnameFromSender(sender);
          if (await rememberHost(packed.session, tabId, host) || packed.changed) {
            await saveSession(packed.session);
            packed.changed = false;
          }
        } else if (packed.changed) {
          await saveSession(packed.session);
          packed.changed = false;
        }
        let host = "";
        if (!paused) {
          host = frameId === 0 ? senderHost : tabHostname(packed.session, tabId, "");
          if (!host && frameId !== 0) {
            host = await requestTopHost(tabId);
            if (await rememberHost(packed.session, tabId, host)) {
              await saveSession(packed.session);
            }
          }
        }
        const state = await buildState(tabId, host, packed);
        if (message.forgetTab && frameId === 0) applyMessage(tabId, state, frameId);
        return state;
      }
      case "SET_SPEED":
        return setSpeedForTab(
          tabId,
          senderHost,
          message.speed,
          message.scope,
          frameId
        );
      case "SET_SCOPE":
        return setScopeForTab(tabId, senderHost, message.scope, frameId);
      case "SAVE_SETTINGS": {
        const settings = PlaybackSpeed.mergeSettings(message.settings);
        await chrome.storage.local.set({ settings });
        return { settings };
      }
      case "SET_PAUSED": {
        const nextPaused = message.paused === true;
        await chrome.storage.local.set({ paused: nextPaused });
        if (nextPaused) mediaFrames.clear();
        return { paused: nextPaused };
      }
      case "TOGGLE_OVERLAY_FROM_FRAME":
        pingTop(tabId, { type: "TOGGLE_OVERLAY", source: "hotkey" });
        return { ok: true };
      default:
        return { error: "unknown_message" };
    }
  });

  task.then(sendResponse).catch((err) => {
    sendResponse({ error: String(err && err.message ? err.message : err) });
  });
  return true;
});
