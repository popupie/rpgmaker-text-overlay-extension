chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "rpg-text-overlay:state" || !sender.tab?.id) {
    return;
  }

  setBadge(sender.tab.id, Boolean(message.overlayEnabled));
});

function setBadge(tabId, enabled) {
  chrome.action.setBadgeText({
    tabId,
    text: enabled ? "ON" : "",
  });
  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#2f855a",
  });
}
