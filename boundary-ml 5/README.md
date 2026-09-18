# CareKoala desktop

CareKoala reads screen text locally with EasyOCR, scores it with the trained
CareKoala v2 Llama-3.2-1B model, and can send encrypted guardian check-in requests
through ntfy.sh. Screenshot and conversation content remain on the computer.

## Start on Windows

From this directory in PowerShell:

```powershell
.\scripts\start_desktop.ps1
```

For the explicitly labelled mock UI test:

```powershell
.\scripts\start_desktop.ps1 -Mock
```

Quit an old running instance from its tray menu before restarting after an update.

## Trained model

The app reads the supplied weights from ../NewModel/CareKoala. It uses the Q4_K_M
Llama base and carekoala-lora-v2.gguf together. The previous Qwen runtime defaults
have been removed. See MODEL-INTEGRATION.md for asset paths, score policy, process
cleanup, and validation. The 18 MB official Windows CPU runtime is already installed;
scripts/install_model_runtime.ps1 reinstalls it with SHA-256 verification.

The training contract is **0–10**, including 0 for safe content:
- 0–3: low
- 4–6: watch
- 7–8: alert
- 9–10: emergency

A score of 7 or above recommends a guardian check-in. These are screen-content
scores, not a diagnosis. Emergency is a model level, not an emergency-service call.

## Desktop and phone

1. Install the custom CareKoala Guardian Android app.
2. Desktop Guardian pairing: create a code and privately transfer it to Android.
3. Phone: Inspect pairing code, compare fingerprints, save pairing.
4. Verify the same fingerprint on desktop.
5. Phone: Start receiving and grant notification permission.
6. Wait for Listening via ntfy.sh, then desktop: Send test warning to Android.
7. Confirm the phone notification before starting unattended real mode.

No relay server, gateway URL, account, or manual topic setup is required. Both
devices derive a random-looking ntfy topic with HMAC from their shared pairing
secret. AES-GCM authenticates and encrypts alerts; Android checks expiry and replay.
Desktop publication is not confirmation of phone delivery. The custom Android app
uses a visible foreground stream, not the official ntfy app's FCM integration.

## Modes and memory

Manual mode: capture/load screenshot, read OCR, review text, analyze. Review displays
the score, category and guardian recommendation. A guardian send is explicit.

Real mode: entire-screen capture -> OCR process exits -> trained model process
runs and exits -> encrypted check-in if score >=7. Each new cycle starts after
processing completes. Repeated positive screens do not repeatedly send alerts.
Tray controls open/pause/quit. Closing the window leaves the app in the tray.
Windows startup is optional and starts real mode only with saved verified pairing.

Mock mode uses real OCR and deterministic legacy test analysis; it does not claim
a trained-model score. Real mode always uses the trained model, even if launched
with -Mock. The separate test-warning button works without OCR/model inference.

## Development

The existing Python 3.12 .venv, CPU EasyOCR packages and Electron dependencies are
used. Run scripts/doctor.py for prerequisites. Test commands:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
cd electron-app
node --test test/*.test.js
```

The HTTP backend runs only on 127.0.0.1:8765. Requests are bounded and chunked;
model windows are <=520 characters and every window is scored. Invalid inference
fails visibly instead of falling back to another model or a safe score.

The older boundary dataset/training/evaluation modules remain historical tools,
not the active model. For the supplied model use NewModel/CareKoala/HANDOFF.md and
its training directory. Do not merge and requantize its LoRA adapter.
