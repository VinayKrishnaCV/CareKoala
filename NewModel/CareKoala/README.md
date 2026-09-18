# CareKoala – on-device mental-health trigger detection

CareKoala watches what is on the screen, reads it with **EasyOCR**, and a fine-tuned
**Llama-3.2-1B-Instruct (4-bit)** gives it a **danger score from 0 to 10**. The Electron app
turns those scores into guardian alerts and the crisis protocol. Everything runs locally –
no screenshot or screen text ever leaves the laptop.

```
screen ──mss──▶ EasyOCR ──text──▶ Llama-3.2-1B Q4_K_M + CareKoala LoRA ──▶ {"score": 8, "category": "self_harm"}
 (every 20 s,    (CPU, ~1.3 GB     (llama-server on 127.0.0.1,               │
  skipped if      RAM incl. torch)   ~0.6 GB + 0.8 GB model file)            ▼
  unchanged)                                                   engine/monitor.py ──JSON lines──▶ Electron app
                                                                                                (guardian contact)
```

This follows the "Minimal & Efficient Stack" spec: EasyOCR for screen text + Llama-3.2-1B-Instruct
4-bit for trigger analysis, sized for an 8 GB RAM laptop.

## Danger scale

| score | example | default level |
|---|---|---|
| 0 | safe – news, study, code, chat, shopping, UI | none |
| 1 | everyday negativity, casual swearing | none |
| 2–3 | sadness, stress, rude or insulting language | none |
| 4–5 | hateful/abusive language, cyberbullying, depressive content with risk indicators | watch |
| 6–7 | extreme hate, calls for violence, passive death wish ("I wish I was dead") | watch / **alert at 7** |
| 8 | active suicidal ideation ("I want to kill myself"), searching for methods | **alert** |
| 9 | suicidal ideation with intent or preparation | **emergency** |
| 10 | a suicide plan with intent, or an attempt described / in progress | **emergency** |

Categories: `safe`, `distress`, `self_harm`, `harassment`, `hate_speech`, `violence`.
The alert (7) and emergency (9) thresholds are command-line flags; the policy for what happens at
each level belongs to the Electron app.

## Results

Held-out test set (883 examples never used in training), run through the real runtime:
llama-server with the 4-bit base + adapter. "Alert" means score >= 7.

| metric | untrained Llama-3.2-1B | **CareKoala** |
|---|---|---|
| crises caught (alert recall) | 4.1 % | **82.5 %** |
| alerts that were real (precision) | 16.1 % | **89.9 %** |
| texts rated 8+ that were missed (scored below 7) | 95.3 % | **9.4 %** |
| false alarms on safe / mild text (0–3) | 7.8 % | **3.3 %** |
| mean score error | 3.8 | **1.0** |
| right level (low / watch / alert / emergency) | 47.8 % | **77.7 %** |
| exact score / within ±1 | 23.8 % / 31.7 % | **56.1 % / 74.0 %** |
| category accuracy | 29.1 % | **74.3 %** |

Level confusion for CareKoala (rows = true level, columns = predicted):

| true \ predicted | low 0-3 | watch 4-6 | alert 7-8 | emergency 9-10 |
|---|---|---|---|---|
| low (461) | **388** | 58 | 15 | 0 |
| watch (205) | 47 | **153** | 5 | 0 |
| alert (160) | 15 | 21 | **123** | 1 |
| emergency (57) | 2 | 0 | 33 | **22** |

It rarely misses a crisis outright (2 of 57 emergencies scored low), but it often rates an
emergency (9–10) as an alert (7–8). If the crisis protocol matters more than the guardian
message, consider `--emergency 8`.

Hand-written screen texts that were never in any dataset (`training/sanity_check.py`):
10/13 in the expected range (untrained model: 3/13). It handles "this exam is killing me lol",
`kill -9`, a film called *Joker*, Hinglish abuse, a helpline page, "nobody would notice if I
disappeared" (7) and "taking all the pills tonight" (10). **Known misses:**

| text | expected | got |
|---|---|---|
| "I cut myself again last night, it took ages for the bleeding to stop" | 7–9 | 2 |
| "you're so ugly and fat, everyone in class hates you ... kys" | 6–8 | 3 |
| "All immigrants are vermin and should be wiped out" | 6–8 | 5 |

Non-suicidal self-harm (cutting) and "kys"-style bullying are under-represented in the public
datasets used, so the model under-scores them. That needs more targeted training data.

### Adapter v2 (`models/carekoala-lora-v2.gguf`) – fixes the self-harm / "kys" misses

v2 continued training from v1 on real self-injury posts, harmless look-alikes ("cut my hair") and
185 real messages telling someone to kill themselves (re-labelled 7). Both adapters were scored on
the same new 1,017-example test set:

