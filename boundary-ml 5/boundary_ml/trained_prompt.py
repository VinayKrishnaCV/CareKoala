"""The prompt contract shared by training, evaluation and the runtime engine (single source of truth).

Training and inference MUST build prompts with these helpers, otherwise the fine-tuned
model sees text formatted differently from what it learned on.
"""
import json
import re

CATEGORIES = ["safe", "distress", "self_harm", "harassment", "hate_speech", "violence"]

# Kept short on purpose: every prompt token costs latency on an 8 GB laptop (and CPU training time).
SYSTEM_PROMPT = (
    "CareKoala: rate screen text danger to mental health 0-10. "
    "Categories: safe, distress, self_harm, harassment, hate_speech, violence. Reply JSON."
)

MAX_TEXT_CHARS = 520  # ~120 tokens; the engine splits longer screens into windows

# Llama 3 chat format written out by hand so the tokenizer's default system header
# ("Cutting Knowledge Date ...") is NOT injected - that would waste ~25 tokens per call.
_PROMPT = (
    "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|>"
    "<|start_header_id|>user<|end_header_id|>\n\n{text}<|eot_id|>"
    "<|start_header_id|>assistant<|end_header_id|>\n\n"
)
ANSWER_PREFIX = '{"score": '


def build_prompt(text: str) -> str:
    return _PROMPT.format(system=SYSTEM_PROMPT, text=clip_text(text))


def build_answer(score: int, category: str) -> str:
    return json.dumps({"score": int(score), "category": category}) + "<|eot_id|>"


def clip_text(text: str, limit: int = MAX_TEXT_CHARS) -> str:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    return cut[: cut.rfind(" ")] if " " in cut[-60:] else cut


def parse_answer(raw: str):
    """Return (score, category) from model output, or (None, None) if unparseable."""
    m = re.search(r'"score"\s*:\s*(\d+)', raw)
    c = re.search(r'"category"\s*:\s*"([a-z_]+)"', raw)
    score = min(10, int(m.group(1))) if m else None
    cat = c.group(1) if c and c.group(1) in CATEGORIES else None
    return score, cat
