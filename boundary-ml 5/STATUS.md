# Execution status

## Run in this environment

- Hardware inspection: Linux, 9 CPU cores, 15 GiB RAM, no CUDA device, no Apple MPS.
- Synthetic dataset generation and split validation.
- Twelve backend tests covering schema and evidence validation, model release, API input handling, and evaluation behaviour.
- Four Electron tests covering package entry points, content security policy, preload isolation, and serialized heavy operations.
- Node-to-FastAPI integration for health, analysis, and model release.
- Local OCR against the supplied screenshot using the Tesseract fallback: 32 text lines extracted.
- Electron 38.2.1 installed and its executable verified in Node mode.
- Metric behaviour test for invalid model output.
- Python syntax compilation.
- Local API transport in deterministic mock mode.

The actual Electron GUI executable was launched twice with headless flags. This managed Linux container has no X11/Wayland display or DBus permission, so GTK terminated before a window could be created. This is an environment limitation recorded from the launch attempt, not a successful GUI run. The app is intended to launch normally on the user's macOS desktop.

## Prepared but not run here

- Downloading Qwen/Qwen3-0.6B weights.
- Baseline model evaluation.
- LoRA or QLoRA training.
- Fine-tuned evaluation and model comparison.
- A visual Electron window launch on macOS.
- EasyOCR model-weight execution; EasyOCR remains the primary configured engine, while the installed local Tesseract fallback was executed here.

The blocker is the absence of an accelerator in the execution environment. CPU training of this model would be too slow for the hackathon workflow. Run `notebooks/boundary_training.ipynb` on a GPU runtime or follow the GPU commands in the README. No checkpoint or accuracy value is claimed until the report files are produced.
