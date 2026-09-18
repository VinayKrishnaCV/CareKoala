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
sys.path.insert(0,str(ROOT))
from boundary_ml.trained_model import assets


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
    dependencies = subprocess.run(
        [sys.executable, "-m", "pip", "check"],
        capture_output=True, text=True, timeout=60,
    )
    report = {
        "dependencies": {"ok": dependencies.returncode == 0,
                         "details": (dependencies.stdout or dependencies.stderr).strip()},
        "python": {"version": platform.python_version(), "supported": python_ok},
        "packages": {
            "torch": package("torch"),
            "fastapi": package("fastapi"),
            "uvicorn": package("uvicorn"),
            "easyocr": package("easyocr"),
            "cv2": package("cv2"),
            "PIL": package("PIL"),
        },
        "node": command_version([node, "--version"]) if node else None,
        "npm": command_version([npm, "--version"]) if npm else None,
        "electron_installed": electron_binary.exists(),
        "trained_model": {name:{"path":value,"present":Path(value).is_file()} for name,value in assets().items()},
    }
    print(json.dumps(report, indent=2))
    missing = [name for name, value in report["packages"].items() if not value["present"]]
    missing_assets=[name for name,value in report['trained_model'].items() if not value['present']]
    if not python_ok or missing or missing_assets or not report["electron_installed"] or not report["dependencies"]["ok"]:
        print("\nSetup is incomplete.")
        if not report["dependencies"]["ok"]:
            print("- Repair dependencies: python -m pip install -r requirements-ocr.txt")
        if not python_ok:
            print("- Create .venv with Python 3.10-3.12.")
        if missing:
            print(f"- Missing Python packages: {', '.join(missing)}")
        if missing_assets:
            print(f"- Missing trained model assets: {', '.join(missing_assets)}. See MODEL-INTEGRATION.md.")
        if not report["electron_installed"]:
            print("- Run: cd electron-app && npm install")
        raise SystemExit(1)
    print("\nCareKoala desktop prerequisites are ready.")


if __name__ == "__main__":
    main()

