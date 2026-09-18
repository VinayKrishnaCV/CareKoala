# Boundary ML

Boundary interprets short chat excerpts for three observable behaviours:

1. requests for passwords or verification codes;
2. continued pressure after a refusal; and
3. threats to withdraw transport, care, or assistance to force compliance.

It supports `no_clear_concern` and `insufficient_context`, cites message IDs, and never assigns a trust score or labels a person as abusive or criminal.

The Electron application owns OCR and platform integration. It sends normalized messages to this service:

```json
{
  "conversation_id": "local-window-42",
  "messages": [
    {"id": "M1", "speaker": "other", "text": "Send me the OTP that just arrived."},
    {"id": "M2", "speaker": "user", "text": "Why do you need it?"}
  ],
  "boundaries": ["Never share verification codes"]
}
```

## Run the complete Electron application on macOS

Use Python 3.12. From the project folder:

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-ocr.txt
python -m pip install -e . --no-deps
cd electron-app
npm install
cd ..
chmod +x scripts/start_desktop.sh
./scripts/start_desktop.sh
```

The first EasyOCR run downloads its English recognition weights. Qwen is loaded only after OCR exits. Before every later OCR run, the app calls `/model/release`, waits for Qwen memory to be released, and starts a short-lived CPU-only EasyOCR process. The OCR process exits before analysis begins.

macOS may request **Screen & System Audio Recording** permission for Electron or Terminal. Grant it under **System Settings → Privacy & Security**, then restart the desktop app. You can also choose an existing screenshot without screen-recording permission.

For a UI-only integration check without loading Qwen:

```bash
BOUNDARY_MOCK=1 ./scripts/start_desktop.sh
```

The application never sends screenshot pixels to the model backend. OCR results are editable, and analysis begins only after the user reviews the text and speaker labels.

## What has been verified

The dataset generator, schemas, output validation, metrics, API mock mode, model-release path, Node-to-API contract, local OCR fallback, Electron executable, and automated tests have been exercised without Qwen weights. Twelve backend tests and four Electron tests pass. This build environment has 15 GiB RAM, 9 CPU cores, no CUDA or Apple MPS device, and no graphical display. The Electron GUI launch reached the Linux GTK display boundary but could not create a window here. No Qwen baseline, LoRA training, checkpoint, macOS GUI result, or model accuracy result is claimed by these checks.

## Quick local verification

```bash
cd boundary-ml
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
pip install -e . --no-deps
python scripts/generate_dataset.py --output-dir data --variants-per-family 4
python -m unittest discover -s tests -v
BOUNDARY_MOCK=1 python -m uvicorn boundary_ml.api:app --host 127.0.0.1 --port 8765 --no-access-log
```

Use Python 3.10-3.12. Python 3.14 is intentionally rejected because the pinned ML stack has not been validated with it. On an Apple Silicon Mac using Homebrew, install the supported interpreter with `brew install python@3.12`, then create the environment with `/opt/homebrew/bin/python3.12 -m venv .venv`.

The mock is only for testing Electron/API integration. It is not the ML demonstration.

## Training on a GPU

Use Python 3.11 on an NVIDIA GPU with at least about 12 GB VRAM. A T4 can use 4-bit loading; larger GPUs can use BF16 LoRA. The Colab notebook in `notebooks/boundary_training.ipynb` runs generation, baseline evaluation, a smoke training run, full training, and final comparison.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-qlora.txt
pip install -e . --no-deps
python scripts/generate_dataset.py --output-dir data --variants-per-family 32

# Baseline on the held-out test and challenge sets
python scripts/evaluate.py \
  --model Qwen/Qwen3-0.6B \
  --inputs data/test.jsonl data/challenge.jsonl \
  --output reports/baseline.json

# Fast end-to-end check; produces a real adapter but is not an accuracy run
python scripts/train.py \
  --model Qwen/Qwen3-0.6B \
  --train-file data/smoke_train.jsonl \
  --val-file data/smoke_validation.jsonl \
  --output-dir outputs/smoke \
  --max-steps 8 --load-in-4bit

# Full starter experiment (increase epochs only after reviewing data)
python scripts/train.py \
  --model Qwen/Qwen3-0.6B \
  --train-file data/train.jsonl \
  --val-file data/validation.jsonl \
  --output-dir outputs/boundary-qwen3-0.6b-lora \
  --epochs 3 --load-in-4bit

python scripts/evaluate.py \
  --model Qwen/Qwen3-0.6B \
  --adapter outputs/boundary-qwen3-0.6b-lora \
  --inputs data/test.jsonl data/challenge.jsonl \
  --output reports/finetuned.json

python scripts/compare_reports.py \
  reports/baseline.json reports/finetuned.json \
  --output reports/comparison.md
```

Near-duplicate leakage is controlled by assigning scenario families to splits before creating variants. `challenge.jsonl` is separately authored. `multilingual_exploratory.jsonl` is excluded from training and must be reviewed by fluent speakers before any multilingual claim.

## Dataset review

All labels are synthetic and provisional. Open `data/review.csv`, have two reviewers independently set `review_decision` to `accept`, `edit`, or `reject`, record notes, and adjudicate disagreements. If a label or message changes, update the corresponding JSONL example and regenerate `data/metadata.json`. Do not put private chats into this repository.

The expanded generator repeats carefully authored scenario families through surface variations. It is useful for pipeline development; variation count is not evidence of real-world quality.

## Run the model API

```bash
export BOUNDARY_MODEL=Qwen/Qwen3-0.6B
export BOUNDARY_ADAPTER=outputs/boundary-qwen3-0.6b-lora  # optional
export BOUNDARY_ALLOWED_ORIGINS=http://localhost:5173
python -m uvicorn boundary_ml.api:app --host 127.0.0.1 --port 8765 --no-access-log
```

`POST /analyze` accepts up to 40 messages, 2,000 characters per message, and 20,000 characters total. Raw message text is not logged or retained. Each request is interpreted independently. The server binds locally in the documented command; do not expose it publicly without transport security and authentication. Remote deployment sends conversation content off the user's device.

Example:

```bash
curl -s http://127.0.0.1:8765/analyze \
  -H 'content-type: application/json' \
  -d @examples/request.json
```

Expected response shape is in `examples/response.json`. A generation or validation failure returns HTTP 503 with `status: analysis_unavailable`.

## Electron integration

OCR should happen locally. Group visible lines into messages, assign stable IDs, label the current user's messages as `user`, and send only a short visible context window. Do not send screenshots to this backend. Use one `conversation_id` per chat and never combine people or chats. OCR confidence and screenshot capture permissions belong in the Electron layer.

For the demo, show the normalized text to the user before analysis so OCR mistakes are visible and editable.
