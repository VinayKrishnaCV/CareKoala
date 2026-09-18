#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path


def tesseract_fallback(image_path: Path) -> dict:
    executable = shutil.which("tesseract")
    if not executable:
        raise RuntimeError(
            "EasyOCR is not installed and the local Tesseract fallback is unavailable. "
            "Run: pip install -r requirements-ocr.txt"
        )
    result = subprocess.run(
        [executable, str(image_path), "stdout", "tsv", "--psm", "6"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Tesseract OCR failed.")
    grouped: dict[tuple[str, str, str], dict] = {}
    width = height = 1
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter="\t"):
        text = " ".join((row.get("text") or "").split())
        try:
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            item_width = int(row.get("width") or 0)
            item_height = int(row.get("height") or 0)
            confidence = float(row.get("conf") or -1)
        except ValueError:
            continue
        width = max(width, left + item_width)
        height = max(height, top + item_height)
        if not text or confidence < 0:
            continue
        key = (row.get("block_num", "0"), row.get("par_num", "0"), row.get("line_num", "0"))
        line = grouped.setdefault(key, {
            "parts": [], "confidence": [],
            "left": left, "top": top, "right": left + item_width, "bottom": top + item_height,
        })
        line["parts"].append(text)
        line["confidence"].append(confidence / 100)
        line["left"] = min(line["left"], left)
        line["top"] = min(line["top"], top)
        line["right"] = max(line["right"], left + item_width)
        line["bottom"] = max(line["bottom"], top + item_height)
    lines = [{
        "text": " ".join(value["parts"]),
        "confidence": round(sum(value["confidence"]) / len(value["confidence"]), 4),
        "box": {key: value[key] for key in ("left", "top", "right", "bottom")},
    } for value in grouped.values()]
    lines.sort(key=lambda item: (item["box"]["top"], item["box"]["left"]))
    return {"engine": "tesseract-local-fallback", "image": {"width": width, "height": height}, "lines": lines}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    image_path = Path(args.image)
    if not image_path.is_file():
        raise SystemExit("Image does not exist.")

    try:
        import easyocr
        from PIL import Image
    except ImportError:
        try:
            print(json.dumps(tesseract_fallback(image_path), ensure_ascii=False))
            return
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            raise SystemExit(2)

    with Image.open(image_path) as image:
        width, height = image.size

    # CPU mode avoids simultaneous GPU pressure with the local language model.
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    results = reader.readtext(
        str(image_path),
        detail=1,
        paragraph=False,
        decoder="greedy",
        batch_size=1,
        workers=0,
        canvas_size=1600,
        mag_ratio=1.0,
    )
    lines = []
    for box, text, confidence in results:
        cleaned = " ".join(str(text).split())
        if not cleaned:
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        lines.append({
            "text": cleaned,
            "confidence": round(float(confidence), 4),
            "box": {
                "left": min(xs),
                "top": min(ys),
                "right": max(xs),
                "bottom": max(ys),
            },
        })
    lines.sort(key=lambda item: (item["box"]["top"], item["box"]["left"]))
    print(json.dumps({
        "engine": "easyocr",
        "image": {"width": width, "height": height},
        "lines": lines,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
