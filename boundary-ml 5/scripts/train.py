#!/usr/bin/env python3
import argparse

from boundary_ml.training import train


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Legacy boundary training only; use NewModel/CareKoala/training for the deployed danger scorer")
    parser.add_argument("--train-file", required=True)
    parser.add_argument("--val-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--eval-steps", type=int, default=25)
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=20260918)
    parser.add_argument("--load-in-4bit", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true")
    train(parser.parse_args())


if __name__ == "__main__":
    main()

