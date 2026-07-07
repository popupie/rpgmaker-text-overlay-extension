(() => {
  if (window.__rpgMakerTextOverlayInstalled) {
    return;
  }

  window.__rpgMakerTextOverlayInstalled = true;

  const OWNER_ID = "__rpgTextOverlayOwnerId";
  const SETTINGS_EVENT = "rpg-text-overlay:set-settings";
  const RENDER_EVENT = "rpg-text-overlay:render";
  const DEFAULT_GUARD = {
    enabled: true,
    triggers: [],
  };
  const state = {
    active: false,
    readerMode: false,
    enabledForPage: false,
    guard: DEFAULT_GUARD,
    consumedGuardKeyCodes: new Set(),
    nextOwnerId: 1,
    bitmapOwners: new WeakMap(),
    entries: new Map(),
    lineGroups: new Map(),
    raf: 0,
    installedHooks: false,
    inputGuardInstalled: false,
  };

  function setSettings(settings) {
    state.enabledForPage = Boolean(settings && settings.overlayEnabled);
    state.active = Boolean(state.enabledForPage && settings && settings.showEnabled);
    state.readerMode = state.enabledForPage;
    const nextGuard = normalizeGuard(settings && settings.guard);
    state.guard = nextGuard;
    if (!state.enabledForPage) {
      state.readerMode = false;
      state.active = false;
      clearGuardState();
    } else if (!nextGuard.enabled || !nextGuard.triggers.length) {
      clearGuardState();
    }
    scheduleFlush();
  }

  function overlayIsActive() {
    return state.enabledForPage;
  }

  document.addEventListener(SETTINGS_EVENT, (event) => {
    setSettings(event.detail || {});
  });

  for (const type of ["keydown", "keypress", "keyup"]) {
    window.addEventListener(type, handleDictionaryGuardKeyEvent, true);
  }
  window.addEventListener("blur", clearGuardState, true);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "visible") {
        clearGuardState();
      }
    },
    true,
  );

  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend"]) {
    window.addEventListener(type, consumeOverlayTextPointerEvent, true);
    window.addEventListener(type, restoreGameFocusAfterSurfacePointer, true);
  }

  function overlayTextEntry(target) {
    return target instanceof Element ? target.closest(".rpg-text-overlay-entry") : null;
  }

  function consumeOverlayTextPointerEvent(event) {
    if (!overlayTextEntry(event.target)) {
      return;
    }
    event.stopPropagation();
  }

  function restoreGameFocusAfterSurfacePointer(event) {
    if (overlayTextEntry(event.target) || !eventTargetsGameSurface(event.target)) {
      return;
    }
    if (!["pointerup", "mouseup", "click", "touchend"].includes(event.type)) {
      return;
    }
    window.setTimeout(focusGameTarget, 0);
  }

  function eventTargetsGameSurface(target) {
    if (target === document || target === document.body || target === document.documentElement) {
      return true;
    }
    return target instanceof Element && Boolean(target.closest("canvas, video"));
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
    return {
      code: typeof chord.code === "string" && chord.code ? chord.code : undefined,
      altKey: Boolean(chord.altKey),
      ctrlKey: Boolean(chord.ctrlKey),
      metaKey: Boolean(chord.metaKey),
      shiftKey: Boolean(chord.shiftKey),
      label: typeof chord.label === "string" && chord.label ? chord.label : "Key",
    };
  }

  function dictionaryGuardActive() {
    return Boolean(state.enabledForPage && state.guard && state.guard.enabled && state.guard.triggers.length);
  }

  function handleDictionaryGuardKeyEvent(event) {
    if (event.code === "Escape") {
      clearGuardState();
      return;
    }
    maybeConsumeDictionaryDismissKeyEvent(event);
  }

  function maybeConsumeDictionaryDismissKeyEvent(event) {
    if (event.type === "keyup" && state.consumedGuardKeyCodes.has(event.code)) {
      state.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (event.type === "keyup" && guardReleaseMatchesKeyEvent(event)) {
      state.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (!dictionaryGuardActive()) {
      return false;
    }
    const match = state.guard.triggers.find((trigger) => guardTriggerMatchesKeyEvent(event, trigger));
    if (!match) {
      return false;
    }
    releaseRpgMakerInputState(event);
    consumeEvent(event);
    if (event.type === "keydown") {
      state.consumedGuardKeyCodes.add(event.code);
    }
    if (event.type === "keyup") {
      state.consumedGuardKeyCodes.delete(event.code);
    }
    return true;
  }

  function guardReleaseMatchesKeyEvent(event) {
    if (!state.guard || !state.guard.enabled || !state.guard.triggers.length) {
      return false;
    }
    return state.guard.triggers.some((trigger) => {
      if (trigger.code) {
        return event.code === trigger.code;
      }
      return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
    });
  }

  function guardTriggerMatchesKeyEvent(event, trigger) {
    if (!exactModifierMatch(event, trigger)) {
      return false;
    }
    if (trigger.code) {
      return event.code === trigger.code;
    }
    return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
  }

  function modifierOnlyTriggerMatchesEventCode(code, trigger) {
    return (
      (trigger.altKey && (code === "AltLeft" || code === "AltRight")) ||
      (trigger.ctrlKey && (code === "ControlLeft" || code === "ControlRight")) ||
      (trigger.metaKey && (code === "MetaLeft" || code === "MetaRight")) ||
      (trigger.shiftKey && (code === "ShiftLeft" || code === "ShiftRight"))
    );
  }

  function installDictionaryGuardInputHooks() {
    if (state.inputGuardInstalled) {
      return;
    }

    const input = window.Input;
    if (!input || typeof input._onKeyDown !== "function" || typeof input._onKeyUp !== "function") {
      setTimeout(installDictionaryGuardInputHooks, 250);
      return;
    }

    state.inputGuardInstalled = true;
    const originalKeyDown = input._onKeyDown;
    const originalKeyUp = input._onKeyUp;

    input._onKeyDown = function (event) {
      if (dictionaryGuardInputShouldBlock(event)) {
        state.consumedGuardKeyCodes.add(event.code);
        releaseRpgMakerInputState(event);
        consumeEvent(event);
        return;
      }
      return originalKeyDown.apply(this, arguments);
    };

    input._onKeyUp = function (event) {
      if (state.consumedGuardKeyCodes.has(event.code) || dictionaryGuardInputShouldBlock(event)) {
        state.consumedGuardKeyCodes.delete(event.code);
        releaseRpgMakerInputState(event);
        consumeEvent(event);
        return;
      }
      return originalKeyUp.apply(this, arguments);
    };
  }

  function dictionaryGuardInputShouldBlock(event) {
    if (!dictionaryGuardActive()) {
      return false;
    }
    return state.guard.triggers.some((trigger) => guardTriggerMatchesKeyEvent(event, trigger));
  }

  function releaseRpgMakerInputState(event) {
    const input = window.Input;
    const keyName = input?.keyMapper?.[event.keyCode];
    if (!keyName || !input._currentState) {
      return;
    }
    input._currentState[keyName] = false;
    if (input._latestButton === keyName) {
      input._latestButton = null;
    }
  }

  function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function exactModifierMatch(event, trigger) {
    return (
      Boolean(event.altKey) === Boolean(trigger.altKey) &&
      Boolean(event.ctrlKey) === Boolean(trigger.ctrlKey) &&
      Boolean(event.metaKey) === Boolean(trigger.metaKey) &&
      Boolean(event.shiftKey) === Boolean(trigger.shiftKey)
    );
  }

  function clearGuardState() {
    state.consumedGuardKeyCodes.clear();
  }

  function focusGameTarget() {
    const graphics = window.Graphics || {};
    const canvas = graphics._canvas || document.querySelector("canvas");
    const target = canvas || document.body || document.documentElement;
    try {
      window.focus();
    } catch (_error) {
      // Some hosts ignore scripted frame focus.
    }
    focusElement(document.documentElement);
    focusElement(document.body);
    focusElement(target);
    if (canvas && canvas !== target) {
      focusElement(canvas);
    }
  }

  function focusElement(target) {
    if (!target || typeof target.focus !== "function") {
      return;
    }
    try {
      if (target instanceof HTMLElement && !target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
      }
      target.focus({ preventScroll: true });
    } catch (_error) {
      try {
        target.focus();
      } catch (_innerError) {
        // Focus is best-effort; gameplay still works once the frame is active.
      }
    }
  }

  // Waits until RPG Maker MV/MZ globals exist before installing hooks.
  function waitForRpgMaker() {
    if (state.installedHooks) {
      return;
    }

    // MV/MZ runtime.
    if (
      window.Bitmap &&
      window.Window_Base &&
      window.Window &&
      window.Graphics
    ) {
      installHooks();
      return;
    }

    setTimeout(waitForRpgMaker, 250);
  }

  // Assigns a stable id to each RPG Maker window owner.
  function ownerId(owner) {
    if (!owner[OWNER_ID]) {
      owner[OWNER_ID] = state.nextOwnerId++;
    }
    return owner[OWNER_ID];
  }

  // Installs hooks for text drawing and window updates.
  function installHooks() {
    if (state.installedHooks) {
      return;
    }
    state.installedHooks = true;
    installDictionaryGuardInputHooks();

    // All window text eventually draws through Bitmap.drawText.
    const bitmapDrawText = Bitmap.prototype.drawText;
    Bitmap.prototype.drawText = function (
      text,
      x,
      y,
      maxWidth,
      lineHeight,
      align,
    ) {
      const result = bitmapDrawText.apply(this, arguments);
      captureBitmapText(this, text, x, y, maxWidth, lineHeight, align);
      return result;
    };

    // Clearing a bitmap means old overlay text is stale.
    const bitmapClear = Bitmap.prototype.clear;
    Bitmap.prototype.clear = function () {
      forgetBitmap(this);
      return bitmapClear.apply(this, arguments);
    };

    // Partial bitmap clears remove matching overlay entries.
    const bitmapClearRect = Bitmap.prototype.clearRect;
    Bitmap.prototype.clearRect = function (x, y, width, height) {
      forgetBitmapRect(this, x, y, width, height);
      return bitmapClearRect.apply(this, arguments);
    };

    // Window_Base owns the Bitmap used for window text.
    const createContents = Window_Base.prototype.createContents;
    Window_Base.prototype.createContents = function () {
      const result = createContents.apply(this, arguments);
      if (this.contents) {
        state.bitmapOwners.set(this.contents, this);
      }
      return result;
    };

    // Window moves require overlay repositioning.
    const windowMove = Window.prototype.move;
    Window.prototype.move = function () {
      const result = windowMove.apply(this, arguments);
      scheduleFlush();
      return result;
    };

    // Window transforms can change final screen position.
    const windowUpdateTransform = Window.prototype.updateTransform;
    Window.prototype.updateTransform = function () {
      const result = windowUpdateTransform.apply(this, arguments);
      if (overlayIsActive()) {
        scheduleFlush();
      }
      return result;
    };
  }

  // Removes all overlay entries for one RPG Maker bitmap.
  function forgetBitmap(bitmap) {
    const owner = state.bitmapOwners.get(bitmap);
    if (!owner) {
      return;
    }

    const idPrefix = `${ownerId(owner)}:`;
    for (const [key, entry] of state.entries) {
      if (entry.owner === owner || key.startsWith(idPrefix)) {
        removeEntry(key, entry);
      }
    }

    for (const key of state.lineGroups.keys()) {
      if (key.startsWith(idPrefix)) {
        state.lineGroups.delete(key);
      }
    }
  }

  // Removes overlay entries touched by a cleared bitmap rectangle.
  function forgetBitmapRect(bitmap, x, y, width, height) {
    const owner = state.bitmapOwners.get(bitmap);
    if (!owner) {
      return;
    }

    const clearRect = {
      x: Number(x) || 0,
      y: Number(y) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
    };

    if (
      clearRect.width >= bitmap.width * 0.9 &&
      clearRect.height >= bitmap.height * 0.9
    ) {
      forgetBitmap(bitmap);
      return;
    }

    for (const [key, entry] of state.entries) {
      if (entry.owner === owner && rectsIntersect(clearRect, entry)) {
        removeEntry(key, entry);
      }
    }

    for (const [key, group] of state.lineGroups) {
      if (group.owner === owner && rectsIntersect(clearRect, group)) {
        const entry = state.entries.get(group.entryKey);
        if (entry) {
          removeEntry(group.entryKey, entry);
        }
        state.lineGroups.delete(key);
      }
    }
  }

  // Removes one overlay DOM entry.
  function removeEntry(key, entry) {
    state.entries.delete(key);
  }

  // Captures text drawn by an RPG Maker bitmap.
  function captureBitmapText(
    bitmap,
    rawText,
    x,
    y,
    maxWidth,
    lineHeight,
    align,
  ) {
    const owner = state.bitmapOwners.get(bitmap);
    if (!owner || rawText === undefined || rawText === null) {
      return;
    }

    const text = String(rawText);
    if (!text) {
      return;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const height =
      Number(lineHeight) || owner.lineHeight?.() || bitmap.fontSize || 24;
    const widthLimit = Number(maxWidth) || 0xffffffff;
    if (
      y < -height ||
      y >= bitmap.height ||
      x > bitmap.width ||
      x + widthLimit < 0
    ) {
      return;
    }

    if (owner._checkWordWrapMode) {
      return;
    }

    const measuredWidth = safeMeasure(bitmap, text);
    const adjustedX = adjustedTextLeft(x, widthLimit, measuredWidth, align);
    const normalizedY = Math.round(y);

    if (text.length === 1) {
      captureLineCharacter(
        owner,
        bitmap,
        text,
        adjustedX,
        normalizedY,
        measuredWidth,
        height,
      );
      return;
    }

    const key = [
      ownerId(owner),
      Math.round(adjustedX),
      normalizedY,
      Math.round(measuredWidth),
      Math.round(height),
      hashText(text),
    ].join(":");

    upsertEntry(key, {
      owner,
      text,
      x: adjustedX,
      y: normalizedY,
      width: Math.max(measuredWidth, 1),
      height,
      fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
      fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      updatedAt: performance.now(),
    });
  }

  // Merges RPG Maker dialogue characters into a stable line entry.
  function captureLineCharacter(
    owner,
    bitmap,
    text,
    x,
    y,
    measuredWidth,
    height,
  ) {
    const ownerKey = ownerId(owner);
    const key = `${ownerKey}:line:${Math.round(y)}:${Math.round(height)}:${bitmap.fontSize || ""}:${bitmap.fontFace || ""}`;
    const now = performance.now();
    let group = state.lineGroups.get(key);

    if (
      !group ||
      x < group.lastX - Math.max(8, height * 0.35) ||
      now - group.updatedAt > 5000
    ) {
      group = {
        owner,
        text: "",
        x,
        y,
        width: 0,
        height,
        fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
        fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
        lastX: x,
        updatedAt: now,
        entryKey: key,
      };
      state.lineGroups.set(key, group);
    }

    group.text += text;
    group.x = Math.min(group.x, x);
    group.width = Math.max(group.width, x + measuredWidth - group.x);
    group.lastX = x + measuredWidth;
    group.updatedAt = now;

    upsertEntry(group.entryKey, {
      owner: group.owner,
      text: group.text,
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 1),
      height: group.height,
      fontSize: group.fontSize,
      fontFace: group.fontFace,
      updatedAt: group.updatedAt,
    });
  }

  // Measures text width with a fallback estimate.
  function safeMeasure(bitmap, text) {
    try {
      return Math.max(1, bitmap.measureTextWidth(text));
    } catch (_error) {
      return Math.max(1, text.length * (bitmap.fontSize || 24) * 0.6);
    }
  }

  // Converts text alignment into a left x coordinate.
  function adjustedTextLeft(x, maxWidth, measuredWidth, align) {
    if (align === "center") {
      return x + Math.max(0, (maxWidth - measuredWidth) / 2);
    }
    if (align === "right") {
      return x + Math.max(0, maxWidth - measuredWidth);
    }
    return x;
  }

  // Stores or updates one overlay entry.
  function upsertEntry(key, next) {
    const current = state.entries.get(key) || {};
    Object.assign(current, next);
    state.entries.set(key, current);
    scheduleFlush();
  }

  // Schedules a single DOM update for the next animation frame.
  function scheduleFlush() {
    if (state.raf) {
      return;
    }

    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      flushOverlay();
    });
  }

  // Sends captured entries to the extension content script for CSP-safe DOM rendering.
  function flushOverlay() {
    const entries = [];

    for (const [key, entry] of state.entries) {
      if (!entryIsVisible(entry)) {
        removeEntry(key, entry);
        continue;
      }

      const rect = toPageRect(entry);
      if (!rect) {
        removeEntry(key, entry);
        continue;
      }

      entries.push({
        key,
        text: entry.text,
        left: rect.left,
        top: rect.top,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        fontSize: Math.max(1, rect.fontSize),
        fontFace: entry.fontFace || "sans-serif",
      });
    }

    document.dispatchEvent(
      new CustomEvent(RENDER_EVENT, {
        detail: JSON.stringify({
          active: overlayIsActive(),
          readable: state.enabledForPage && state.active,
          reader: state.enabledForPage && state.readerMode,
          entries,
        }),
      }),
    );
  }

  function entryIsVisible(entry) {
    const owner = entry.owner;
    if (!owner || owner.destroyed || !owner.parent) {
      return false;
    }
    if (typeof owner.isClosed === "function" && owner.isClosed()) {
      return false;
    }
    return displayObjectIsVisible(owner);
  }

  // Converts RPG Maker window coordinates into browser page coordinates.
  function toPageRect(entry) {
    const graphics = window.Graphics;
    const canvas = graphics && graphics._canvas;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const scaleX =
      rect.width / (graphics.width || canvas.width || rect.width || 1);
    const scaleY =
      rect.height / (graphics.height || canvas.height || rect.height || 1);
    const contentTransform = ownerContentTransform(entry.owner);
    const padding = Number(entry.owner.padding) || 0;
    const originX = entry.owner.origin ? Number(entry.owner.origin.x) || 0 : 0;
    const originY = entry.owner.origin ? Number(entry.owner.origin.y) || 0 : 0;
    const visibleWidth = Math.max(
      0,
      (Number(entry.owner.width) || Number(entry.owner._width) || 0) -
        padding * 2,
    );
    const visibleHeight = Math.max(
      0,
      (Number(entry.owner.height) || Number(entry.owner._height) || 0) -
        padding * 2,
    );
    const visibleRect = {
      x: originX,
      y: originY,
      width: visibleWidth,
      height: visibleHeight,
    };
    const clipped = intersectRects(entry, visibleRect);

    if (!clipped || clipped.width <= 0 || clipped.height <= 0) {
      return null;
    }

    const pageLeft =
      rect.left +
      (contentTransform.x + clipped.x * contentTransform.scaleX) * scaleX;
    const pageTop =
      rect.top +
      (contentTransform.y + clipped.y * contentTransform.scaleY) * scaleY;
    const pageWidth = clipped.width * contentTransform.scaleX * scaleX;
    const pageHeight = clipped.height * contentTransform.scaleY * scaleY;

    if (
      pageLeft >= rect.right ||
      pageTop >= rect.bottom ||
      pageLeft + pageWidth <= rect.left ||
      pageTop + pageHeight <= rect.top
    ) {
      return null;
    }

    return {
      left: roundCssPixel(pageLeft),
      top: roundCssPixel(pageTop),
      width: roundCssPixel(pageWidth),
      height: roundCssPixel(pageHeight),
      fontSize: roundCssPixel(
        (entry.fontSize || entry.height || 24) *
          Math.min(
            contentTransform.scaleX * scaleX,
            contentTransform.scaleY * scaleY,
          ),
      ),
    };
  }

  // Rounds CSS values to reduce jitter.
  function roundCssPixel(value) {
    return Math.round(value * 2) / 2;
  }

  // Checks visibility through the Pixi/RPG Maker parent chain.
  function displayObjectIsVisible(object) {
    let current = object;
    let guard = 0;

    while (current && guard++ < 30) {
      if (
        current.visible === false ||
        current.renderable === false ||
        current.alpha === 0
      ) {
        return false;
      }
      current = current.parent;
    }

    return true;
  }

  function rectsIntersect(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function intersectRects(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    if (x2 <= x1 || y2 <= y1) {
      return null;
    }

    return {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
    };
  }

  // Uses the actual contents sprite transform when RPG Maker exposes it.
  function ownerContentTransform(owner) {
    const contentSprite = owner?._windowContentsSprite || owner?._contentsSprite;
    const transform = contentSprite?.worldTransform;
    if (transform && Number.isFinite(transform.tx) && Number.isFinite(transform.ty)) {
      return {
        x: Number(transform.tx) || 0,
        y: Number(transform.ty) || 0,
        scaleX: transformScaleX(transform),
        scaleY: transformScaleY(transform),
      };
    }

    const ownerPos = ownerWorldPosition(owner);
    const padding = Number(owner.padding) || 0;
    const originX = owner.origin ? Number(owner.origin.x) || 0 : 0;
    const originY = owner.origin ? Number(owner.origin.y) || 0 : 0;
    return {
      x: ownerPos.x + padding - originX,
      y: ownerPos.y + padding - originY,
      scaleX: 1,
      scaleY: 1,
    };
  }

  function transformScaleX(transform) {
    const a = Number(transform.a);
    const b = Number(transform.b);
    const scale = Math.sqrt(
      (Number.isFinite(a) ? a : 1) ** 2 +
        (Number.isFinite(b) ? b : 0) ** 2,
    );
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function transformScaleY(transform) {
    const c = Number(transform.c);
    const d = Number(transform.d);
    const scale = Math.sqrt(
      (Number.isFinite(c) ? c : 0) ** 2 +
        (Number.isFinite(d) ? d : 1) ** 2,
    );
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  // Sums parent positions as a fallback for older/custom window implementations.
  function ownerWorldPosition(owner) {
    let x = 0;
    let y = 0;
    let current = owner;
    let guard = 0;

    while (current && guard++ < 20) {
      x += Number(current.x) || 0;
      y += Number(current.y) || 0;
      current = current.parent;
    }

    return { x, y };
  }

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  waitForRpgMaker();
})();
