"""Evaluate the scorer on the held-out test set through the REAL runtime (llama-server,
4-bit base + LoRA GGUF) - i.e. exactly what the app will run.

    python training/evaluate.py                    # fine-tuned model
    python training/evaluate.py --no-lora          # untrained base model, for comparison
"""
import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))
from scorer import DEFAULT_BASE, DEFAULT_LORA, DangerScorer, LlamaServer  # noqa: E402

BUCKETS = [("0-3 low", 0, 3), ("4-6 watch", 4, 6), ("7-8 alert", 7, 8), ("9-10 emergency", 9, 10)]


def bucket(s):
    return next(name for name, lo, hi in BUCKETS if lo <= s <= hi)


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return round(p, 3), round(r, 3), round(2 * p * r / (p + r), 3) if p + r else 0.0


def metrics(rows, alert=7):
    n = len(rows)
    g = [r["score"] for r in rows]; p = [r["pred_score"] for r in rows]
    tp = sum(a >= alert and b >= alert for a, b in zip(g, p))
    fp = sum(a < alert and b >= alert for a, b in zip(g, p))
    fn = sum(a >= alert and b < alert for a, b in zip(g, p))
    prec, rec, f1 = prf(tp, fp, fn)
    low = [b for a, b in zip(g, p) if a <= 3]
    crisis = [b for a, b in zip(g, p) if a >= 8]
    by_src = defaultdict(list)
    for r in rows:
        by_src[r["source"].split("+")[0]].append(abs(r["score"] - r["pred_score"]))
    return {
        "n": n,
        "score_exact": round(sum(a == b for a, b in zip(g, p)) / n, 3),
        "score_within_1": round(sum(abs(a - b) <= 1 for a, b in zip(g, p)) / n, 3),
        "score_mae": round(sum(abs(a - b) for a, b in zip(g, p)) / n, 3),
        "bucket_accuracy": round(sum(bucket(a) == bucket(b) for a, b in zip(g, p)) / n, 3),
        "category_accuracy": round(sum(r["category"] == r["pred_category"] for r in rows) / n, 3),
        f"alert(>={alert})_precision": prec, f"alert(>={alert})_recall": rec, f"alert(>={alert})_f1": f1,
        "false_alarm_rate_on_low(0-3)": round(sum(b >= alert for b in low) / len(low), 3) if low else None,
        "missed_crisis_rate(gold>=8, pred<7)": round(sum(b < alert for b in crisis) / len(crisis), 3) if crisis else None,
        "mae_by_source": {k: round(sum(v) / len(v), 2) for k, v in sorted(by_src.items())},
        "bucket_confusion(gold->pred)": {gb: dict(Counter(bucket(r["pred_score"]) for r in rows if bucket(r["score"]) == gb)) for gb, _, _ in BUCKETS},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    ap.add_argument("--no-lora", action="store_true")
    ap.add_argument("--lora", default=str(DEFAULT_LORA))
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--name", help="report name (default: base_zero_shot / carekoala_finetuned)")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(ROOT / "data" / "processed" / f"{args.split}.jsonl")]
    rows = rows[: args.limit] if args.limit else rows
    name = args.name or ("base_zero_shot" if args.no_lora else "carekoala_finetuned")
    out_dir = ROOT / "models" / "eval"; out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    with LlamaServer(DEFAULT_BASE, None if args.no_lora else args.lora, threads=args.threads, log_path=out_dir / f"{name}_server.log") as srv:
        scorer = DangerScorer(srv)
        for i, r in enumerate(rows):
            res = scorer.score_window(r["text"])  # test texts are single model-sized windows
            r["pred_score"], r["pred_category"], r["pred_expected"] = res["score"], res["category"], res["expected"]
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(rows)}  {(time.time() - t0) / (i + 1):.2f}s/example", flush=True)
    m = metrics(rows)
    m["seconds_per_example"] = round((time.time() - t0) / len(rows), 3)
    json.dump(m, open(out_dir / f"{name}.json", "w"), indent=2)
    with open(out_dir / f"{name}_predictions.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"model": name, **m}, indent=2))


if __name__ == "__main__":
    main()
