# dsh-screenshot

A screenshot button for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI: click it, the
browser window hides, you drag a region on the real desktop, the window comes back, and the PNG
lands in the composer draft as a pending attachment. Nothing is sent until you press Enter.

English | [中文](README.zh-CN.md)

> **Platform:** Windows 10/11 only. The window hiding and screen capture are Win32 calls; other
> platforms need a different native backend.

## Why

Screenshotting *the app you chat in* is awkward: every screenshot tool captures the chat window too.
This plugin hides its own window first, so what you draw a box around is the desktop underneath —
the model you are describing, the error dialog, the spreadsheet cell that went wrong.

## Usage

1. Click the screenshot icon in the composer's left tool row (next to the model selector).
2. The window disappears; a full-screen selection veil appears over a frozen frame of the desktop.
3. Drag a rectangle. Release to capture. `Esc` or right-click cancels.
4. The window returns to the foreground and the crop appears as a thumbnail above the composer.
5. Add your question and press Enter when ready.

The helper restores the window in a `finally` block, and a separate restore script unhides it if the
capture process is killed outright, so a failed attempt never strands a hidden window.

## Requirements

- Windows 10 or 11
- A DeepSeek Harness installation with the Web UI (`dsh web`)
- `pnpm` on `PATH` — the DSH plugin installer shells out to it

## Install

```
git clone https://github.com/arun13144234/dsh-screenshot.git
```

Then install the bundle from that checkout:

```
plugin_manager install_bundle  target=<absolute path to the cloned directory>
```

That is a DSH tool call: run it from a DSH agent session, or wire the directory in through the plugin
manager UI. The installer adds the package to the current profile and activates the bundle; a page
refresh may be needed before the button appears.

The Host half starts a PowerShell helper; the Client half injects a 24 px control into
`conversation.input.left`. Both are internal to DSH, so a future DSH release may need a matching fix
here.

## How it works

| Half | File | Job |
|---|---|---|
| Host | `index.js` | `POST /dsh-screenshot/snip` → spawns the PowerShell helper, answers with the PNG as a data URL |
| Client | `client.js` | the button; hands the PNG to the composer through a `drop` event |
| Native | `scripts/snip.ps1` + `scripts/DshShot.cs` | hide window, freeze screen, draw the selection veil, crop, save, restore |
| Safety net | `scripts/restore.ps1` | unhides the window by handle if the helper dies |

Three decisions worth knowing about:

- **Own selection overlay instead of the system snipping tool.** `ms-screenclip:` is the nicer
  interaction, but on the machines we tested it is registered without a `shell\open\command` and
  activation is refused from a restricted token. Drawing the veil ourselves removes the AppX
  dependency entirely.
- **`drop` event instead of a composer API.** The composer's file intake (`addFiles`) is a
  package-private injection, not reachable from a third-party plugin. The attachment surface installs
  a document-level drop target, so one synthetic `DragEvent` with a `DataTransfer` carrying the PNG
  rides the same upload and preview path a real drag-and-drop does.
- **Window lookup by title.** The client sends `document.title`; the helper hides the top-level window
  whose caption contains it, skipping console processes. If nothing matches it falls back to the
  foreground window, and it verifies `IsWindowVisible` is false before capturing — hiding the wrong
  window produces an error instead of a screenshot of your own chat.

## Development

Syntax and manifest checks (no build step, no dependencies):

```powershell
node --check index.js
node --check client.js
```

Drive the whole native chain without touching the mouse — hide, capture a fixed region, restore:

```powershell
powershell.exe -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass `
  -File scripts\snip.ps1 -OutPath "$env:TEMP\shot.png" `
  -AutoSelect '100,100,800,450' -TitleFragment 'DeepSeek Harness' -TimeoutSeconds 20
```

Expected: `{"ok":true,...,"width":800,"height":450}` and the window back on screen.

Note that this must run **outside** the DSH tool sandbox: cross-process window control is refused
inside it. It is meant to be spawned by the plugin's Host half, which is a normal child of the DSH
process.

## Limitations

- Windows only, and it captures the virtual screen as one surface (multi-monitor selections work, but
  per-monitor DPI differences are flattened).
- No annotations, OCR, scrolling capture, or "capture one window" mode.
- The screen behind is frozen at the moment of hiding; anything that updates while you are still
  dragging is not reflected.
- Not installable through `npm install` as a package right now — install it as a bundle directory.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| The icon turns red and the tooltip shows an error | Host-side failure: capture helper could not hide the window or failed to compile |
| Nothing happens at all | The capture succeeded but the composer refused the drop (busy phase) |
| The window hides and never returns | Should be impossible: the helper restores in `finally`, `restore.ps1` is the backstop. Report it with the DSH log |

## Roadmap

- Cache the compiled helper as a DLL so the very first click is instant
- Optionally copy the crop to the system clipboard as well
- Global shortcut (e.g. `Ctrl+Shift+S`)
- Window mode: click a window instead of dragging

## License

[MIT](LICENSE)
