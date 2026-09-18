# CareKoala – handoff for the next agent

Written 2026-09-18 (21:20 IST) at the end of the first training session. Read this first, then
`README.md` (user-facing docs, results, Electron protocol). Everything below was verified in
that session unless marked *unverified*.

---

## 1. TL;DR

- **Done:** Llama-3.2-1B-Instruct (4-bit Q4_K_M) was LoRA-fine-tuned on CPU to output a
  mental-health **danger score 0–10 + category** for OCR'd screen text. It is exported to
  llama.cpp format and wrapped in a working engine (screen capture → EasyOCR → llama-server →
  JSON-lines events for Electron). Tested end to end on this machine.
- **Result on 883 held-out examples:** crisis recall (score ≥ 7) went from 4.1 % to **82.5 %**,
  precision from 16 % to **90 %**, and crises (8+) missed from 95 % to **9.4 %**; false alarms on
  safe/mild text are 3.3 %.
- **Main open problem:** non-suicidal self-harm ("I cut myself again…" → scored 2) and "kys"
  bullying ("…everyone hates you, kys" → scored 3) are under-scored because the training data
  barely covers them. **The user was offered a targeted data and retraining round and had not yet
  answered.** The user then asked for this handoff.
- **Large files are not in git** (`.gitignore`): run `python engine/download_assets.py` after
  cloning (base model + EasyOCR weights + llama.cpp, checksums verified), plus
  `training/download_base_model.sh` and `training/download_data.sh` to retrain.
- **Git warning:** this folder is a clone of `github.com/VinayKrishnaCV/CareKoala` and contains a
  teammate's *different* project, `boundary-ml 5/`, at HEAD. Those files are **not on disk**, so
  `git status` shows them as deleted. Don't commit that deletion (see §11).

## 1b. Session 2 – adapter v2 (started 21:50 IST, 2026-09-18)

The user said "continue" after this handoff was written, which was read as a yes to fixing the
self-harm and "kys" gap:

- **Data** (`training/build_dataset.py`, clearly marked "v2"):
  - `directed()` lifts people being told to kill or hurt themselves (`DIRECTED_SELF_HARM_RE`,
    skipping reported speech via `REPORTED_RE`) from MHS and CB1 to **score 7 / harassment**.
    Items already ≥7 keep their category. Their `source` is prefixed `kys_`. All 185 matches are
    kept, not just the sampled share.
  - New source `self_injury()`: `data/raw/selfharm_detection.parquet`
    (`sivasothy-Tharsi/self-harm-detection`, 206 MB, Reddit, **no licence stated**). "self-harm"
    posts with a first-person act (`SELF_INJURY_RE`) in the first 420 chars → **8 self_harm**
    (pool `nssi`, 1,441 available). "non-self-harm" posts that only use cut/blade/scar/burn words
    → **1 safe** (pool `nssi_neg`, 1,282 available).
  - The new pools are processed after every v1 pool and extras are appended at the end, so
    **v1's train/val/test membership is unchanged**. Verified: 0 v1-train texts in the v2
    test/val sets, 862/883 v1 test rows are verbatim (the rest are re-augmented synthetic rows),
    and no v1 test label changed.
  - The v1 splits are backed up in `data/processed/v1/`. New splits: 6,273 / 553 / 1,017.
- `training/make_update_set.py` → `data/processed/train_update.jsonl`: 784 new examples plus a
  1,200-example replay = 1,984.
- **Training:** `train_lora.py --init-adapter ../models/carekoala-lora --train-file train_update
  --lr 1e-4 --out ../models/carekoala-lora-v2` (128 steps, ~1 h). New flags: `--init-adapter`,
  `--train-file`. `export_gguf.sh` now takes the adapter directory as an argument. `evaluate.py`
  has `--name`; `sanity_check.py` has `--lora`.
- **Evaluation plan:** v1 and v2 on the *same* new 1,017-example test set
  (`models/eval/v1_on_test_v2.json` vs `v2_on_test_v2.json`, plus the sanity check). **Ship v2
  only if** it improves the `nssi` / `kys_*` sources without regressing overall alert
  recall/precision or false alarms.
