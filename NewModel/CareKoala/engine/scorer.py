"""Danger scoring with the fine-tuned Llama-3.2-1B (4-bit) via a local llama.cpp server.

The model is the 4-bit base GGUF plus the CareKoala LoRA adapter GGUF. llama-server keeps
it loaded (~1 GB RAM) and reuses the KV cache of the shared system prompt between calls.
Everything runs on 127.0.0.1 - screen text never leaves the machine.
"""
import json
import math
import os
import platform
import socket
import subprocess
import time
import urllib.request
from collections import OrderedDict
from pathlib import Path

from prompt import ANSWER_PREFIX, MAX_TEXT_CHARS, build_prompt, parse_answer

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent
DEFAULT_BASE = ROOT / "models" / "base" / "Llama-3.2-1B-Instruct-Q4_K_M.gguf"
DEFAULT_LORA = ROOT / "models" / "carekoala-lora-v2.gguf"  # v1: models/carekoala-lora.gguf
BOS = "<|begin_of_text|>"  # llama-server adds BOS itself


def find_llama_server():
    """engine/bin/<os>-<arch>/llama-*/llama-server[.exe], or llama-server on PATH."""
    exe = "llama-server.exe" if os.name == "nt" else "llama-server"
    hits = sorted((ENGINE_DIR / "bin").glob(f"*/**/{exe}"))
    if hits:
        return hits[-1]
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if (Path(d) / exe).exists():
            return Path(d) / exe
    raise FileNotFoundError(f"{exe} not found - download a llama.cpp release into engine/bin/ (see README)")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LlamaServer:
    def __init__(self, base=DEFAULT_BASE, lora=DEFAULT_LORA, threads=4, ctx=2048, server_bin=None, log_path=None):
        server_bin = Path(server_bin) if server_bin else find_llama_server()
        self.port = free_port()
        # --cache-ram 0: llama-server otherwise keeps up to 8 GB of old prompts in RAM, which
        # would eat an 8 GB laptop. The slot's own KV cache still reuses the shared system prompt.
        cmd = [str(server_bin), "-m", str(base), "--host", "127.0.0.1", "--port", str(self.port),
               "-c", str(ctx), "-np", "1", "-t", str(threads), "--no-webui", "--cache-ram", "0"]
        if lora:
            cmd += ["--lora", str(lora)]
        env = dict(os.environ)
        if platform.system() == "Linux":  # release tarballs ship their .so files next to the binary
            env["LD_LIBRARY_PATH"] = f"{server_bin.parent}{os.pathsep}{env.get('LD_LIBRARY_PATH', '')}"
        log = open(log_path, "w") if log_path else subprocess.DEVNULL
        self.proc = subprocess.Popen(cmd, env=env, stdout=log, stderr=log)
        self._wait_ready()

    def _wait_ready(self, timeout=180):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server exited with code {self.proc.returncode}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2) as r:
                    if json.load(r).get("status") == "ok":
                        return
            except OSError:
                pass
            time.sleep(0.5)
        raise TimeoutError("llama-server did not become ready")

    def post(self, path, body, timeout=120):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def split_windows(text, limit=MAX_TEXT_CHARS):
    """Pack OCR lines into windows of at most `limit` characters (the size the model was trained on)."""
    windows, cur = [], ""
    for line in (l.strip() for l in text.splitlines()):
        if not line:
            continue
        while len(line) > limit:  # a single very long line: cut at a word boundary
            cut = line.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            if cur:
                windows.append(cur); cur = ""
            windows.append(line[:cut]); line = line[cut:].strip()
        if cur and len(cur) + 1 + len(line) > limit:
            windows.append(cur); cur = ""
        cur = f"{cur}\n{line}" if cur else line
    if cur:
        windows.append(cur)
    return windows


class DangerScorer:
    """score(text) -> {"score": 0-10, "category": ..., "confidence": p(score), "expected": E[score], ...}"""

    def __init__(self, server: LlamaServer, cache_size=512):
        self.server = server
        self.cache = OrderedDict()  # scrolling re-shows the same text; don't pay for it twice
        self.cache_size = cache_size

    def score_window(self, text):
        if text in self.cache:
            self.cache.move_to_end(text)
            return self.cache[text]
        prompt = build_prompt(text).removeprefix(BOS) + ANSWER_PREFIX
        r = self.server.post("/completion", {
            "prompt": prompt, "n_predict": 12, "temperature": 0, "n_probs": 11,
            "stop": ["}"], "cache_prompt": True,
        })
        score, category = parse_answer(ANSWER_PREFIX + r["content"] + "}")
        probs = {}
        cps = r.get("completion_probabilities") or []
        if cps:
            for t in cps[0].get("top_logprobs") or cps[0].get("probs") or []:
                tok = t["token"].strip()
                if tok.isdigit() and int(tok) <= 10:
                    probs[int(tok)] = math.exp(t["logprob"]) if "logprob" in t else t["prob"]
        total = sum(probs.values())
        if score is None:  # should not happen with the fine-tuned adapter; fail safe
            score = max(probs, key=probs.get) if probs else 0
        out = {
            "score": score,
            "category": category or ("safe" if score <= 1 else "distress"),
            "confidence": round(probs.get(score, 0.0) / total, 3) if total else None,
            "expected": round(sum(k * v for k, v in probs.items()) / total, 2) if total else float(score),
        }
        self.cache[text] = out
        if len(self.cache) > self.cache_size:
            self.cache.popitem(last=False)
        return out

    def score(self, text, max_windows=8):
        """Score a whole screen: every window is scored, the most dangerous one wins."""
        windows = split_windows(text)[:max_windows]
        if not windows:
            return {"score": 0, "category": "safe", "confidence": 1.0, "expected": 0.0, "excerpt": "", "windows": 0}
        results = [(self.score_window(w), w) for w in windows]
        best, excerpt = max(results, key=lambda rw: (rw[0]["score"], rw[0]["expected"]))
        return {**best, "excerpt": excerpt, "windows": len(windows)}
