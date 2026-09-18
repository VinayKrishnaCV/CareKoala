#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def percent(value):
    return f"{100 * value:.1f}%" if value is not None else "n/a"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline")
    parser.add_argument("finetuned")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    baseline = json.loads(Path(args.baseline).read_text())
    tuned = json.loads(Path(args.finetuned).read_text())
    b, t = baseline["metrics"], tuned["metrics"]
    lines = [
        "# Boundary model comparison",
        "",
        "Both models used the same input files and deterministic generation settings.",
        "",
        "| Metric | Baseline | Fine-tuned |",
        "|---|---:|---:|",
        f"| Valid JSON | {percent(b['valid_json_rate'])} | {percent(t['valid_json_rate'])} |",
        f"| Benign false-positive rate | {percent(b['false_positive_rate_benign'])} | {percent(t['false_positive_rate_benign'])} |",
        f"| Ambiguous status accuracy | {percent(b['ambiguous_accuracy'])} | {percent(t['ambiguous_accuracy'])} |",
        f"| Evidence ID validity | {percent(b['evidence_id_valid_rate'])} | {percent(t['evidence_id_valid_rate'])} |",
        "",
        "## Concern types",
        "",
        "| Concern | Baseline precision | Baseline recall | Fine-tuned precision | Fine-tuned recall |",
        "|---|---:|---:|---:|---:|",
    ]
    for kind in b["per_concern"]:
        bm, tm = b["per_concern"][kind], t["per_concern"][kind]
        lines.append(
            f"| {kind} | {percent(bm['precision'])} | {percent(bm['recall'])} | "
            f"{percent(tm['precision'])} | {percent(tm['recall'])} |"
        )
    lines += [
        "",
        "These results describe only the supplied synthetic held-out sets. They are not a real-world safety claim.",
    ]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()

