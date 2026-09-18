#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def package(name: str) -> dict:
    present = importlib.util.find_spec(name) is not None
    version = None
    if present:
        try:
            version = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    return {"present": present, "version": version}


def command_version(command: list[str]) -> str | None:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        return (result.stdout or result.stderr).strip().splitlines()[0]
    except (FileNotFoundError, subprocess.TimeoutExpired, IndexError):
        return None


def main() -> None:
    python_ok = (3, 10) <= sys.version_info[:2] <= (3, 12)
    node = shutil.which("node")
    npm = shutil.which("npm")
    electron_binary = ROOT / "electron-app" / "node_modules" / ".bin" / "electron"
    report = {
        "python": {"version": platform.python_version(), "supported": python_ok},
        "packages": {
            "torch": package("torch"),
            "transformers": package("transformers"),
            "fastapi": package("fastapi"),
            "uvicorn": package("uvicorn"),
            "easyocr": package("easyocr"),
            "cv2": package("cv2"),
            "PIL": package("PIL"),
        },
        "node": command_version([node, "--version"]) if node else None,
        "npm": command_version([npm, "--version"]) if npm else None,
        "electron_installed": electron_binary.exists(),
        "model_cached": any((Path.home() / ".cache" / "huggingface" / "hub").glob("models--Qwen--Qwen3-0.6B*")),
    }
    print(json.dumps(report, indent=2))
    missing = [name for name, value in report["packages"].items() if not value["present"]]
    if not python_ok or missing or not report["electron_installed"]:
        print("\nSetup is incomplete.")
        if not python_ok:
            print("- Create .venv with Python 3.10-3.12.")
        if missing:
            print(f"- Missing Python packages: {', '.join(missing)}")
        if not report["electron_installed"]:
            print("- Run: cd electron-app && npm install")
        raise SystemExit(1)
    print("\nBoundary desktop prerequisites are ready.")


if __name__ == "__main__":
    main()

