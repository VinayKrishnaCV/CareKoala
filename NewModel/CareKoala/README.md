# CareKoala model and training source

This directory contains the prompt contract, standalone inference tools, LoRA training scripts, export tools and evaluation code for the local screen-text classifier. The PC application uses Llama-3.2-1B-Instruct Q4_K_M with the separate CareKoala v2 adapter.

The current desktop and Guardian apps are version 0.4.2. Android receives encrypted requests and holds guardian keys; it does not run the model. See the [project overview](../../README.md) and [PC model integration](<../../boundary-ml 5/MODEL-INTEGRATION.md>).

## Model contract

Input is OCR text formatted with `engine/prompt.py`. Output is JSON with an integer score from 0 to 10 and a supported category:

```json
{"score": 8, "category": "self_harm"}
```

Categories are `safe`, `distress`, `self_harm`, `harassment`, `hate_speech` and `violence`. The desktop's copy is `boundary_ml/trained_prompt.py`. Keep the training and runtime contracts compatible.

Electron scores every window of up to 520 characters and uses the highest score. Application policy differs from the standalone monitor's defaults:

| Score | Desktop real-mode action |
| --- | --- |
| 0-5 | Continue without an automatic request |
| 6-7 | Send an encrypted guardian check-in |
| 8-10 | Pause monitoring and show the guardian unlock overlay |

Scores are not diagnoses. Screen text may be news, a quotation or a message written by someone else. False positives and missed concerns remain possible.

## Assets after cloning

Model binaries are excluded from this source publication. Required deployment paths are:

```text
models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf
models/carekoala-lora-v2.gguf
```

The standard-library downloader retrieves the base GGUF, EasyOCR weights and a platform-specific llama.cpp b11036 runtime with integrity checks:

```powershell
python engine/download_assets.py
```

It does not retrieve the trained adapter. Supply v2 separately before running real inference. For Electron on Windows, use the PC runtime installer or set `CAREKOALA_LLAMA_SERVER` to the matching downloaded executable. The PC guide explains its OCR model path.

Keep the adapter separate from the quantized base. Merging and requantizing it is not the tested deployment configuration.

## Inference and app integration

`engine/score_text.py` scores supplied text without OCR. `engine/monitor.py` is a standalone experiment with its own capture cadence and flags; it is not Electron's real-mode scheduler.

The PC app runs whole-screen capture, OCR and inference sequentially. It releases heavy workers between stages, skips unchanged text and preserves evidence across bounded requests. Personal trigger words can request a check-in independently of the score.

The 0.4.2 apps pair through a QR or one typed code. Guardian supports ten independent people and retains enrollment during theme changes. Its RSA private keys stay in Android Keystore. Successful typed or remote unlocks return an authenticated PC receipt, which removes the matching unlock controls and persists completion across restart. The PC overlay accepts mouse movement and typing without a Start-menu workaround. These features act on model scores; they do not change the prompt or training labels.

## Training and evaluation

`training/` contains dataset construction, LoRA training, GGUF export, evaluation and sanity checks. The saved adapter configuration uses rank 16 and alpha 32 on attention and MLP projections in layers 6-15. v2 continues the original adapter with targeted self-injury and harassment examples and is the deployed default; v1 remains a comparison artifact.

Use `requirements-train.txt` for training and inspect each script's arguments before execution. Dataset downloads and training are separate from running the app. Keep raw data, checkpoints and credentials out of an application release.

Existing evaluation reports describe particular datasets and thresholds. They do not establish clinical accuracy or behavior on every screen. Evaluate a new adapter through the actual quantized runtime and check its results against the desktop policy before deployment.

## Terms and attribution

Built with Llama. Base-model and derivative distribution are subject to the [Llama 3.2 Community License](https://www.llama.com/llama3_2/license/). EasyOCR uses Apache-2.0. The vendored llama.cpp source retains its MIT license in `training/third_party/llama.cpp/LICENSE`. Dataset sources retain their own terms and attribution.
