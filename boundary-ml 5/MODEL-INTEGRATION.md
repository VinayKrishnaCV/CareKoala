# Trained CareKoala model integration

The active app uses the supplied Llama-3.2-1B-Instruct Q4_K_M GGUF plus the
separate CareKoala v2 LoRA GGUF. It does not merge/requantize the adapter and
does not fall back to Qwen or a base-only model.

Assets are read directly from ../NewModel/CareKoala/models:
- base/Llama-3.2-1B-Instruct-Q4_K_M.gguf
- carekoala-lora-v2.gguf

The Windows CPU runtime is llama.cpp b11036 in runtime/llama-b11036.
Reinstall it with scripts/install_model_runtime.ps1 (official archive, pinned
SHA-256 verified). CAREKOALA_MODEL_ROOT may point at another copy of the supplied
CareKoala folder. CAREKOALA_LLAMA_SERVER may point at the matching executable.
Old CAREKOALA_MODEL, CAREKOALA_ADAPTER and CAREKOALA_LOAD_IN_4BIT variables are
not used by the desktop inference worker.

The prompt is copied exactly from the supplied engine/prompt.py. Text is divided
into <=520-character windows. All windows are scored; unlike the supplied monitor,
the app does not discard text after the first eight windows. Highest score wins
across model windows and Electron request batches. OCR speaker estimates and old
boundary instructions are not part of the model's training prompt.

Policy follows HANDOFF.md: 0–3 none, 4–6 watch, 7–8 alert, 9–10 emergency.
Scores >=7 recommend a guardian check-in; real mode sends the existing encrypted
ntfy check-in once per positive streak. Emergency is a displayed model level,
not a call to emergency services. The same minimal alert envelope is retained;
no score, category, screen text, or screenshot is sent to ntfy.

Manual/demo analysis displays the numeric score, category, level and decision.
Real-mode status retains the latest score. Mock mode remains explicitly marked
and uses the legacy deterministic UI test; it is not a trained-model result.

OCR exits before model inference begins. The backend launches a short-lived
inference worker, which owns a CPU-only llama-server (2 threads, 2048 context,
one slot, cache-ram 0). Both exit before OCR resumes. Timeout cleanup terminates
the whole worker process tree. Missing assets, bad model output or runtime errors
fail visibly; invalid output is never converted to a safe score.

Validation on this Windows machine: real synthetic study example 0/safe,
self-injury example 8/self_harm, imminent-risk example 10/self_harm. Real API
request returned score 1/safe for a separate homework example. Model shutdown
was verified. These are smoke checks, not a repeat of the training evaluation.
The supplied synthetic screenshot passed EasyOCR -> trained-model inference
sequentially: 15 OCR lines, score 8/self_harm, about 17 seconds overall. The
Electron score display and recommendation dialog passed an isolated UI test.
28 Python tests and 12 Electron tests passed. The old Qwen3-0.6B Hugging Face
cache directory was removed after successful trained-model verification.
The v2 handoff reports improved recall with lower precision than v1; false
positives and false negatives remain possible.

Training/evaluation files for the earlier boundary model are historical tooling;
the supplied NewModel/CareKoala/training directory owns this model's training and
evaluation. No training, Git commit or push was performed for this integration.