| metric | v1 | v2 (default) |
|---|---|---|
| crises caught (alert recall) | 81.8 % | **89.0 %** |
| alerts that were real (precision) | **90.3 %** | 83.5 % |
| crises (8+) missed | 8.8 % | **7.6 %** |
| false alarms on safe / mild text | 4.7 % | 4.9 % |
| "kys" messages flagged | 37 % | **74 %** |
| sanity check | 10/13 | **12/13** (cutting → 8, "kys" → 7) |

v2 catches more crises but raises more alerts for hateful-but-not-crisis content. **v2 is the
default**, because a missed crisis is worse than an extra guardian alert. To use v1 instead, pass
`--lora models/carekoala-lora.gguf` to `engine/monitor.py`.

Resources measured on a 1920×1200 screen (Core Ultra 7 255H, 4 threads each):

| | RAM | time per changed screen |
|---|---|---|
| llama-server (model + adapter) | ~630 MB private + 780 MB model file (memory-mapped, reclaimable) | ~2.3 s per 520-char window |
| Python + EasyOCR (`--ocr-canvas 1280`) | ~1.3 GB peak | ~7 s |

That is ~2 GB in total, more than the spec's "~1.2 GB" estimate: EasyOCR runs on PyTorch and
needs ~1.2 GB by itself. It still leaves ~6 GB on an 8 GB laptop. Unchanged screens are
skipped, so an idle screen costs almost nothing.

## What is in this folder

| path | what |
|---|---|
| `models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf` | 4-bit base model (808 MB, unmodified Meta weights; not in git) |
| `models/carekoala-lora-v2.gguf` | **the trained CareKoala adapter, v2 – used by default** (llama.cpp format) |
| `models/carekoala-lora.gguf` | adapter v1 (higher precision, misses more self-harm / "kys") |
| `models/carekoala-lora/` | the same adapter in Hugging Face PEFT format + training log |
| `models/eval/` | evaluation reports and per-example predictions |
| `engine/monitor.py` | the process the Electron app spawns (capture → OCR → score → JSON events) |
| `engine/scorer.py`, `engine/ocr.py`, `engine/prompt.py` | scoring, OCR and the prompt format (shared with training) |
| `engine/score_text.py` | score text from the command line |
| `training/sanity_check.py` | hand-written screen texts to eyeball behaviour |
| `engine/download_assets.py` | downloads everything below that is not in git |
| `engine/models/easyocr/` | EasyOCR detector + English recogniser (not in git; checksums verified) |
| `engine/bin/` | llama.cpp b11036 CPU build for your OS (not in git) |
| `integration/electron-bridge.js` | Node helper for the Electron main process |
| `training/` | data building, training, export and evaluation scripts |
| `data/raw`, `data/processed` | source datasets and the built train/val/test sets |

## Running the engine

```bash
# one-off tests
.venv/bin/python engine/score_text.py "I can't do this anymore, I'm going to end it tonight"
.venv/bin/python engine/monitor.py --image screenshot.png

# continuous monitoring (what Electron runs)
.venv/bin/python engine/monitor.py --interval 20 --alert 7 --emergency 9
```

### Setup after cloning (Windows / macOS / Linux)

Large files are **not in git** (GitHub rejects files over 100 MB): the 771 MB base model, the
EasyOCR weights and the llama.cpp binaries. One command downloads them and verifies checksums:

```
python engine/download_assets.py          # ~900 MB: base model + EasyOCR weights + llama.cpp for this OS
```

Then Python 3.12 with the CPU build of PyTorch and the engine requirements:

```
pip install torch==2.14.0 torchvision==0.29.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-engine.txt
```

The trained adapters `models/carekoala-lora-v2.gguf` (default) and `models/carekoala-lora.gguf` (14 MB each) are in git. On macOS the app needs the
*Screen Recording* permission. To retrain, also run `training/download_base_model.sh` (tokenizer
files) and `training/download_data.sh` (raw datasets).

### Electron protocol

`engine/monitor.py` writes one JSON object per line to stdout:

```json
{"event": "ready", "interval": 20, "alert": 7, "emergency": 9, ...}
{"event": "scan", "level": "alert", "score": 8, "category": "self_harm", "confidence": 0.93,
 "expected": 8.1, "windows": 2, "excerpt": "…the text that triggered it…", "source": "monitor1",
 "chars": 812, "ocr_ms": 2900, "score_ms": 1400, "ts": "2026-09-18T10:30:00+00:00"}
{"event": "status", "state": "paused"}
{"event": "error", "message": "…"}
```

and reads commands on stdin: `pause`, `resume`, `scan`, `quit`, or
`{"cmd": "score_text", "text": "...", "id": 1}` (answers with a `score_text` event).
`excerpt` is only included for alert/emergency levels (max 280 chars) and never with `--no-excerpt`.
Scans are skipped when the screen has not changed. See `integration/electron-bridge.js`.

## How the model was trained

