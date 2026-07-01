# RPG Maker Text Overlay Extension

Chrome extension that injects a runtime-only DOM text layer at the same place as RPG Maker MV/MZ game text.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `rpgmaker-text-overlay-extension`.

## Use

- Click the extension icon: open the control popup.
- Overlay: enable or disable always-on transparent, interactable text for this page.
- Show: show or hide the readable same-place text layer. Show is only available while Overlay is enabled.
- Guard: add/remove key chords that should not reach the game. Guard keys are global across pages and start empty.

Once enabled from the popup, transparent text is kept in the DOM on that same page after refresh. Turning Overlay off also turns off readable text.

## Notes

- The extension hooks RPG Maker at runtime in the page context.
- It tracks `Window_Base` contents and captures text drawn through `Bitmap.drawText`, which covers dialogue, choices, menus, status windows, and most plugin windows.
- Overlay blocks game clicks where invisible text is present, because it lets the text layer receive mouse hover/click/select events.
- Guard keys are consumed with `preventDefault`, propagation blocking, and RPG Maker input-state cleanup so they do not become stuck game inputs.

## Future Works

- Custom hotkeys.
