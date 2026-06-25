(() => {
  if (document.documentElement.dataset.rpgTextOverlayInjected === "true") {
    return;
  }

  document.documentElement.dataset.rpgTextOverlayInjected = "true";

  // Builds the per-page storage key for the transparent overlay switch.
  function pageStorageKey() {
    return `rpg-text-overlay:transparent:${location.origin}${location.pathname}`;
  }

  // Sends the saved transparent-mode state into the page script.
  function sendTransparentState(enabled) {
    document.dispatchEvent(
      new CustomEvent("rpg-text-overlay:set-transparent", {
        detail: { enabled: Boolean(enabled) },
      }),
    );
    chrome.runtime.sendMessage({
      type: "rpg-text-overlay:transparent-state",
      enabled: Boolean(enabled),
    });
  }

  // Loads whether this page should start with transparent text enabled.
  function loadTransparentState() {
    chrome.storage.local.get(pageStorageKey(), (result) => {
      sendTransparentState(result[pageStorageKey()] === true);
    });
  }

  // Toggles transparent mode when the extension icon is clicked.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "rpg-text-overlay:toggle-transparent") {
      return false;
    }

    const key = pageStorageKey();
    chrome.storage.local.get(key, (result) => {
      const enabled = result[key] !== true;
      chrome.storage.local.set({ [key]: enabled }, () => {
        sendTransparentState(enabled);
        sendResponse({ enabled });
      });
    });
    return true;
  });

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.async = false;
  script.onload = () => {
    loadTransparentState();
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
