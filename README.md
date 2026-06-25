# RPG Maker Text Overlay Extension

Chrome extension that injects a runtime-only DOM text layer at the same place as RPG Maker MV/MZ game text.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `rpgmaker-text-overlay-extension`.

## Use

- Click the extension icon: enable or disable always-on transparent text for this page.
- `Alt+T`: show or hide the readable same-place text layer.
- `Alt+R`: toggle reader interaction mode, which lets invisible text receive hover/click/select events.

Once enabled from the extension icon, transparent text is kept in the DOM on that same page after refresh. `Alt+T` and `Alt+R` only work while the page is enabled. Turning the icon off also turns off readable and reader interaction modes.

## Notes

- The extension hooks RPG Maker at runtime in the page context.
- It tracks `Window_Base` contents and captures text drawn through `Bitmap.drawText`, which covers dialogue, choices, menus, status windows, and most plugin windows.
- `Alt+R` blocks game clicks where invisible text is present, because it lets the text layer receive mouse hover/click/select events.

## Future Works

- Custom hotkeys.
- RPG Maker detected/not-detected icon state.
- Popup control panel.
