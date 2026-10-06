(() => {
  const isTop = window === window.top;
  let loading = null;
  let api = null;
  let observing = false;
  let observer = null;
  let paused = true;
  let pauseReady = false;

  function runtimeOk() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
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

  function scan(root) {
    if (paused || !root || !observing) return false;
    if (hasMediaSource(root)) return true;
    if (root.querySelectorAll) {
      const list = root.querySelectorAll("video, audio");
      for (let i = 0; i < list.length; i++) {
        if (hasMediaSource(list[i])) return true;
      }
    }
    if (root.shadowRoot && scan(root.shadowRoot)) return true;
    return false;
  }

  function stopWatching() {
    observing = false;
    document.removeEventListener("play", onMediaEvent, true);
    document.removeEventListener("loadedmetadata", onMediaEvent, true);
    document.removeEventListener("loadstart", onMediaEvent, true);
    if (observer) observer.disconnect();
  }

  function controllerUrl() {
    return chrome.runtime.getURL("content/controller.js");
  }

  function releaseController() {
    api = null;
    loading = null;
    observing = false;
    if (paused) return;
    watch();
  }

  function loadController(reason) {
    if (paused && reason !== "tab") return Promise.resolve(null);
    if (api) return Promise.resolve(api);
    if (loading) return loading;
    if (!runtimeOk()) return Promise.resolve(null);
    stopWatching();
    loading = import(controllerUrl())
      .then((mod) => {
        api = mod.start(reason || "media", { onIdle: releaseController, paused });
        return api;
      })
      .catch((err) => {
        loading = null;
        observing = false;
        if (!paused) watch();
        console.warn("[Rapidplay] controller failed to load", err);
        return null;
      });
    return loading;
  }

  function onMediaEvent(event) {
    if (paused) return;
    const el = event.target;
    if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) return;
    if (!event.isTrusted || !isMediaElement(el)) return;
    loadController("media");
  }

  function watch() {
    if (paused || observing) return;
    observing = true;
    document.addEventListener("play", onMediaEvent, true);
    document.addEventListener("loadedmetadata", onMediaEvent, true);
    document.addEventListener("loadstart", onMediaEvent, true);
    if (!observer) {
      observer = new MutationObserver((mutations) => {
        if (paused || !observing) return;
        for (let i = 0; i < mutations.length; i++) {
          const added = mutations[i].addedNodes;
          for (let j = 0; j < added.length; j++) {
            if (scan(added[j])) {
              loadController("media");
              return;
            }
          }
        }
      });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (scan(document)) loadController("media");
  }

  function applyPaused(next) {
    const value = next === true;
    if (paused === value && pauseReady) {
      if (api && typeof api.setPaused === "function") api.setPaused(value);
      return;
    }
    paused = value;
    if (value) {
      stopWatching();
      if (api && typeof api.setPaused === "function") api.setPaused(true);
      return;
    }
    if (api && typeof api.setPaused === "function") {
      api.setPaused(false);
      return;
    }
    watch();
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !changes.paused) return;
    applyPaused(changes.paused.newValue === true);
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return;
      if (message.type === "REQUEST_HOST") {
        sendResponse({ hostname: paused ? "" : (location.hostname || "") });
        return;
      }
      if (message.type === "TAB_HAS_MEDIA" && isTop) {
        if (paused) return;
        loadController("media").then((next) => {
          if (next && typeof next.onMessage === "function") next.onMessage(message);
        });
        return;
      }
      if (message.type === "TAB_MEDIA_CLEARED") {
        if (api && typeof api.onMessage === "function") api.onMessage(message);
        else if (loading) {
          loading.then((next) => {
            if (next && typeof next.onMessage === "function") next.onMessage(message);
          });
        }
        return;
      }
      if (message.type === "TOGGLE_OVERLAY") {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        const nested = Boolean(
          fs && /^(IFRAME|FRAME|OBJECT|EMBED)$/i.test(fs.tagName || "")
        );
        let iframeIsFs = false;
        if (!isTop && !fs) {
          try {
            iframeIsFs = Boolean(
              window.frameElement &&
              parent.document &&
              (parent.document.fullscreenElement === window.frameElement ||
                parent.document.webkitFullscreenElement === window.frameElement)
            );
          } catch {
            iframeIsFs = false;
          }
        }
        if (isTop && nested) return;
        if (!isTop && !fs && !iframeIsFs) return;
        if (!isTop && nested) return;
        loadController("tab").then((next) => {
          if (next && typeof next.togglePanel === "function") {
            next.togglePanel(message.source || "action");
          }
        });
        return;
      }
      if (message.type === "MEDIA_STATUS_REQUEST") {
        if (paused) return;
        if (api && typeof api.onMessage === "function") {
          api.onMessage(message);
        } else if (loading) {
          loading.then((next) => {
            if (next && typeof next.onMessage === "function") next.onMessage(message);
          });
        } else if (scan(document)) {
          loadController("media");
        }
        return;
      }
      if (api && typeof api.onMessage === "function") {
        api.onMessage(message);
        return;
      }
      if (message.type === "APPLY_STATE" && loading) {
        loading.then((next) => {
          if (next && typeof next.onMessage === "function") next.onMessage(message);
        });
      }
    });
  } catch {
    /* extension context invalidated */
  }

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {
    /* extension context invalidated */
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get("paused");
      paused = data.paused === true;
    } catch {
      paused = false;
    }
    pauseReady = true;
    if (!paused) watch();
  }

  init();
})();
