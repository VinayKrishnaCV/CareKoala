#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
python_bin="$project_root/.venv/bin/python"

if [[ ! -x "$python_bin" ]]; then
  echo "Missing .venv. Create it with Python 3.12 first." >&2
  exit 1
fi

cd "$project_root"
"$python_bin" scripts/doctor.py

export BOUNDARY_PYTHON="$python_bin"
export BOUNDARY_MODEL="${BOUNDARY_MODEL:-Qwen/Qwen3-0.6B}"
cd electron-app
exec npm start

