/* Shared defaults for the service worker and isolated controller. */
export const PlaybackSpeed = {
  MIN: 0.25,
  MAX: 5,
  MAX_PRESETS: 12,
  DEFAULT_RATE: 1,
  TAB_CACHE_MS: 30 * 60 * 1000,

  isIgnoredHostname(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return host === "spotify.com" || host.endsWith(".spotify.com");
  },

  DEFAULT_SETTINGS: {
    toggleCombo: { keys: ["alt", "x"] },
    speedDownOpen: { keys: ["z"] },
    speedUpOpen: { keys: ["c"] },
    speedDownClosed: { keys: [] },
    speedUpClosed: { keys: [] },
    increment: 0.25,
    panelOpacity: 0.9,
    panelHue: 220,
    presets: [
      { id: "p1", speed: 0.5, keys: ["1"] },
      { id: "p2", speed: 1, keys: ["2"] },
      { id: "p3", speed: 1.25, keys: ["3"] },
      { id: "p4", speed: 1.5, keys: ["4"] },
      { id: "p5", speed: 2, keys: ["5"] },
      { id: "p6", speed: 2.5, keys: ["6"] }
    ]
  },

  clampRate(n) {
    const x = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(x)) return PlaybackSpeed.DEFAULT_RATE;
    return Math.min(PlaybackSpeed.MAX, Math.max(PlaybackSpeed.MIN, x));
  },

  formatRate(n) {
    return PlaybackSpeed.clampRate(n).toFixed(2);
  },

  clampIncrement(n) {
    const x = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(x)) return 0.25;
    return Math.min(1, Math.max(0.01, x));
  },

  stepRate(current, dir, increment) {
    const fromCents = Math.round(PlaybackSpeed.clampRate(current) * 100);
    const stepCents = Math.round(PlaybackSpeed.clampIncrement(increment) * 100);
    const minCents = Math.round(PlaybackSpeed.MIN * 100);
    const maxCents = Math.round(PlaybackSpeed.MAX * 100);
    const sign = dir < 0 ? -1 : 1;
    const nextCents = Math.min(maxCents, Math.max(minCents, fromCents + sign * stepCents));
    return nextCents / 100;
  },

  clampHue(n) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return 220;
    const wrapped = ((x % 360) + 360) % 360;
    return wrapped;
  },

  clampOpacity(n) {
    const x = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(x)) return 0.9;
    return Math.min(1, Math.max(0.5, x));
  },

  isPaused(value) {
    return value === true;
  },

  normalizeKey(key) {
    if (key == null || key === "") return "";
    let k = String(key).toLowerCase();
    if (k === " ") k = "space";
    if (k === "control") k = "ctrl";
    return k;
  },

  canonicalKeys(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const key = PlaybackSpeed.normalizeKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length === 3) break;
    }
    return out;
  },

  comboKeys(combo) {
    if (!combo || typeof combo !== "object") return [];
    if (Array.isArray(combo.keys)) return PlaybackSpeed.canonicalKeys(combo.keys);
    const keys = [];
    if (combo.ctrl) keys.push("ctrl");
    if (combo.alt) keys.push("alt");
    if (combo.shift) keys.push("shift");
    if (combo.meta) keys.push("meta");
    const key = PlaybackSpeed.normalizeKey(combo.key || "");
    if (key && !keys.includes(key)) keys.push(key);
    return PlaybackSpeed.canonicalKeys(keys);
  },

  comboSignature(combo) {
    const keys = PlaybackSpeed.comboKeys(combo);
    if (!keys.length) return "";
    return keys.slice().sort().join("+");
  },

  emptyCombo() {
    return { keys: [] };
  },

  asCombo(value, fallbackKey) {
    if (value && typeof value === "object") {
      return { keys: PlaybackSpeed.comboKeys(value) };
    }
    if (typeof value === "string" && value) {
      return { keys: PlaybackSpeed.canonicalKeys([value]) };
    }
    const fallback = PlaybackSpeed.normalizeKey(fallbackKey || "");
    return fallback ? { keys: [fallback] } : PlaybackSpeed.emptyCombo();
  },

  formatCombo(combo) {
    const keys = PlaybackSpeed.comboKeys(combo);
    if (!keys.length) return "Not Set";
    return keys.map((key) => PlaybackSpeed.formatKeyLabel(key)).join(" + ");
  },

  formatKeyLabel(key) {
    if (!key) return "Not Set";
    const k = PlaybackSpeed.normalizeKey(key);
    const labels = {
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      meta: "Meta",
      space: "Space",
      escape: "Esc",
      enter: "Enter",
      tab: "Tab",
      backspace: "Backspace",
      delete: "Delete",
      arrowup: "Up",
      arrowdown: "Down",
      arrowleft: "Left",
      arrowright: "Right"
    };
    if (labels[k]) return labels[k];
    if (k.length === 1) return k.toUpperCase();
    return k.charAt(0).toUpperCase() + k.slice(1);
  },

  asObject(value) {
    return value && typeof value === "object" ? value : {};
  },

  normalizeSession(data) {
    const src = data && typeof data === "object" ? data : {};
    const tabOverrides = PlaybackSpeed.asObject(src.tabOverrides);
    const tabTouched = PlaybackSpeed.asObject(src.tabTouched);
    const now = Date.now();
    for (const key of Object.keys(tabOverrides)) {
      if (tabTouched[key] == null) tabTouched[key] = now;
    }
    return {
      globalSpeed: PlaybackSpeed.clampRate(
        src.globalSpeed == null ? PlaybackSpeed.DEFAULT_RATE : src.globalSpeed
      ),
      globalWrittenAt: Number(src.globalWrittenAt) || 0,
      siteOverrides: PlaybackSpeed.asObject(src.siteOverrides),
      siteWrittenAt: PlaybackSpeed.asObject(src.siteWrittenAt),
      tabOverrides,
      tabScopes: PlaybackSpeed.asObject(src.tabScopes),
      tabTouched,
      tabHosts: PlaybackSpeed.asObject(src.tabHosts),
      preserveReloads: PlaybackSpeed.asObject(src.preserveReloads),
      lastActiveTabId: src.lastActiveTabId == null ? null : src.lastActiveTabId
    };
  },

  allowedScope(scope) {
    return scope === "tab" || scope === "site" ? scope : "global";
  },

  primaryScope(session, hostname) {
    if (hostname && session.siteOverrides[hostname] != null) return "site";
    return "global";
  },

  dropTabOverride(session, tabId) {
    const tabKey = tabId == null ? "" : String(tabId);
    if (!tabKey) return session;
    delete session.tabOverrides[tabKey];
    delete session.tabTouched[tabKey];
    return session;
  },

  syncHostTabs(session, hostname, scope, exceptTabId) {
    if (!hostname || (scope !== "site" && scope !== "global")) return session;
    const except = exceptTabId == null ? "" : String(exceptTabId);
    const hosts = session.tabHosts || {};
    const keys = new Set([
      ...Object.keys(hosts),
      ...Object.keys(session.tabScopes || {})
    ]);
    for (const key of keys) {
      if (key === except) continue;
      if ((hosts[key] || "") !== hostname) continue;
      if (session.tabOverrides[key] != null) continue;
      session.tabScopes[key] = scope;
    }
    return session;
  },

  clearSiteOverride(session, hostname) {
    if (!hostname) return session;
    delete session.siteOverrides[hostname];
    delete session.siteWrittenAt[hostname];
    PlaybackSpeed.syncHostTabs(session, hostname, "global");
    return session;
  },

  effectiveScope(session, tabId, hostname) {
    const tabKey = tabId == null ? "" : String(tabId);
    if (tabKey && session.tabOverrides[tabKey] != null) return "tab";
    return PlaybackSpeed.primaryScope(session, hostname);
  },

  resolveSpeed(session, tabId, hostname) {
    const scope = PlaybackSpeed.effectiveScope(session, tabId, hostname);
    const tabKey = tabId == null ? "" : String(tabId);
    if (scope === "tab" && tabKey && session.tabOverrides[tabKey] != null) {
      return PlaybackSpeed.clampRate(session.tabOverrides[tabKey]);
    }
    if (scope === "site" && hostname && session.siteOverrides[hostname] != null) {
      return PlaybackSpeed.clampRate(session.siteOverrides[hostname]);
    }
    return PlaybackSpeed.clampRate(session.globalSpeed);
  },

  touchTab(session, tabId, at) {
    const tabKey = tabId == null ? "" : String(tabId);
    if (!tabKey) return session;
    session.tabTouched[tabKey] = at || Date.now();
    return session;
  },

  rememberTabSpeed(session, tabId, speed) {
    const tabKey = tabId == null ? "" : String(tabId);
    if (!tabKey || session.tabOverrides[tabKey] != null) return session;
    session.tabOverrides[tabKey] = PlaybackSpeed.clampRate(speed);
    session.tabScopes[tabKey] = "tab";
    session.tabTouched[tabKey] = Date.now();
    return session;
  },

  clearTabCache(session, tabId) {
    const tabKey = String(tabId);
    delete session.tabOverrides[tabKey];
    delete session.tabScopes[tabKey];
    delete session.tabTouched[tabKey];
    delete session.tabHosts[tabKey];
    delete session.preserveReloads[tabKey];
    return session;
  },

  knownTabs(session) {
    const ids = new Set([
      ...Object.keys(session.tabOverrides),
      ...Object.keys(session.tabScopes),
      ...Object.keys(session.tabTouched),
      ...Object.keys(session.tabHosts || {})
    ]);
    const out = [];
    for (const key of ids) {
      const id = Number(key);
      if (!Number.isFinite(id)) continue;
      out.push({
        id,
        hostname: (session.tabHosts && session.tabHosts[key]) || ""
      });
    }
    return out;
  },

  writeSpeed(session, tabId, hostname, scope, speed) {
    const tabKey = tabId == null ? "" : String(tabId);
    const next = PlaybackSpeed.clampRate(speed);
    const now = Date.now();
    if (scope === "tab" && tabKey) {
      session.tabOverrides[tabKey] = next;
      session.tabScopes[tabKey] = "tab";
      session.tabTouched[tabKey] = now;
    } else if (scope === "site" && hostname) {
      PlaybackSpeed.dropTabOverride(session, tabId);
      session.siteOverrides[hostname] = next;
      session.siteWrittenAt[hostname] = now;
      if (tabKey) session.tabScopes[tabKey] = "site";
      PlaybackSpeed.syncHostTabs(session, hostname, "site", tabId);
    } else {
      PlaybackSpeed.dropTabOverride(session, tabId);
      session.globalSpeed = next;
      session.globalWrittenAt = now;
      if (tabKey) session.tabScopes[tabKey] = "global";
    }
    return session;
  },

  setTabScope(session, tabId, hostname, scope, currentSpeed) {
    const allowed = PlaybackSpeed.allowedScope(scope);
    const tabKey = tabId == null ? "" : String(tabId);
    const current = PlaybackSpeed.clampRate(currentSpeed);
    if (allowed === "tab") {
      if (tabKey && session.tabOverrides[tabKey] == null) {
        session.tabOverrides[tabKey] = current;
      }
      if (tabKey) {
        session.tabScopes[tabKey] = "tab";
        session.tabTouched[tabKey] = Date.now();
      }
    } else if (allowed === "site") {
      PlaybackSpeed.dropTabOverride(session, tabId);
      if (hostname && session.siteOverrides[hostname] == null) {
        session.siteOverrides[hostname] = current;
        session.siteWrittenAt[hostname] = Date.now();
      }
      if (tabKey) session.tabScopes[tabKey] = "site";
      PlaybackSpeed.syncHostTabs(session, hostname, "site", tabId);
    } else {
      PlaybackSpeed.dropTabOverride(session, tabId);
      if (tabKey) session.tabScopes[tabKey] = "global";
      PlaybackSpeed.clearSiteOverride(session, hostname);
    }
    return session;
  },

  mergePresets(saved) {
    if (!Array.isArray(saved)) return structuredClone(PlaybackSpeed.DEFAULT_SETTINGS.presets);
    const used = new Set();
    return saved.slice(0, PlaybackSpeed.MAX_PRESETS).map((p, i) => {
      let id = p && typeof p.id === "string" && p.id ? p.id : `p${i + 1}`;
      let suffix = i + 1;
      while (used.has(id)) id = `p${++suffix}`;
      used.add(id);
      return {
        id,
        speed: PlaybackSpeed.clampRate(p && p.speed),
        keys: PlaybackSpeed.asCombo(
          p && (p.keys != null ? { keys: p.keys } : p.combo != null ? p.combo : p.key),
          ""
        ).keys
      };
    });
  },

  mergeSettings(saved) {
    const base = PlaybackSpeed.DEFAULT_SETTINGS;
    if (!saved || typeof saved !== "object") {
      return structuredClone(base);
    }
    return {
      toggleCombo: saved.toggleCombo === undefined
        ? structuredClone(base.toggleCombo)
        : PlaybackSpeed.asCombo(saved.toggleCombo, ""),
      speedDownOpen: saved.speedDownOpen != null || saved.speedDownKey != null
        ? PlaybackSpeed.asCombo(
            saved.speedDownOpen != null ? saved.speedDownOpen : saved.speedDownKey,
            ""
          )
        : structuredClone(base.speedDownOpen),
      speedUpOpen: saved.speedUpOpen != null || saved.speedUpKey != null
        ? PlaybackSpeed.asCombo(
            saved.speedUpOpen != null ? saved.speedUpOpen : saved.speedUpKey,
            ""
          )
        : structuredClone(base.speedUpOpen),
      speedDownClosed: PlaybackSpeed.asCombo(saved.speedDownClosed, ""),
      speedUpClosed: PlaybackSpeed.asCombo(saved.speedUpClosed, ""),
      increment: PlaybackSpeed.clampIncrement(saved.increment),
      panelOpacity: saved.panelOpacity == null
        ? base.panelOpacity
        : PlaybackSpeed.clampOpacity(saved.panelOpacity),
      panelHue: saved.panelHue == null
        ? base.panelHue
        : PlaybackSpeed.clampHue(saved.panelHue),
      presets: PlaybackSpeed.mergePresets(saved.presets)
    };
  }
};
