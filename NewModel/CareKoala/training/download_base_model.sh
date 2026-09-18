#!/usr/bin/env bash
# Downloads the 4-bit Llama-3.2-1B-Instruct base (GGUF Q4_K_M) plus the tokenizer/config
# files. Resumable: re-run after a network drop and it picks up where it stopped.
set -euo pipefail
cd "$(dirname "$0")/../models/base"
HF=https://huggingface.co
get() { curl -fL --retry 20 --retry-delay 5 --retry-all-errors -C - -o "$2" "$1"; }
for f in config.json generation_config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  [ -s "$f" ] || get "$HF/unsloth/Llama-3.2-1B-Instruct/resolve/main/$f" "$f"
done
get "$HF/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf" Llama-3.2-1B-Instruct-Q4_K_M.gguf
echo "BASE MODEL DOWNLOAD COMPLETE"
