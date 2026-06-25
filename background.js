// Handles extension icon clicks for the current tab.
chrome.action.onClicked.addListener(tab => {
  if (!tab.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    type: "rpg-text-overlay:toggle-transparent"
  }, response => {
    if (chrome.runtime.lastError || !response) {
      return;
    }
    setBadge(tab.id, response.enabled);
  });
});

// Updates the toolbar badge when a page reports its overlay state.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "rpg-text-overlay:transparent-state" || !sender.tab?.id) {
    return;
  }

  setBadge(sender.tab.id, Boolean(message.enabled));
});

// Shows or clears the ON badge for a tab.
function setBadge(tabId, enabled) {
  chrome.action.setBadgeText({
    tabId,
    text: enabled ? "ON" : ""
  });
  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#2f855a"
  });
}
