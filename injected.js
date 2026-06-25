(() => {
  if (window.__rpgMakerTextOverlayInstalled) {
    return;
  }

  window.__rpgMakerTextOverlayInstalled = true;

  const OWNER_ID = "__rpgTextOverlayOwnerId";
  const TRANSPARENT_EVENT = "rpg-text-overlay:set-transparent";
  const state = {
    active: false,
    readerMode: false,
    enabledForPage: false,
    nextOwnerId: 1,
    bitmapOwners: new WeakMap(),
    entries: new Map(),
    lineGroups: new Map(),
    raf: 0,
    installedHooks: false,
    root: null,
  };

  const style = document.createElement("style");
  style.textContent = `
    #rpg-text-overlay-root {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      display: none;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
    }

    #rpg-text-overlay-root.rpg-text-overlay-active {
      display: block;
    }

    .rpg-text-overlay-entry {
      position: fixed;
      box-sizing: border-box;
      display: block;
      white-space: pre;
      overflow: visible;
      pointer-events: none;
      user-select: text;
      contain: layout style paint;
      color: rgba(255, 255, 255, 0.96);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.8);
      background: rgba(0, 0, 0, 0.18);
      border-radius: 2px;
      padding: 0 1px;
      line-height: 1;
      opacity: 1;
    }

    #rpg-text-overlay-root:not(.rpg-text-overlay-readable) .rpg-text-overlay-entry {
      color: transparent;
      background: transparent;
      opacity: 1;
      text-shadow: none;
    }

    #rpg-text-overlay-root.rpg-text-overlay-readable .rpg-text-overlay-entry {
      outline: none;
      background: transparent;
      opacity: 1;
    }

    #rpg-text-overlay-root.rpg-text-overlay-reader .rpg-text-overlay-entry {
      pointer-events: auto;
      cursor: text;
    }
  `;
  document.documentElement.appendChild(style);

  function ensureDom() {
    if (state.root) {
      return;
    }

    state.root = document.createElement("div");
    state.root.id = "rpg-text-overlay-root";
    document.documentElement.appendChild(state.root);
  }

  function setActive(active) {
    ensureDom();
    state.active = active;
    refreshRootClasses();
    scheduleFlush();
  }

  function setTransparentEnabled(enabled) {
    ensureDom();
    state.enabledForPage = enabled;
    if (!enabled) {
      state.readerMode = false;
      state.active = false;
    }
    refreshRootClasses();
    scheduleFlush();
  }

  function setReaderMode(enabled) {
    ensureDom();
    state.readerMode = enabled;
    refreshRootClasses();
    scheduleFlush();
  }

  function refreshRootClasses() {
    ensureDom();
    state.root.classList.toggle("rpg-text-overlay-active", overlayIsActive());
    state.root.classList.toggle("rpg-text-overlay-readable", state.active);
    state.root.classList.toggle("rpg-text-overlay-reader", state.readerMode);
  }

  function overlayIsActive() {
    return state.active || state.enabledForPage || state.readerMode;
  }

  document.addEventListener(TRANSPARENT_EVENT, (event) => {
    setTransparentEnabled(Boolean(event.detail && event.detail.enabled));
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyT"
      ) {
        event.preventDefault();
        if (state.enabledForPage) {
          setActive(!state.active);
        }
      }

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyR"
      ) {
        event.preventDefault();
        if (state.enabledForPage) {
          setReaderMode(!state.readerMode);
        }
      }
    },
    true,
  );

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
    if (entry.element) {
      entry.element.remove();
    }
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
    if (!text || !text.trim()) {
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

  // Renders captured entries into DOM text spans.
  function flushOverlay() {
    ensureDom();
    if (!overlayIsActive()) {
      return;
    }

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

      if (!entry.element) {
        entry.element = document.createElement("span");
        entry.element.className = "rpg-text-overlay-entry";
        state.root.appendChild(entry.element);
      }

      if (entry.element.textContent !== entry.text) {
        entry.element.textContent = entry.text;
        entry.element.setAttribute("aria-label", entry.text);
        entry.element.dataset.rpgText = entry.text;
        entry.element.removeAttribute("title");
      }

      setStyleIfChanged(entry.element, "left", `${rect.left}px`);
      setStyleIfChanged(entry.element, "top", `${rect.top}px`);
      setStyleIfChanged(entry.element, "width", `${Math.max(1, rect.width)}px`);
      setStyleIfChanged(
        entry.element,
        "height",
        `${Math.max(1, rect.height)}px`,
      );
      setStyleIfChanged(
        entry.element,
        "font",
        `${Math.max(1, rect.fontSize)}px ${entry.fontFace || "sans-serif"}`,
      );
      setStyleIfChanged(
        entry.element,
        "lineHeight",
        `${Math.max(1, rect.height)}px`,
      );
    }
  }

  function setStyleIfChanged(element, name, value) {
    if (element.style[name] !== value) {
      element.style[name] = value;
    }
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
    const ownerPos = ownerWorldPosition(entry.owner);
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
      rect.left + (ownerPos.x + padding - originX + clipped.x) * scaleX;
    const pageTop =
      rect.top + (ownerPos.y + padding - originY + clipped.y) * scaleY;
    const pageWidth = clipped.width * scaleX;
    const pageHeight = clipped.height * scaleY;

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
        (entry.fontSize || entry.height || 24) * Math.min(scaleX, scaleY),
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

  // Sums parent positions for an RPG Maker display object.
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