- **Still to do after that:** point `DEFAULT_LORA` in `engine/scorer.py` at the better adapter,
  and update README results and licences (add the sivasothy dataset, no licence stated).

**Result (23:10 IST):** v2 was evaluated (`models/eval/v2_on_test_v2.json`).
- Compared with v1 on the same 1,017 rows: recall 81.8 → 89.0 %, precision 90.3 → 83.5 %, F1 0.858
  → 0.861, false alarms 4.7 → 4.9 %, crises missed 8.8 → 7.6 %.
- `kys_*` flagged 37 → 74 %; `nssi_neg` false alarms 24 → 21 %. Sanity check 12/13 (the cutting
  case → 8 and the "kys" case → 7 are now fixed; only "immigrants are vermin…" (5) still misses).
- Precision fell because more gold 4–6 (hate) items are now scored 7+.
- The default was left at v1 at first, because precision regressed. After the user said
  "continue", **the default was switched to v2** (`DEFAULT_LORA` in `engine/scorer.py`) on the
  grounds that a missed crisis is worse than an extra alert. The test screenshot gives emergency
  10. v1 is still available with `--lora models/carekoala-lora.gguf`.

Earlier: the user stopped the post-training job after the export.
- v2 **trained** (`models/carekoala-lora-v2/`; val loss 0.099 vs v1's 0.102, exact 52.5 %, within
  ±1 68.8 %) and **exported** (`models/carekoala-lora-v2.gguf`).
- v2 is **not evaluated yet**, and **the engine still uses v1** (`DEFAULT_LORA`).
- v1 on the new test set (`models/eval/v1_on_test_v2.json`, 1,017 rows):
  - Overall: alert recall 81.8 %, precision 90.3 %, false alarms 4.7 %, crises (8+) missed 8.8 %.
  - `nssi`: 96 % already flagged ≥7. The long Reddit posts carry many cues, so v1's weakness is
    short, explicit self-injury lines.
  - `nssi_neg` (label 1): **24 % false-alarmed ≥7**, mean score 3.0.
  - `kys_*` (label 7): only **37 % flagged**, mean score 5.8.
