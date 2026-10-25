# CareKoala Electron app

Version **0.4.2**. This directory contains the Windows interface, preload APIs, system tray, capture controls, encrypted enrollment, unlock overlay and domain-protection helper. Python workers and the local API live one directory above it.

## Download 0.4.2

[Download the Windows x64 installer](https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/CareKoala-Setup-0.4.2-x64.exe). It includes the local Python, OCR and model runtime. The Windows installer is not code-signed. [Release notes and checksums](https://github.com/VinayKrishnaCV/CareKoala/releases/tag/v0.4.2) accompany the packages.

## Run from source

Complete the [PC setup](../README.md), including Python dependencies, model assets and llama.cpp. From `boundary-ml 5`, run:

```powershell
.\scripts\start_desktop.ps1
```

`npm start` in this directory also opens Electron once the environment is configured. `npm run start:mock` enables the marked development workflow. Real mode still uses trained inference. Use the tray's quit action before restarting after edits; closing the window keeps the app in the tray.

## Interface and monitoring

**Overview** controls real mode. **Guardian** manages pairing and notification/overlay tests. **Protection** contains trigger words, domain blocking and Windows sign-in startup. **Check screen text** provides image capture, OCR correction and manual analysis.

The header's theme button saves light or dark mode. Before a preference is saved, the app follows the system. Theme colors cover controls, dialogs, errors, focus indicators and the overlay. Contrast is tested in both palettes.

Real mode captures the entire screen and runs capture, OCR and inference sequentially. The next cycle starts after the previous one finishes. Workers release memory between stages. Unchanged text skips inference, and a continuing alert is deduplicated.

Scores 0-5 continue without an automatic check-in; 6-7 notify; 8-10 pause monitoring and open the overlay on all displays. A later 8+ score still locks after an earlier notification. Personal trigger words can request a check-in independently; 8+ takes the lockdown path first.

Manual capture and periodic manual capture retain their review controls. Sending a guardian message from manual analysis requires a click. Invalid inference is an error, never a fabricated safe score.

## Pairing and transport

The PC displays one QR and `CK2-` invitation code. Android can scan or type it. The PC then asks the user to approve the requesting guardian. Invitations expire after ten minutes. Final alert keys are independently generated and RSA-encrypted to the phone's public key.

There is no gateway field or manual topic setup. ntfy.sh topics are derived with HMAC from random pairing material. The app sends AES-GCM authenticated envelopes, not screenshots, OCR text, scores or plaintext keys. Android supports ten independent people. Saved connections and enabled preferences survive restart.

The notification test bypasses OCR and inference. The separate lockdown demo tests the guardian-key and overlay flow. Relay acceptance alone is not proof of phone receipt.

## Unlock completion and mouse input

Both a typed key and a valid phone reply use the same release path. The PC saves the released state and a pending encrypted receipt before closing the overlay. Guardian then marks only the matching request complete, deletes its stored one-time key, removes the unlock controls and cancels that event's notification.

Completion persists across phone restart. Replayed or delayed receipts cannot clear a newer request or another person. Until the PC confirms, Guardian offers **Send unlock again**. Unsent receipts survive PC restart and retry within five minutes. A replaced pairing cannot receive the old pairing's receipt.

Overlay windows are frameless and sized to each display. They appear when rendering is ready and focus the display under the cursor, rather than making every display compete for focus. They do not enter native Windows fullscreen. Mouse movement, button clicks and typing were verified without opening the Start menu. Escape, F11 and Alt-F4 do not dismiss the overlay; Windows security controls remain available. This is not an OS kiosk.

Monitoring remains paused after unlock. No alternate recovery password or offline recovery-code system has been added.

## Domain blocking and startup

The optional blocker uses the Windows hosts resolver and the maintained StevenBlack list. A narrow helper requests elevation, preserves custom entries, installs a daily updater and retains the last valid list on download failure. Disable removes only CareKoala's block and task. Direct IP traffic and resolver bypass are outside its scope.

Sign-in startup is optional and uses the saved verified pairing and monitoring preference. Explicit pause disables automatic resumption. The main app does not need to run as administrator.

## Code map

| Files | Responsibility |
| --- | --- |
| `main.js`, `preload.js` | Worker queue, tray and constrained IPC |
| `auto-mode.js`, `triggers.js` | Monitoring and local trigger matching |
| `enrollment.js`, `enrollment-protocol.js` | QR/code invitation and approved key exchange |
| `lockdown.js`, `lockdown-protocol.js` | Overlay, key verification and completion receipts |
| `unlock-listener.js` | Bounded relay stream, reconnect and replay handling |
| `settings.js` | Preferences and Windows-protected pairing material |
| `domain-protection.js`, `windows/` | Hosts installation, update and removal |
| `renderer/` | Interface, themes and screen-text review |

Run `npm test`. Version 0.4.2 passed 49 desktop tests, including encrypted channel separation, bounded OCR requests, retries, theme contrast and multi-display focus.

See [guardian protocol](GUARDIAN-LOCKDOWN.md), [domain protection](DOMAIN-PROTECTION.md), [Android](../../guardian-android/README.md) and [release notes](../../CHANGELOG.md). `staging/` and `dist/` are generated output; packaging is a separate release step.
