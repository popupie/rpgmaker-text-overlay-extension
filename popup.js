const DEFAULT_GUARD = {
  enabled: true,
  triggers: [],
};

const ui = {
  status: document.getElementById("status"),
  overlayToggle: document.getElementById("overlay-toggle"),
  showToggle: document.getElementById("show-toggle"),
  guardToggle: document.getElementById("guard-toggle"),
  guardChips: document.getElementById("guard-chips"),
  addKey: document.getElementById("add-key"),
  addKeyLabel: document.getElementById("add-key-label"),
};

let activeTabId = null;
let state = {
  overlayEnabled: false,
  showEnabled: false,
  guard: DEFAULT_GUARD,
};
let recording = false;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab && tab.id;
  if (!activeTabId) {
    setUnavailable();
    return;
  }

  try {
    const response = await sendToTab({ type: "rpg-text-overlay:get-state" });
    state = normalizeState(response);
    render();
  } catch (_error) {
    setUnavailable();
  }
}

ui.overlayToggle.addEventListener("change", async () => {
  await updateTab({ type: "rpg-text-overlay:set-overlay", enabled: ui.overlayToggle.checked });
});

ui.showToggle.addEventListener("change", async () => {
  await updateTab({ type: "rpg-text-overlay:set-show", enabled: ui.showToggle.checked });
});

ui.guardToggle.addEventListener("change", async () => {
  recording = false;
  await updateGuard({ ...state.guard, enabled: ui.guardToggle.checked });
});

ui.addKey.addEventListener("click", () => {
  if (!state.guard.enabled) {
    return;
  }
  recording = !recording;
  ui.addKey.focus();
  render();
});

ui.addKey.addEventListener("keydown", async (event) => {
  if (!recording) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.code === "Escape") {
    recording = false;
    render();
    return;
  }

  const chord = chordFromEvent(event);
  if (!chord) {
    return;
  }

  const triggers = state.guard.triggers.some((item) => sameChord(item, chord))
    ? state.guard.triggers
    : [...state.guard.triggers, chord];
  recording = false;
  await updateGuard({ ...state.guard, triggers });
});

async function updateTab(message) {
  try {
    const response = await sendToTab(message);
    state = normalizeState(response);
    render();
  } catch (_error) {
    setUnavailable();
  }
}

async function updateGuard(guard) {
  await updateTab({
    type: "rpg-text-overlay:set-guard",
    guard,
  });
}

function sendToTab(message) {
  return chrome.tabs.sendMessage(activeTabId, message);
}

function normalizeState(next) {
  const overlayEnabled = Boolean(next && next.overlayEnabled);
  return {
    overlayEnabled,
    showEnabled: overlayEnabled && Boolean(next && next.showEnabled),
    guard: normalizeGuard(next && next.guard),
  };
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

function chordFromEvent(event) {
  const modifierCode = ["AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"].includes(event.code);
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!hasModifier && modifierCode) {
    return null;
  }
  const chord = {
    code: modifierCode ? undefined : event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
  return {
    ...chord,
    label: chordLabel(chord),
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

function sameChord(a, b) {
  return (
    (a.code || "") === (b.code || "") &&
    Boolean(a.altKey) === Boolean(b.altKey) &&
    Boolean(a.ctrlKey) === Boolean(b.ctrlKey) &&
    Boolean(a.metaKey) === Boolean(b.metaKey) &&
    Boolean(a.shiftKey) === Boolean(b.shiftKey)
  );
}

function render() {
  const guardEnabled = state.guard.enabled;
  ui.status.textContent = state.overlayEnabled ? "On" : "Off";
  ui.status.className = state.overlayEnabled ? "status on" : "status";
  ui.overlayToggle.disabled = false;
  ui.overlayToggle.checked = state.overlayEnabled;
  ui.showToggle.disabled = !state.overlayEnabled;
  ui.showToggle.checked = state.showEnabled;
  ui.guardToggle.disabled = false;
  ui.guardToggle.checked = guardEnabled;
  if (!guardEnabled) recording = false;
  ui.addKey.disabled = !guardEnabled;
  ui.addKey.classList.toggle("recording", recording);
  ui.addKeyLabel.textContent = recording ? "Press key" : "Add key";
  ui.guardChips.classList.toggle("disabled", !guardEnabled);
  renderGuardChips();
}

function renderGuardChips() {
  ui.guardChips.textContent = "";
  ui.guardChips.hidden = state.guard.triggers.length === 0;
  for (const [index, trigger] of state.guard.triggers.entries()) {
    const chip = document.createElement("span");
    chip.className = "guard-chip";

    const label = document.createElement("span");
    label.textContent = trigger.label || chordLabel(trigger);
    chip.appendChild(label);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Remove key";
    remove.setAttribute("aria-label", `Remove ${label.textContent}`);
    remove.textContent = "x";
    remove.disabled = !state.guard.enabled;
    remove.addEventListener("click", async () => {
      if (!state.guard.enabled) {
        return;
      }
      const triggers = state.guard.triggers.filter((_, itemIndex) => itemIndex !== index);
      await updateGuard({ ...state.guard, triggers });
    });
    chip.appendChild(remove);

    ui.guardChips.appendChild(chip);
  }
}

function setUnavailable() {
  ui.status.textContent = "No page";
  ui.status.className = "status warn";
  ui.overlayToggle.disabled = true;
  ui.showToggle.disabled = true;
  ui.guardToggle.disabled = true;
  ui.addKey.disabled = true;
  ui.guardChips.textContent = "";
  ui.guardChips.hidden = true;
}
