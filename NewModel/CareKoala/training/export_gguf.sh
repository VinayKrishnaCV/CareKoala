#!/usr/bin/env bash
# Convert the trained PEFT LoRA adapter into a llama.cpp GGUF adapter.
# The app loads:  models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf  +  models/carekoala-lora.gguf
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-.venv/bin/python}
ADAPTER=${1:-models/carekoala-lora}          # e.g. training/export_gguf.sh models/carekoala-lora-v2
"$PY" training/third_party/llama.cpp/convert_lora_to_gguf.py "$ADAPTER" \
  --base models/base --outtype f16 --outfile "$ADAPTER.gguf"
ls -la "$ADAPTER.gguf"
