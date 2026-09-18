"""Score text directly (no OCR) - for quick manual checks.

    python engine/score_text.py "I can't take this anymore, I want to end it tonight"
    python engine/score_text.py --file notes.txt
    python engine/score_text.py --no-lora "..."      # compare with the untrained base model
"""
import argparse
import json
import sys

from scorer import DEFAULT_BASE, DEFAULT_LORA, DangerScorer, LlamaServer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("text", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--no-lora", action="store_true")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    texts = [open(args.file).read()] if args.file else args.text or [l for l in sys.stdin.read().split("\n\n") if l.strip()]
    with LlamaServer(DEFAULT_BASE, None if args.no_lora else DEFAULT_LORA, threads=args.threads) as srv:
        scorer = DangerScorer(srv)
        for t in texts:
            r = scorer.score(t)
            print(json.dumps({"text": t[:80], **{k: r[k] for k in ("score", "category", "confidence", "expected")}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
