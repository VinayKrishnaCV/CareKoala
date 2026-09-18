"""Screen capture + EasyOCR, entirely local.

EasyOCR's weights (engine/models/easyocr/*.pth) are loaded from disk with downloads
disabled, so the app works offline and screenshots are never written anywhere.
"""
import os
import shutil
import subprocess
import warnings
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent / "models" / "easyocr"
# EasyOCR's CPU path triggers torch deprecation / pin_memory warnings on every call
warnings.filterwarnings("ignore", category=UserWarning, module=r"torch\..*")


class ScreenCapture:
    """mss on Windows / macOS / X11; `grim` fallback on Wayland desktops."""

    def __init__(self):
        self.wayland = bool(os.environ.get("WAYLAND_DISPLAY")) and shutil.which("grim")
        if not self.wayland:
            import mss
            self.sct = mss.mss()

    def grab_all(self):
        """One RGB array per physical monitor."""
        if self.wayland:
            from PIL import Image
            import io
            png = subprocess.run(["grim", "-t", "png", "-l", "0", "-"], capture_output=True, check=True).stdout
            return [np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))]
        return [np.asarray(self.sct.grab(m))[:, :, 2::-1] for m in self.sct.monitors[1:]]  # BGRA -> RGB


def thumbnail(img, w=96):
    """Tiny grayscale thumbnail used to skip OCR when the screen has not changed."""
    step = max(1, img.shape[1] // w)
    return img[::step, ::step].mean(axis=2).astype(np.float32)


def changed(a, b, threshold=2.0):
    return a is None or b is None or a.shape != b.shape or float(np.abs(a - b).mean()) > threshold


class OCR:
    def __init__(self, langs=("en",), threads=4, min_conf=0.25, canvas_size=1280):
        import easyocr
        import torch
        torch.set_num_threads(threads)
        self.reader = easyocr.Reader(list(langs), gpu=False, model_storage_directory=str(MODEL_DIR),
                                     download_enabled=False, verbose=False)
        self.min_conf = min_conf
        # EasyOCR's default detector canvas (2560) costs ~2.3 GB RAM and ~12 s on a 1920x1200
        # screen; 1280 needs ~1.3 GB and ~7 s and still reads ~95 % of the words.
        self.canvas_size = canvas_size

    def read(self, img) -> str:
        """Return the text on screen as lines in reading order."""
        boxes = []
        for bbox, text, conf in self.reader.readtext(img, detail=1, paragraph=False, canvas_size=self.canvas_size):
            if conf < self.min_conf or not text.strip():
                continue
            ys = [p[1] for p in bbox]; xs = [p[0] for p in bbox]
            boxes.append(((min(ys) + max(ys)) / 2, max(ys) - min(ys), min(xs), text.strip()))
        boxes.sort()
        lines, cur, cur_y, cur_h = [], [], None, None
        for yc, h, x, text in boxes:
            if cur and abs(yc - cur_y) > 0.6 * max(h, cur_h):
                lines.append(cur); cur = []
            if not cur:
                cur_y, cur_h = yc, h
            cur.append((x, text))
        if cur:
            lines.append(cur)
        return "\n".join(" ".join(t for _, t in sorted(line)) for line in lines)