- To finish, run each on its own (don't run them in parallel with other CPU jobs):
  ```
  .venv/bin/python training/evaluate.py --threads 8 --lora models/carekoala-lora-v2.gguf --name v2_on_test_v2   # ~15 min
  .venv/bin/python training/sanity_check.py --lora models/carekoala-lora-v2.gguf                               # ~1 min
  ```
  Then compare against `v1_on_test_v2.json`, especially the `nssi_neg` false alarms, the `kys_*`
  recall, and overall recall/precision.

## 2. The user and the original request

- The user (email vinaykrishnacv@gmail.com) is **new to ML training** ("i have no idea how to
  train the ai") and wants the agent to do all of the training. They combine outputs from several
  AI agents and want the spec followed. Explain results in plain language and deliver runnable
  scripts rather than instructions.
- **The spec** (image `~/Downloads/WhatsApp Image 2026-09-18 at 3.57.19 PM.jpeg`, "The Minimal &
  Efficient Stack"):
  - 1. Screen capture & OCR: **EasyOCR** (or Tesseract), claimed ~100–200 MB RAM.
  - 2. Trigger analysis: **Llama-3.2-1B-Instruct, 4-bit quantized**, ~800 MB–1 GB.
  - Total ~1.2 GB, for an **8 GB RAM Windows/macOS laptop**.
  - A unified vision-language model (Phi-3 Vision / LLaVA) was explicitly rejected as too heavy.
- **User's words:** "using EasyOCR … pretrained local ai model will get text from Easy OCR, give a
  danger score out of 10, app made in electron will handle guardian contact and necessary
  protocol". The Electron app is **not** this agent's job; this project provides the engine it
  spawns.
- **Datasets the user linked:**
  - https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0243300 – Vidgen &
    Derczynski 2020, *Directions in abusive language training data* (a review, not a dataset).
  - hatespeechdata.com – that paper's dataset catalogue.
  - https://data.mendeley.com/datasets/snc7mxpj6t/ – **Indo-HateSpeech** (Hindi-English
    code-mixed Instagram comments, CC BY 4.0).
- **Additions this session:** the user's links are hate-speech only, so suicide/self-harm
  datasets (C-SSRS) were added. Monitoring "mental health triggers" requires them.

## 3. File map (project root `/home/Riggle19/Projects/CareKoala`)

| path | what |
|---|---|
| `README.md` | user-facing docs: danger scale, results, running, Electron protocol, training, licences |
| `HANDOFF.md` | this file |
| `models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf` | base model (bartowski Q4_K_M, 808 MB) + HF tokenizer/config files from `unsloth/Llama-3.2-1B-Instruct` (ungated mirror) |
| `models/carekoala-lora/` | **trained adapter**, HF PEFT format (`adapter_model.safetensors` 28 MB fp32), `train_log.jsonl`, `train_args.json` |
| `models/carekoala-lora.gguf` | v1 adapter in llama.cpp GGUF (f16, 14 MB). **v2 (`models/carekoala-lora-v2.gguf`) is now the default**, see §1b |
| `models/eval/` | `base_zero_shot.json`, `carekoala_finetuned.json` (+ per-example predictions, server logs) |
| `engine/prompt.py` | **single source of truth** for the prompt/answer format, used by training AND runtime |
| `engine/scorer.py` | `LlamaServer` (spawns llama-server) + `DangerScorer` (windowing, caching, score probabilities) |
| `engine/ocr.py` | `ScreenCapture` (mss; `grim` on Wayland), change detection, `OCR` (EasyOCR, line grouping) |
| `engine/monitor.py` | **the process Electron spawns**; JSON-lines protocol (see §8) |
| `engine/score_text.py` | CLI: score raw text |
| `engine/models/easyocr/` | `craft_mlt_25k.pth` + `english_g2.pth` (MD5-verified against EasyOCR's config) |
| `engine/bin/linux-x64/llama-b11036/` | llama.cpp release b11036 CPU binaries (Linux) |
| `integration/electron-bridge.js` | Node helper: spawn monitor.py, parse events, send commands |
| `training/download_base_model.sh`, `training/download_data.sh` | resumable downloads (curl) |
| `training/build_dataset.py` | builds `data/processed/{train,val,test}.jsonl` |
| `training/train_lora.py` | CPU LoRA training (resumes from `models/carekoala-lora/checkpoint/`) |
| `training/export_gguf.sh` | PEFT → GGUF LoRA via vendored `convert_lora_to_gguf.py` |
| `training/evaluate.py` | test-set eval through llama-server (`--no-lora` = baseline) |
| `training/sanity_check.py` | 13 hand-written screen texts with expected ranges |
| `training/third_party/llama.cpp/` | vendored conversion scripts + gguf-py, commit 911f6cdc8 (= b11036), MIT |
| `tools/pdl.py` | parallel, resumable HTTP range downloader (needed on this network, §10) |
| `tools/verify_lora_parity.py` | checks llama.cpp (base.gguf + lora.gguf) matches PyTorch (dequantized base + PEFT) |
| `tools/test_chat.png` | synthetic WhatsApp screenshot ending in "…take all the pills tonight…" (expected: emergency) |
| `requirements-engine.txt`, `requirements-train.txt` | pinned deps (CPU torch installed separately) |
| `data/raw/` | downloaded datasets (~40 MB); `data/processed/` built splits: 5,497 / 482 / 883 |

## 4. Architecture and key decisions (and why)

```
screen ─mss/grim─▶ EasyOCR (canvas 1280) ─text─▶ split into ≤520-char windows ─▶ llama-server
  (Q4_K_M base + LoRA GGUF, 127.0.0.1) ─▶ worst window wins ─▶ JSON event on stdout ─▶ Electron
```

1. **The LoRA is trained on the de-quantized Q4_K_M GGUF itself** (transformers
   `from_pretrained(..., gguf_file=...)`) and deployed as a **separate LoRA GGUF** on the same
   base. Do **not** merge the LoRA into the base and re-quantize: the base weights already sit on
   the Q4 grid, so re-quantizing snaps small LoRA deltas back to the original values and erases
   the fine-tune. Keeping them separate means training and inference use identical weights. The
   16-bit base (2.5 GB) was never downloaded because of the network (§10).
2. **The runtime is `llama-server` (llama.cpp b11036), not llama-cpp-python.** The only prebuilt
   llama-cpp-python CPU wheel (0.3.19 on abetlen's index) is a **musl** build and fails on glibc
   ("libc.musl-x86_64.so.1 not found"). Newer versions exist only as a 75 MB source package that
   needs compiling. llama-server has official prebuilt Windows/macOS/Linux binaries, which is
   right for an Electron bundle.
3. **Parity verified:** a deliberately strong random LoRA gave the same next-token
   distributions in llama.cpp and PyTorch (for example PyTorch '8' −0.935 / '0' −1.931 vs
   llama.cpp '8' −0.946 / '0' −2.085). Re-run with `tools/verify_lora_parity.py` if the
   converter or llama.cpp version changes.
4. **llama-server flags** (in `scorer.py`): `-c 2048 -np 1 -t N --no-webui --cache-ram 0`.
   **`--cache-ram 0` matters:** by default llama-server keeps up to 8 GB of old prompts in RAM,
   and its private RAM grew from ~0.6 to ~1.9 GB during an evaluation. Requests use
   `cache_prompt: true`, so the shared system-prompt prefix is still reused inside the slot.
5. **BOS:** llama-server adds `<|begin_of_text|>` itself, so `scorer.py` strips it from the
   prompt. Token counts were checked to match PyTorch exactly.
6. **Prompt contract** (`engine/prompt.py`): the Llama-3 chat format is written out by hand,
   because the tokenizer's default template injects a ~25-token "Cutting Knowledge Date" header.
   - System prompt: `CareKoala: rate screen text danger to mental health 0-10. Categories: safe, distress, self_harm, harassment, hate_speech, violence. Reply JSON.`
   - Answer: `{"score": N, "category": "..."}<|eot_id|>`. At inference the prefix `{"score": `
     is **forced**, so the first generated token is the score digit. `n_probs: 11` gives the
     score distribution, from which the engine reports `confidence` = p(chosen score) and
     `expected` = E[score].
   - `MAX_TEXT_CHARS = 520` per window; training capped prompts at 300 tokens.
7. **The score/category decision uses the most dangerous window** of a screen (at most 8 windows
   per screen). Results are cached per window text (LRU 512), because scrolling repeats text.

## 5. Data (`training/build_dataset.py`)

Each source is mapped onto one scale (0 safe · 1 casual negativity · 2–3 distress / mild
harassment · 4–5 hate / abuse / depressive risk indicators · 6–7 extreme hate, violence, passive
death wish · 8 active suicidal ideation · 9 ideation with intent/preparation · 10 plan/attempt):

| pool | source | mapping | train n |
|---|---|---|---|
| mhs_* | `ucberkeley-dlab/measuring-hate-speech` (39,565 comments) | IRT `hate_speech_score` bands (≥3→7, ≥2→6, ≥1→5, ≥0.3→4, ≥−1→2, else 0) maxed with insult/humiliate means; violence or genocide ≥3 → 7 (8 if hs ≥ 2.5), category violence; porn spam dropped from "safe" | 300 safe, 300 harass, 420 hate, 220 violence |
| indo_* | Indo-HateSpeech xlsx (HS0/HS1/HSN = none/hateful/extreme) | 0 / 4 / 6, `hate_speech`; ≥3 words | 250 / 200 / 170 |
| cb_* | `surrey-nlp/Cyberbullying-Detection-CB1` (noisy: "age" is mostly people recalling school bullying, "other" is mostly benign) | not→0; gender/religion/ethnicity→4; age→3; other dropped | 200 / 240 / 80 |
| cssrs_low / cssrs_risk | `av9ash/CSSR-S_labelled_suicidewatch_posts_reddit` (1,170, C-SSRS 0–6) | 0→3 distress; 1→7, 2→8, 3→8, 4→9, 5→10, 6→10 self_harm; risk sentence kept inside the window by `focus()` | 277 / 655 |
| cssrs_users_* | Zenodo 2667859 Reddit C-SSRS, 500 users with user-level labels; some cells cut at Excel's 32,767-char limit | Supportive→2, Indicator→5 distress; Ideation→8, Behavior→9, Attempt→10 (only posts matching `SELF_HARM_RE`); ≤2 posts per user, users never cross splits | 300 / 307 |
| sp_* | `vibhorag101/suicide_prediction_dataset_phr` (test split only; publisher removed stopwords, so text is unnatural) | suicide + regex match → 8; non-suicide → 1 | 250 / 120 |
| emo_* | `dair-ai/emotion` | sadness/fear→2 distress, anger→1, joy/love/surprise→0 | 300 / 70 / 160 |
| news, wiki | AG News test, WikiText-2 | 0 | 200 / 160 |
| synth_* | handwritten in `build_dataset.py` | UI-only screens 0; hard negatives ("kill -9", "exam is killing me") 0–1; Google crisis-banner searches 8–10; awareness page 3 | ~317 |

Augmentation: 35 % wrapped in fake app UI text (browser/social/chat/YouTube/Discord/OS/code),
optionally mixed with a harmless snippet (label = worst part), with the extra text budgeted so the
labelled text is never clipped. 30 % get OCR noise (l↔1, rn↔m, dropped apostrophes…). Splits are
80/10/10 per pool before sampling. Final: **train 5,497 / val 482 / test 883**, with scores 0–10
all represented.

## 6. Training (`training/train_lora.py`)

- LoRA r=16, α=32, dropout 0.05, targets q/k/v/o/gate/up/down, **layers 6–15 only**, so
  backprop stops half-way down (7.0 M trainable parameters).
- The loss is on answer tokens only, and the 128k-vocabulary `lm_head` is applied **only at
  those positions**, which saves ~20 % of compute on CPU.
- AdamW lr 2e-4, 5 % warmup, cosine down to 10 %, batch ≤8 and ≤1,600 padded tokens, grad accum
  2, 1 epoch = **354 optimizer steps**. Batches are length-bucketed.
- **CPU:** Intel Core Ultra 7 255H, `--threads 8` (benchmarked 6 → 104, 8 → 105, 12 → 92,
  16 → 65 tok/s; the efficiency cores slow things down). About 60–70 tok/s in the real run,
  **3 h 8 min** in total.
- **OOM lesson:** the first run was killed by the kernel OOM killer at step 25. Some examples
  were ~975 tokens (emoji/Devanagari) and CPU attention materialises T×T scores. The fix was a
  300-token prompt cap plus the token-budget batching; peak RAM is now ~10 GB of 30.
- Loss 1.78 → ~0.08. Validation on a quick 160-example subset (teacher-forced score token):

  | step | val loss | exact | within ±1 |
  |---|---|---|---|
  | start | — | 17.5 % | 25.6 % |
  | 100 | 0.129 | 45.0 % | 61.9 % |
  | 200 | 0.110 | 44.4 % | 65.0 % |
  | 300 | 0.105 | 43.8 % | 63.7 % |
  | 354 | 0.102 | 46.3 % | 63.1 % |

- A checkpoint is saved every 25 steps. The finished run's `checkpoint/` was deleted. If
  `models/carekoala-lora/checkpoint/` exists, `train_lora.py` resumes from it, so delete it
  before a fresh run. Changing the data or batching changes the batch plan, so don't resume across
  such changes.
- The GPU (RTX PRO 500 Blackwell, 6 GB) was **not used**: CUDA PyTorch is ~3.5 GB to download
  on this network (§10), and the connection might be metered. With CUDA torch, the same run would
  take minutes and would allow more data and epochs.

## 7. Results (`models/eval/*.json`)

| metric | untrained base | CareKoala |
|---|---|---|
| alert (≥7) recall / precision / F1 | 4.1 % / 16.1 % / 0.066 | **82.5 % / 89.9 % / 0.861** |
| crises (gold ≥8) predicted <7 | 95.3 % | **9.4 %** |
| false alarms on gold 0–3 | 7.8 % | **3.3 %** |
| MAE / exact / within ±1 | 3.80 / 23.8 % / 31.7 % | **1.03 / 56.1 % / 74.0 %** |
| level accuracy (0-3 / 4-6 / 7-8 / 9-10) | 47.8 % | **77.7 %** |
| category accuracy | 29.1 % | **74.3 %** |

Level confusion for the fine-tuned model (rows = gold):

| | low | watch | alert | emergency |
|---|---|---|---|---|
| low (461) | 388 | 58 | 15 | 0 |
| watch (205) | 47 | 153 | 5 | 0 |
| alert (160) | 15 | 21 | 123 | 1 |
| emergency (57) | 2 | 0 | 33 | 22 |

So **emergencies are often scored 7–8**. The README suggests `--emergency 8` if the crisis
protocol matters more than the guardian message.

Per-source MAE (fine-tuned) is highest for `indo_hsn` 2.5, `cssrs_users_risk` 1.9, `sp_non`
1.85, `mhs_violence` 1.75, `cssrs_users_low` 1.71 and `indo_hs0/hs1` ~1.65.

**Sanity check** (`training/sanity_check.py`): fine-tuned 10/13, base 3/13. The fine-tuned
model's misses:

| text | expected | got |
|---|---|---|
| "I cut myself again last night, it took ages for the bleeding to stop. nobody knows" | 7–9 | **2** distress |
| "you're so ugly and fat, everyone in class hates you. do us all a favour and kys" | 6–8 | **3** harassment |
| "All immigrants are vermin and should be wiped out before they breed" | 6–8 | 5 hate_speech |

**Resources** (1920×1200 screen, 4 threads each):

| process | RAM | time |
|---|---|---|
| llama-server | ~630 MB private, plus 780 MB of memory-mapped model file | ~2.3 s per 520-char window (4 threads); ~1.0 s per example with 8 threads |
| Python + EasyOCR | ~1.3 GB peak at `canvas_size=1280` (2.27 GB at the default 2560) | ~7 s (11.8 s at 2560); 1280 still reads ~95 % of the words |

The spec's "~1.2 GB total" is **not achievable with EasyOCR**, because PyTorch + EasyOCR alone
is ~1.2 GB. Tesseract (the spec's alternative) would be far lighter but less accurate on UI
text.

## 8. Engine ↔ Electron protocol (`engine/monitor.py`)

- **Start:** `python engine/monitor.py --interval 20 --alert 7 --emergency 9 [--no-excerpt]
  [--langs en] [--llm-threads 4] [--ocr-threads 4] [--ocr-canvas 1280] [--base …] [--lora …]
  [--llama-server PATH]`. With `--image file.png` it scores one image and exits.
- **stdout (JSON lines):**
  - `ready`
  - `scan` {level none/watch/alert/emergency, score, category, confidence, expected, windows,
    excerpt (only at alert+ and ≤280 chars), source, chars, ocr_ms, score_ms, ts}
  - `status` {state}
  - `score_text`
  - `error`
- **stdin:** `pause` | `resume` | `scan` | `quit` | `{"cmd":"score_text","text":…,"id":…}`.
  The engine also exits when stdin closes.
- Levels: none 0–3, watch 4–6, alert 7–8, emergency 9–10 (the thresholds are flags).
- A monitor whose screen is unchanged is skipped (96-px grayscale thumbnail, mean absolute
  difference > 2).
- **Known gap:** if Python is killed hard, the `llama-server` child can be orphaned. The Electron
  side (or a future engine change) should kill the process tree.
- `integration/electron-bridge.js` shows the wiring.
- On a Windows/macOS target: install CPU torch 2.14 + `requirements-engine.txt`; unpack
  llama.cpp **b11036** `llama-b11036-bin-win-cpu-x64.zip` / `…-macos-arm64.tar.gz` into
  `engine/bin/<anything>/`. `find_llama_server()` globs `engine/bin/*/**/llama-server[.exe]`.
  macOS needs Screen Recording permission.
- **Not tested on Windows/macOS.**

## 9. Suggested next steps (in priority order)

1. **Fix the self-harm and "kys" gaps** (this was offered to the user, who had not yet
   answered):
   - Add data for non-suicidal self-injury (cutting, burning, relapse talk, "clean for N days") at
     7–9, and for **directed self-harm encouragement / cyberbullying at the user** ("kys", "go die",
     "nobody would care if you died") at 7–8.
   - Candidate HF datasets found by search but **not inspected or licence-checked**:
     `sivasothy-Tharsi/self-harm-detection`, `MindCastSogang/selfharm`, `yiting/Self-harm_Dataset`,
     `sso5803/self-harm`, `AdamLeung/twitter_suicidal_risk`, `jingjietan/sdcnl-suicide`,
     `surrey-nlp/Cyberbullying-Detection-CB2`, `solomonk/reddit_mental_health_posts`
     (depression/ptsd CSVs, ~17–30 MB each).
   - **Do not write training examples that paraphrase the 13 sanity cases.** They are the only
     untouched qualitative check.
   - Retraining: either continue from the current adapter (fast, but beware forgetting; mix in a
     replay sample of the old train set) or retrain from scratch with the enlarged set (~3 h+ on
     CPU at current size). Then run `export_gguf.sh`, `evaluate.py` and `sanity_check.py`, and
     compare with `models/eval/carekoala_finetuned.json`.
2. **Emergency under-scoring** (9–10 predicted as 7–8): more 9–10 examples, or recalibrate using
   `expected` (e.g. emergency if expected ≥ 8.5), or recommend `--emergency 8`.
3. **RAM on the 8 GB target:** measure on a real 8 GB Windows/Mac. Options:
   - `--ocr-canvas 1024`.
   - llama-server `--no-repack` (less RAM, slower; not measured).
   - Tesseract instead of EasyOCR (much lighter; the spec allows it).
   - OCR in a short-lived process, as the teammate's Boundary app does.
4. Kill the llama-server orphan on crash: a process group or job object on Windows, or have the
   Electron side kill the tree.
5. Devanagari OCR: no `hi` EasyOCR weights are downloaded (`devanagari_g2.zip` did not exist at
   the URL tried), so only Latin-script Hinglish is covered.
6. Optional: use the GPU with CUDA torch (if the network allows), for more data, 2–3 epochs and
   LoRA on all 16 layers.

## 10. Environment and gotchas (this machine)

- Arch Linux, Hyprland (**Wayland**, so `mss` can't capture; `ocr.py` falls back to `grim`),
  Core Ultra 7 255H (6P+8E+2LP), 30 GB RAM, RTX PRO 500 Blackwell 6 GB (unused), zsh.
- **Python:** system Python is 3.14; the project uses `.venv` (Python 3.12.14, created by `uv`,
  **no pip inside**). The `uv` binary used this session lived in a temp scratch dir that is
  gone. Reinstall with `python3 -m venv /tmp/bs && /tmp/bs/bin/pip install uv`, then
  `/tmp/bs/bin/uv pip install --python .venv <pkgs>`, or run `.venv/bin/python -m ensurepip`.
- **Installed:** torch 2.14.0+cpu, torchvision 0.29.0+cpu, transformers 5.17.0, peft 0.21.0,
  accelerate 1.15.0, tokenizers 0.23.2, pandas 3.0.6 (note: `astype(str)` keeps NaN, so use
  `fillna("")` first), pyarrow 25.0.1, easyocr 1.7.2, opencv-python-headless 5.0.0.93, mss 10.2.0,
  gguf 0.19.0 (from vendored gguf-py).
- **Installing packages without pulling CUDA:** a plain `pip install easyocr` pulls **~3.5 GB of
  CUDA packages**. Install CPU torch from `https://download.pytorch.org/whl/cpu` first, then keep
  it pinned.
- **Network:** varied 50 KB/s–1.7 MB/s and at its worst was throttled per connection
  (~10–20 KB/s each). Single-stream pip/curl downloads of big files crawl; `tools/pdl.py URL OUT
  --conns 6` works well. GitHub release downloads returned **504** for a while; Hugging Face
  mirrors worked (the CRAFT weights came from `Manbehindthemadness/craft_mlt_25k`, MD5-verified).
  Ask before multi-GB downloads, because the connection may be metered.
- `pkill -f <pattern>` run through a shell tool kills that shell too (the pattern is in its own
  command line). Kill by PID from `pgrep` with an anchored pattern instead.
- **llama-server task IDs** go up by ~13 per request (per token), so a big `id_task` in `/slots`
  does not mean a hang. That was misread once this session.
- Throughput on this CPU: evaluation ~2.5 s/example with 4 threads while training ran in
  parallel; ~1.0 s/example with 8 threads when idle.

## 11. Git state – be careful

- **The user's explicit rule: never add an AI as author, co-author or collaborator.** That means
  no `Co-Authored-By: Claude…` (or any AI) trailer in commits, no "Generated with …" lines in PRs,
  no AI credits in files, and no bot or AI GitHub collaborator invites.

- The remote is `origin https://github.com/VinayKrishnaCV/CareKoala`, the local branch is
  `master`, and there is a remote `origin/main`. HEAD = `119c56d "Add files via upload"`
  (author: teammate "Akshith", 2026-09-18 18:00 IST).
- That commit contains **`boundary-ml 5/`**, a *different* project: "Boundary ML" detects
  coercion (OTP/password requests, pressure after refusal, threats to withdraw care) with
  **Qwen3-0.6B + FastAPI (`127.0.0.1:8765`, `/analyze`, `/model/release`) + an Electron app**
  (`electron-app/main.js`, `python/ocr_easy.py`), targeting macOS. Its STATUS.md says its model
  was never trained.
- Those files are **in the index/HEAD but not on disk**, so `git status` lists ~280 of them as
  ` D`. The index also has `A .claude/scheduled_tasks.lock` and `AM README.md`, staged by someone
  else.
- **Pushed 2026-09-18 23:20 IST:** branch `carekoala-model`, commit `c56b18a` (author VinayKrishnaCV,
  183 files, only additions, no AI trailer). It is not merged into `main` yet; PR link:
  https://github.com/VinayKrishnaCV/CareKoala/pull/new/carekoala-model. `boundary-ml 5/` is intact
  on the branch. The local `.gitignore` keeps models/base, data/raw, engine/models, engine/bin,
  checkpoints and `.venv` out of git.
- Earlier notes (before the push): none of the CareKoala work was committed. Before committing:
  1. Ask the user how the two projects should live together (for example CareKoala in its own
     folder, or on its own branch).
  2. Restore the teammate's files with `git restore -- "boundary-ml 5"` if they should stay.
  3. Add a `.gitignore` for `.venv/`, `models/**/*.gguf`, `models/**/*.safetensors`,
     `data/raw/`, `engine/bin/`, `engine/models/`, `models/eval/*_server.log` (large or binary).
  4. Don't commit `.claude/scheduled_tasks.lock`.
- The Boundary Electron app might be adaptable as CareKoala's Electron shell, but its contract
  (HTTP request/response with message lists) differs from CareKoala's (spawned process +
  JSON-lines events).

## 12. Reproduce from scratch

```bash
training/download_base_model.sh && training/download_data.sh   # or tools/pdl.py on a slow link
.venv/bin/python training/build_dataset.py
.venv/bin/python training/train_lora.py            # ~3 h on this CPU, resumable
training/export_gguf.sh
.venv/bin/python training/evaluate.py && .venv/bin/python training/evaluate.py --no-lora
.venv/bin/python training/sanity_check.py
.venv/bin/python engine/monitor.py --image tools/test_chat.png   # expect level=emergency, score 10
```

Agent memory notes for this project are in
`~/.claude/projects/-home-Riggle19-Projects-CareKoala/memory/`: `user-ml-novice.md`,
`carekoala-architecture.md` and `dev-machine-network.md`.
