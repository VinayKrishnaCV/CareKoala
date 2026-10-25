# CareKoala PC application

Electron provides the Windows interface, tray, screen capture, guardian connection and unlock overlay. A Python API on `127.0.0.1:8765` runs local workers. EasyOCR extracts text; Llama-3.2-1B-Instruct Q4_K_M with the separate CareKoala v2 LoRA adapter scores it.

Version **0.4.2** includes one-code QR pairing, multiple-person Guardian support, persistent themes, personal trigger words, optional startup and hosts-based domain blocking. This version also confirms successful unlocks back to Android and fixes mouse input when lockdown opens. See the [release notes](../CHANGELOG.md).

## Requirements and installation

Use Windows 10 or 11 x64, Python 3.12 and Node.js 22 or newer. CUDA is not required. OCR and inference run sequentially to limit peak memory; performance depends on the PC and amount of text.

From the repository root in PowerShell:

```powershell
cd 'boundary-ml 5'
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
.\.venv\Scripts\python.exe -m pip install -e .
cd electron-app
npm ci
cd ..
```

Download the base model from the repository root:

```powershell
& '.\boundary-ml 5\.venv\Scripts\python.exe' .\NewModel\CareKoala\engine\download_assets.py --only model
```

Supply these files before starting real inference:

```text
NewModel/CareKoala/models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf
NewModel/CareKoala/models/carekoala-lora-v2.gguf
```

The downloader does not retrieve the trained adapter. Model weights are not tracked in this source publication. Keep the adapter separate from the base; do not merge and requantize it as a replacement for the tested configuration.

From `boundary-ml 5`, install the matching Windows runtime:

```powershell
.\scripts\install_model_runtime.ps1
```

The script verifies SHA-256 before extracting llama.cpp b11036 into `runtime/llama-b11036`. EasyOCR downloads its English recognition and detection weights on first use unless a local model directory is configured. Setup needs internet access even though screen processing is local.

For assets stored elsewhere, set `CAREKOALA_MODEL_ROOT` to the CareKoala model directory and `CAREKOALA_LLAMA_SERVER` to the matching executable.

## Run and restart

From `boundary-ml 5`:

```powershell
.\scripts\start_desktop.ps1
```

The launcher checks the environment before opening Electron. To test the explicitly marked mock workflow:

```powershell
.\scripts\start_desktop.ps1 -Mock
```

Mock analysis is deterministic development output. Real mode always uses trained inference, including when launched with `-Mock`.

Quit the old instance from the tray before restarting after source edits. Closing the window only hides it. An installed application also needs an update before it can use changes made in a separate source checkout.

## Pair and test

1. Install the custom [Android Guardian](../guardian-android/README.md).
2. On the PC's **Guardian** page, name the person or PC and create a QR/code.
3. On Android, choose **Add person**, then scan the QR or enter the single `CK2-` code.
4. Approve the guardian name on the PC within the ten-minute invitation window.
5. Allow phone notifications, send a test notification, then test the overlay.

Scanning and typing perform the same enrollment. Alert encryption and public-key setup are exchanged together. Guardian keeps up to ten people independent.

If a connection fails, compare the public pairing fingerprints in connection details. A saved PC pairing can belong to a different phone profile. Preserve unrelated people when repairing a mismatch.

## Monitoring policy

| Score | Real-mode action |
| --- | --- |
| 0-5 | Continue without an automatic check-in |
| 6-7 | Send an encrypted check-in |
| 8-10 | Pause monitoring, cover every display and send an encrypted unlock event |

Real mode captures the entire screen and starts its next cycle after processing finishes. OCR and inference share a serialized queue and do not occupy memory together. Unchanged text skips inference. A continuing concern is deduplicated, but an escalation to 8+ still locks after an earlier alert.

Personal trigger words match whole words or phrases while ignoring case, punctuation and line breaks. A match can request a check-in even with a low score or failed inference. The trigger text stays on the PC.

Manual review captures a selected screen/window or loads an image, then lets the user correct OCR before analysis. Its periodic capture controls are separate from real mode. Sending a guardian message from manual review requires a click.

Requests are bounded to 40 messages and 20,000 text characters. Electron splits larger OCR results without dropping late evidence. The model scores all windows of at most 520 characters; the highest score determines the result. Invalid inference and missing assets are errors, never safe scores.

## Unlock, persistence and appearance

The phone keeps its RSA private key in Android Keystore. The PC encrypts a one-time key and timestamp with the phone's public key. The guardian authenticates on Android before replying with the key or reading it for the PC user to type.

After either successful unlock path, the PC saves the released state and sends an encrypted completion receipt. Guardian shows **PC unlocked**, removes that request's controls and stored key, and saves completion across restart. Until confirmation arrives, its action reads **Send unlock again**. Receipts cannot clear a newer request or another person's state. Pending receipts survive a PC restart and retry within five minutes; replaced pairings cannot receive them.

The overlay uses frameless windows sized to each display, rather than native Windows fullscreen. Focus follows the cursor's display. Mouse movement, clicks and typing work without the Start-menu workaround. Monitoring remains paused after unlock.

Pairing, trigger words and monitoring preferences persist locally. Optional sign-in startup resumes configured real mode. Both apps offer saved light/dark themes; Android preserves enrollment and form drafts during theme changes. Android force-stop, battery restrictions and network loss can still interrupt background delivery.

## Domain protection

**Protection** contains trigger words, startup and the optional hosts sinkhole. A narrow helper requests UAC, preserves custom entries, downloads the StevenBlack list and installs a daily updater. Failed downloads retain the last valid list. Disabling removes CareKoala's block and task.

This is domain blocking, not packet filtering. Direct IP traffic, resolver bypass and new/unlisted threats remain possible. See [DOMAIN-PROTECTION.md](electron-app/DOMAIN-PROTECTION.md).

## Tests and source

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
cd electron-app
node --test test/*.test.js
```

The API and workers do not send screen content, scores or trigger words to ntfy.sh. The relay sees ciphertext and routing/network metadata.

See [model integration](MODEL-INTEGRATION.md), [Electron source](electron-app/README.md) and the [root guide](../README.md). The older boundary-training modules are historical research tools, not the deployed model.