1. **Data** (`training/download_data.sh`, `training/build_dataset.py`) – every source is mapped onto
   the one 0–10 scale above:

   | source | used for | mapping |
   |---|---|---|
   | [Measuring Hate Speech](https://huggingface.co/datasets/ucberkeley-dlab/measuring-hate-speech) (UC Berkeley D-Lab, via hatespeechdata.com) | hate, harassment, violence, safe | IRT hate score + insult / violence / genocide ratings → 0–8 |
   | [Indo-HateSpeech](https://data.mendeley.com/datasets/snc7mxpj6t/) (Mendeley, CC BY 4.0) | Hindi-English code-mixed abuse | HS0 → 0, HS1 → 4, HSN → 6 |
   | [Cyberbullying CB1](https://huggingface.co/datasets/surrey-nlp/Cyberbullying-Detection-CB1) | cyberbullying | noisy, used lightly |
   | [C-SSRS SuicideWatch posts](https://huggingface.co/datasets/av9ash/CSSR-S_labelled_suicidewatch_posts_reddit) (Patil et al. 2025, CC BY 4.0) | graded suicide risk | Columbia scale 0→3, 1→7, 2–3→8, 4→9, 5–6→10 |
   | [Reddit C-SSRS 500 users](https://zenodo.org/records/2667859) (Gaur et al. 2019) | graded suicide risk | Supportive→2, Indicator→5, Ideation→8, Behavior→9, Attempt→10 |
   | [Suicide prediction](https://huggingface.co/datasets/vibhorag101/suicide_prediction_dataset_phr) | extra SuicideWatch examples | used sparingly (stop-words were stripped by the publisher) |
   | [self-harm-detection](https://huggingface.co/datasets/sivasothy-Tharsi/self-harm-detection) (Reddit; **no licence stated by the uploader**) | self-injury, v2 only | first-person cutting/burning/relapse posts → 8; harmless "cut/blade/scar" posts → 1 |
   | [dair-ai/emotion](https://huggingface.co/datasets/dair-ai/emotion) | "sad is not a crisis" | sadness/fear → 2, anger → 1, joy → 0 |
   | AG News, WikiText-2 | normal reading | 0 |
   | synthetic | UI text, false-positive traps ("kill -9", "this exam is killing me"), crisis-helpline search pages | 0–10 |

   The PLOS ONE paper (Vidgen & Derczynski 2020, *Directions in abusive language training data*)
   is the review behind hatespeechdata.com; it guided the choice of the graded Measuring Hate Speech
   corpus over binary datasets. 35 % of examples are wrapped in app UI text and 30 % get OCR-style
   character errors, so training data looks like real EasyOCR output. Splits are made before
   sampling (posts from one user never cross splits): 5,497 train / 482 val / 883 test.

2. **Training** (`training/train_lora.py`) – LoRA (r=16, α=32) on all attention + MLP projections
   of layers 6–15, 1 epoch, lr 2e-4, loss on the answer tokens only. The base weights are the
   *same Q4_K_M file the app runs*, de-quantized, so the adapter is trained against exactly the
   weights it is deployed on. Trained on CPU (Intel Core Ultra 7 255H, 8 threads) in 3 h 8 min.

3. **Export** (`training/export_gguf.sh`) – llama.cpp's `convert_lora_to_gguf.py` (vendored,
   commit 911f6cd). Parity with PyTorch was checked with a deliberately strong random adapter:
   llama.cpp and PyTorch agree on the next-token distribution.

4. **Evaluation** (`training/evaluate.py`) – the held-out test set run through the real runtime
   (llama-server, 4-bit base + adapter), compared against the untrained base model.

Re-run everything:

```bash
training/download_base_model.sh && training/download_data.sh
.venv/bin/python training/build_dataset.py
.venv/bin/python training/train_lora.py          # resumes from models/carekoala-lora/checkpoint
training/export_gguf.sh
.venv/bin/python training/evaluate.py && .venv/bin/python training/evaluate.py --no-lora
.venv/bin/python training/sanity_check.py
```

## Limitations – read before relying on it

- **It is a screening aid, not a clinical tool.** Scores come from a 1B model trained on public
  Reddit/Twitter data; it will miss some crises and raise some false alarms. A human (guardian,
  counsellor) must stay in the loop, and an emergency response should never depend on it alone.
- The screen shows both what the user reads and what they write; the model cannot tell them apart.
  A news article about suicide and a personal note can both score high.
- OCR language is English (Latin script). Hinglish typed in Latin script is covered by the
  Indo-HateSpeech data; Devanagari text on screen is not read.
- Self-harm training data is Reddit English; sarcasm, slang and other cultures' ways of
  expressing distress are under-represented.
- Monitoring someone's screen is sensitive. The person being monitored should know it is running.

## Licences

- Llama 3.2 is licensed under the [Llama 3.2 Community License](https://www.llama.com/llama3_2/license/).
  "Built with Llama". The adapter is a derivative and is covered by the same licence.
- EasyOCR: Apache-2.0. llama.cpp: MIT (`training/third_party/llama.cpp/LICENSE`).
- Datasets keep their own licences (see links above); cite them if you publish results.
