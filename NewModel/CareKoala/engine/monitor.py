"""CareKoala screen monitor - the process the Electron app spawns.

    python engine/monitor.py [--interval 20] [--alert 7] [--emergency 9] [--no-excerpt]
    python engine/monitor.py --image screenshot.png      # score one image and exit

stdout: one JSON object per line (events). stderr: diagnostics.
    {"event": "ready", ...}
    {"event": "scan", "score": 8, "category": "self_harm", "level": "alert", "confidence": 0.91, ...}
    {"event": "status", "state": "paused"}
    {"event": "error", "message": "..."}
stdin: one command per line, plain word or JSON:
    pause | resume | scan | quit | {"cmd": "score_text", "text": "..."}

Levels (policy is the Electron app's job; these are defaults):
    none 0-3 | watch 4-6 | alert 7-8 (notify guardian) | emergency 9-10 (run the crisis protocol)
"""
import argparse
import json
import sys
import threading
import time
from datetime import datetime, timezone

from ocr import OCR, ScreenCapture, changed, thumbnail
from scorer import DEFAULT_BASE, DEFAULT_LORA, DangerScorer, LlamaServer

_out_lock = threading.Lock()


def emit(event, **data):
    with _out_lock:
        sys.stdout.write(json.dumps({"event": event, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), **data}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def level_for(score, alert, emergency):
    if score >= emergency:
        return "emergency"
    if score >= alert:
        return "alert"
    return "watch" if score >= 4 else "none"


class Monitor:
    def __init__(self, args):
        self.args = args
        self.paused = False
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.last_thumbs = {}
        self.server = LlamaServer(args.base, args.lora, threads=args.llm_threads, server_bin=args.llama_server)
        self.scorer = DangerScorer(self.server)
        self.ocr = OCR(tuple(args.langs.split(",")), threads=args.ocr_threads, canvas_size=args.ocr_canvas)
        self.capture = None  # created lazily: --image mode needs no display

    def result_event(self, res, **extra):
        level = level_for(res["score"], self.args.alert, self.args.emergency)
        data = {k: res[k] for k in ("score", "category", "confidence", "expected", "windows") if k in res}
        if level in ("alert", "emergency") and not self.args.no_excerpt:
            data["excerpt"] = res.get("excerpt", "")[:280]  # context for the guardian, nothing more
        return {"level": level, **data, **extra}

    def scan_image(self, img, source):
        t0 = time.time()
        text = self.ocr.read(img)
        t1 = time.time()
        res = self.scorer.score(text)
        t2 = time.time()
        emit("scan", **self.result_event(res, source=source, chars=len(text),
                                         ocr_ms=int((t1 - t0) * 1000), score_ms=int((t2 - t1) * 1000)))

    def scan_screens(self, force=False):
        if self.capture is None:
            self.capture = ScreenCapture()
        for i, img in enumerate(self.capture.grab_all()):
            th = thumbnail(img)
            if not force and not changed(self.last_thumbs.get(i), th):
                continue  # nothing new on this monitor - save CPU and battery
            self.last_thumbs[i] = th
            self.scan_image(img, source=f"monitor{i + 1}")

    def read_commands(self):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line) if line.startswith("{") else {"cmd": line}
                name = cmd.get("cmd")
                if name == "pause":
                    self.paused = True; emit("status", state="paused")
                elif name == "resume":
                    self.paused = False; emit("status", state="running"); self.wake.set()
                elif name == "scan":
                    self.wake.set()
                elif name == "quit":
                    break
                elif name == "score_text":
                    emit("score_text", **self.result_event(self.scorer.score(cmd.get("text", "")), id=cmd.get("id")))
                else:
                    emit("error", message=f"unknown command: {name}")
            except Exception as e:  # noqa: BLE001 - a bad command must not kill the monitor
                emit("error", message=str(e))
        self.stop.set(); self.wake.set()

    def run(self):
        emit("ready", interval=self.args.interval, alert=self.args.alert, emergency=self.args.emergency,
             model=str(self.args.lora), ocr_langs=self.args.langs.split(","))
        threading.Thread(target=self.read_commands, daemon=True).start()
        force = True
        while not self.stop.is_set():
            if not self.paused:
                try:
                    self.scan_screens(force=force)
                except Exception as e:  # noqa: BLE001
                    emit("error", message=f"scan failed: {e}")
            force = self.wake.wait(self.args.interval)  # a "scan" command forces a rescan
            self.wake.clear()

    def close(self):
        self.server.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interval", type=float, default=20, help="seconds between screen scans")
    ap.add_argument("--alert", type=int, default=7, help="score at which the guardian is alerted")
    ap.add_argument("--emergency", type=int, default=9, help="score that triggers the crisis protocol")
    ap.add_argument("--no-excerpt", action="store_true", help="never include on-screen text in events")
    ap.add_argument("--langs", default="en", help="EasyOCR languages, e.g. en or en,hi")
    ap.add_argument("--llm-threads", type=int, default=4)
    ap.add_argument("--ocr-threads", type=int, default=4)
    ap.add_argument("--ocr-canvas", type=int, default=1280, help="EasyOCR detector size: lower = less RAM/CPU, may miss tiny text")
    ap.add_argument("--base", default=str(DEFAULT_BASE))
    ap.add_argument("--lora", default=str(DEFAULT_LORA))
    ap.add_argument("--llama-server", default=None, help="path to llama-server (default: engine/bin/*)")
    ap.add_argument("--image", help="score this image file once and exit")
    args = ap.parse_args()

    mon = Monitor(args)
    try:
        if args.image:
            from PIL import Image
            import numpy as np
            mon.scan_image(np.asarray(Image.open(args.image).convert("RGB")), source=args.image)
        else:
            mon.run()
    except KeyboardInterrupt:
        pass
    finally:
        mon.close()


if __name__ == "__main__":
    main()
