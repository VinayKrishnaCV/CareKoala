# PC model integration

The deployed runtime uses Llama-3.2-1B-Instruct Q4_K_M plus the separate CareKoala v2 LoRA GGUF. It does not fall back to Qwen or to an untrained base model.

## Assets

Relative to the repository root:

```text
NewModel/CareKoala/models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf
NewModel/CareKoala/models/carekoala-lora-v2.gguf
boundary-ml 5/runtime/llama-b11036/llama-server.exe
```

Model weights are not tracked in the source publication. The asset downloader retrieves the base but not the trained adapter. `scripts/install_model_runtime.ps1` installs the pinned Windows CPU runtime with SHA-256 verification.

Set `CAREKOALA_MODEL_ROOT` or `CAREKOALA_LLAMA_SERVER` to use assets stored elsewhere. Keep the base and adapter separate; do not merge and requantize them as a replacement for the tested deployment.

## Prompt, windows and policy

`boundary_ml/trained_prompt.py` follows the contract in `NewModel/CareKoala/engine/prompt.py`. OCR speaker estimates and legacy boundary instructions are not part of the model prompt.

All text is scored in windows of at most 520 characters. The highest score wins across model windows and bounded API batches. The app does not discard evidence after the first few windows.

The response requires an integer 0-10 and a supported category. Real-mode policy is 0-5: no automatic request, 6-7: encrypted check-in, 8-10: pause and guardian unlock overlay. Categories are safe, distress, self_harm, harassment, hate_speech and violence. A displayed emergency level does not call emergency services.

Personal trigger words can request a check-in independently of the model. Manual analysis requires explicit approval to send a message. Mock output is labelled development output; real mode always uses the trained model.

## Process lifetime and failure

OCR exits before inference begins. A short-lived worker owns a CPU-only llama-server with two threads, a 2048-token context, one slot and no retained RAM cache. Model processes are released before OCR resumes. Timeout cleanup terminates the worker tree.

Missing assets, malformed scores and runtime failures are errors. They are never converted to a safe score. Screen text, model output and screenshots do not go to ntfy.sh.

## Guardian integration

The desktop uses QR/single-code enrollment with approved guardian identity. Android owns the RSA private key. Successful remote or typed unlocks produce an encrypted completion receipt; Guardian removes only the matching request and persists completion across restart. The display-sized overlay accepts mouse and keyboard input without a native-fullscreen transition.

The Android app, tray, themes, startup and domain blocker are application features, not model training behavior. See the [PC guide](README.md), [model source](../NewModel/CareKoala/README.md) and [release notes](../CHANGELOG.md).
