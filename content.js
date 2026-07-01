(() => {
  if (document.documentElement.dataset.rpgTextOverlayInjected === "true") {
    return;
  }

  document.documentElement.dataset.rpgTextOverlayInjected = "true";

  const SETTINGS_EVENT = "rpg-text-overlay:set-settings";
  const GUARD_STORAGE_KEY = "rpg-text-overlay:guard";
  const DEFAULT_GUARD = {
    enabled: true,
    triggers: [],
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
