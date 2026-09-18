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

export CAREKOALA_PYTHON="$python_bin"
export CAREKOALA_MOCK=0
cd electron-app
exec npm start

