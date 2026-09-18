#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from boundary_ml.evaluation import evaluate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Legacy boundary evaluation only; use NewModel/CareKoala/training/evaluate.py for the danger scorer")
    parser.add_argument("--adapter")
    parser.add_argument("--inputs", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--load-in-4bit", action="store_true")
    args = parser.parse_args()
    report = evaluate(args.model, args.adapter, args.inputs, args.load_in_4bit)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report["metrics"], indent=2))


if __name__ == "__main__":
    main()

