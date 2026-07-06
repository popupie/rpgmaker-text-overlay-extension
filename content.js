(() => {
  if (document.documentElement.dataset.rpgTextOverlayInjected === "true") {
    return;
  }

  document.documentElement.dataset.rpgTextOverlayInjected = "true";

  const SETTINGS_EVENT = "rpg-text-overlay:set-settings";
  const RENDER_EVENT = "rpg-text-overlay:render";
  const GUARD_STORAGE_KEY = "rpg-text-overlay:guard";
  const DEFAULT_GUARD = {
    enabled: true,
    triggers: [],
  };
  const overlayState = {
    root: null,
    entries: new Map(),
  };

  function pageStorageKey(name) {
    return `rpg-text-overlay:${name}:${location.origin}${location.pathname}`;
  }

  function normalizeKeyChord(chord) {
    if (!chord || typeof chord !== "object") {
      return null;
    }
    const next = {
      code: typeof chord.code === "string" && chord.code ? chord.code : undefined,
      altKey: Boolean(chord.altKey),
      ctrlKey: Boolean(chord.ctrlKey),
      metaKey: Boolean(chord.metaKey),
      shiftKey: Boolean(chord.shiftKey),
      label: typeof chord.label === "string" && chord.label ? chord.label : "",
    };
    next.label = next.label || chordLabel(next);
    return next;
  }

  function normalizeGuard(guard) {
    const next = guard && typeof guard === "object" ? guard : DEFAULT_GUARD;
    const hasTriggers = Array.isArray(next.triggers);
    const triggers = hasTriggers ? next.triggers.map(normalizeKeyChord).filter(Boolean) : DEFAULT_GUARD.triggers;
    return {
      enabled: next.enabled !== false,
      triggers,
    };
  }

  function chordLabel(chord) {
    const parts = [];
    if (chord.ctrlKey) parts.push("Ctrl");
    if (chord.altKey) parts.push("Alt");
    if (chord.metaKey) parts.push("Meta");
    if (chord.shiftKey) parts.push("Shift");
    if (chord.code) parts.push(chord.code.replace(/^Key/, "").replace(/^Digit/, ""));
    return parts.join("+") || "Key";
  }

  function loadState(callback) {
    const overlayKey = pageStorageKey("overlay");
    const showKey = pageStorageKey("show");
    const legacyOverlayKey = `rpg-text-overlay:transparent:${location.origin}${location.pathname}`;
    chrome.storage.local.get([overlayKey, legacyOverlayKey, showKey, GUARD_STORAGE_KEY], (result) => {
      const overlayEnabled = result[overlayKey] === true || result[legacyOverlayKey] === true;
      callback({
        overlayEnabled,
        showEnabled: overlayEnabled && result[showKey] === true,
        guard: normalizeGuard(result[GUARD_STORAGE_KEY]),
      });
    });
  }

  function saveAndSendState(patch, callback) {
    loadState((current) => {
      const next = {
        ...current,
        ...patch,
        guard: patch.guard ? normalizeGuard(patch.guard) : current.guard,
      };
      if (!next.overlayEnabled) {
        next.showEnabled = false;
      }

      const payload = {
        [pageStorageKey("overlay")]: next.overlayEnabled,
        [pageStorageKey("show")]: next.showEnabled,
        [GUARD_STORAGE_KEY]: next.guard,
      };

      chrome.storage.local.set(payload, () => {
        sendState(next);
        if (callback) callback(next);
      });
    });
  }

  function sendState(state) {
    document.dispatchEvent(
      new CustomEvent(SETTINGS_EVENT, {
        detail: {
          overlayEnabled: Boolean(state.overlayEnabled),
          showEnabled: Boolean(state.overlayEnabled && state.showEnabled),
          guard: normalizeGuard(state.guard),
        },
      }),
    );
    chrome.runtime.sendMessage({
      type: "rpg-text-overlay:state",
      overlayEnabled: Boolean(state.overlayEnabled),
      showEnabled: Boolean(state.overlayEnabled && state.showEnabled),
      guard: normalizeGuard(state.guard),
    });
  }

  function ensureOverlayRoot() {
    if (overlayState.root) {
      return overlayState.root;
    }

    const root = document.createElement("div");
    root.id = "rpg-text-overlay-root";
    document.documentElement.appendChild(root);
    overlayState.root = root;
    return root;
  }

  function handleRenderEvent(event) {
    let payload = null;
    try {
      payload = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }

    renderOverlay(payload);
  }

  function renderOverlay(payload) {
    const root = ensureOverlayRoot();
    const active = Boolean(payload.active);
    const readable = Boolean(active && payload.readable);
    const reader = Boolean(active && payload.reader);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const seen = new Set();

    root.classList.toggle("rpg-text-overlay-active", active);
    root.classList.toggle("rpg-text-overlay-readable", readable);
    root.classList.toggle("rpg-text-overlay-reader", reader);

    if (!active) {
      clearOverlayEntries();
      return;
    }

    for (const entry of entries) {
      if (!entry || typeof entry.key !== "string") {
        continue;
      }
      seen.add(entry.key);
      renderOverlayEntry(root, entry);
    }

    for (const [key, element] of overlayState.entries) {
      if (!seen.has(key)) {
        element.remove();
        overlayState.entries.delete(key);
      }
    }
  }

  function renderOverlayEntry(root, entry) {
    let element = overlayState.entries.get(entry.key);
    if (!element) {
      element = document.createElement("span");
      element.className = "rpg-text-overlay-entry";
      root.appendChild(element);
      overlayState.entries.set(entry.key, element);
    }

    const text = typeof entry.text === "string" ? entry.text : "";
    if (element.textContent !== text) {
      element.textContent = text;
      element.setAttribute("aria-label", text);
      element.dataset.rpgText = text;
      element.removeAttribute("title");
    }

    setStyleIfChanged(element, "left", `${entry.left || 0}px`);
    setStyleIfChanged(element, "top", `${entry.top || 0}px`);
    setStyleIfChanged(element, "width", `${Math.max(1, entry.width || 1)}px`);
    setStyleIfChanged(element, "height", `${Math.max(1, entry.height || 1)}px`);
    setStyleIfChanged(element, "fontSize", `${Math.max(1, entry.fontSize || entry.height || 1)}px`);
    setStyleIfChanged(element, "fontFamily", entry.fontFace || "sans-serif");
    setStyleIfChanged(element, "lineHeight", `${Math.max(1, entry.height || 1)}px`);
  }

  function setStyleIfChanged(element, name, value) {
    if (element.style[name] !== value) {
      element.style[name] = value;
    }
  }

  function clearOverlayEntries() {
    for (const element of overlayState.entries.values()) {
      element.remove();
    }
    overlayState.entries.clear();
  }

  document.addEventListener(RENDER_EVENT, handleRenderEvent);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "rpg-text-overlay:get-state") {
      loadState((state) => {
        sendState(state);
        sendResponse(state);
      });
      return true;
    }

    if (message.type === "rpg-text-overlay:set-overlay") {
      saveAndSendState({ overlayEnabled: Boolean(message.enabled) }, sendResponse);
      return true;
    }

    if (message.type === "rpg-text-overlay:set-show") {
      saveAndSendState({ showEnabled: Boolean(message.enabled) }, sendResponse);
      return true;
    }

    if (message.type === "rpg-text-overlay:set-guard") {
      saveAndSendState({ guard: message.guard }, sendResponse);
      return true;
    }

    return false;
  });

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.async = false;
  script.onload = () => {
    loadState(sendState);
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
