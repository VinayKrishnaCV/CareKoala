"""Download the large runtime files that are not stored in git (GitHub rejects files > 100 MB).

    python engine/download_assets.py                 # everything the engine needs (~900 MB)
    python engine/download_assets.py --only model    # just the 4-bit base model (771 MB)
    python engine/download_assets.py --only ocr      # just the EasyOCR weights (95 MB)
    python engine/download_assets.py --only llama    # just llama.cpp for this OS (~20 MB)

Only the Python standard library is used, so it runs before anything else is installed.
Downloads resume after an interruption, and checksums are verified. The trained CareKoala
adapters (models/carekoala-lora-v2.gguf = default, models/carekoala-lora.gguf = v1; 14 MB each)
ARE in git and are not downloaded here.
"""
import argparse
import hashlib
import platform
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent
LLAMA_BUILD = "b11036"  # the llama.cpp release the adapter was converted and verified with

MODEL = {
    "dest": ROOT / "models" / "base" / "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    "urls": ["https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"],
    "sha256": "6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83",
}
# EasyOCR's own release files, with Hugging Face mirrors as fallback (GitHub releases can 504).
# md5 values are the ones EasyOCR itself checks (easyocr/config.py).
OCR = [
    {"dest": ENGINE / "models" / "easyocr" / "craft_mlt_25k.pth", "md5": "2f8227d2def4037cdb3b34389dcf9ec1",
     "urls": ["https://github.com/JaidedAI/EasyOCR/releases/download/pre-v1.1.6/craft_mlt_25k.zip",
              "https://huggingface.co/Manbehindthemadness/craft_mlt_25k/resolve/main/craft_mlt_25k.pth"]},
    {"dest": ENGINE / "models" / "easyocr" / "english_g2.pth", "md5": "5864788e1821be9e454ec108d61b887d",
     "urls": ["https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english_g2.zip",
              "https://huggingface.co/felflare/EasyOCR-weights/resolve/main/english_g2.zip"]},
]
LLAMA_ASSETS = {  # (system, machine) -> release asset (CPU builds)
    ("Linux", "x86_64"): "ubuntu-x64.tar.gz",
    ("Linux", "aarch64"): "ubuntu-arm64.tar.gz",
    ("Darwin", "arm64"): "macos-arm64.tar.gz",
    ("Darwin", "x86_64"): "macos-x64.tar.gz",
    ("Windows", "AMD64"): "win-cpu-x64.zip",
    ("Windows", "ARM64"): "win-cpu-arm64.zip",
}


def fetch(url, dest: Path, retries=8):
    """Stream url -> dest, resuming a partial `.part` file; returns dest."""
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, retries + 1):
        have = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(url, headers={"User-Agent": "carekoala-setup", **({"Range": f"bytes={have}-"} if have else {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if have and r.status != 206:  # server ignored the range: start over
                    have = 0
                total = have + int(r.headers.get("Content-Length", 0))
                with open(part, "ab" if have else "wb") as f:
                    got, t0, last = have, time.time(), 0.0
                    while chunk := r.read(1 << 20):
                        f.write(chunk)
                        got += len(chunk)
                        if time.time() - last > 2:
                            last = time.time()
                            rate = (got - have) / max(last - t0, 1e-6) / 1e6
                            print(f"\r  {dest.name}: {got / 1e6:,.0f}/{total / 1e6:,.0f} MB  {rate:.1f} MB/s", end="", flush=True)
            print()
            part.replace(dest)
            return dest
        except OSError as e:
            print(f"\n  attempt {attempt} failed: {e}")
            time.sleep(min(30, 3 * attempt))
    raise RuntimeError(f"could not download {url}")


def digest(path, algo):
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        while chunk := f.read(1 << 22):
            h.update(chunk)
    return h.hexdigest()


def get_model():
    d = MODEL["dest"]
    if d.exists() and digest(d, "sha256") == MODEL["sha256"]:
        print(f"ok  {d.relative_to(ROOT)} (already present)")
        return
    fetch(MODEL["urls"][0], d)
    if digest(d, "sha256") != MODEL["sha256"]:
        d.unlink()
        sys.exit(f"checksum mismatch for {d.name} - deleted, please re-run")
    print(f"ok  {d.relative_to(ROOT)}")


def get_ocr():
    for a in OCR:
        d = a["dest"]
        if d.exists() and digest(d, "md5") == a["md5"]:
            print(f"ok  {d.relative_to(ROOT)} (already present)")
            continue
        for url in a["urls"]:
            try:
                tmp = fetch(url, d.with_suffix(".zip") if url.endswith(".zip") else d)
                if url.endswith(".zip"):
                    with zipfile.ZipFile(tmp) as z:
                        z.extract(d.name, d.parent)
                    tmp.unlink()
                if digest(d, "md5") == a["md5"]:
                    print(f"ok  {d.relative_to(ROOT)}")
                    break
                print(f"  checksum mismatch from {url}, trying next source")
                d.unlink()
            except (RuntimeError, OSError, KeyError, zipfile.BadZipFile) as e:
                print(f"  {url} failed ({e}), trying next source")
        else:
            sys.exit(f"could not get {d.name}")


def get_llama():
    key = (platform.system(), platform.machine())
    asset = LLAMA_ASSETS.get(key)
    if not asset:
        sys.exit(f"no prebuilt llama.cpp CPU build for {key}; build llama-server yourself and put it in engine/bin/")
    target = ENGINE / "bin" / asset.rsplit(".", 2 if asset.endswith(".tar.gz") else 1)[0]
    exe = "llama-server.exe" if key[0] == "Windows" else "llama-server"
    found = list((ENGINE / "bin").glob(f"**/{exe}"))  # same lookup as scorer.find_llama_server()
    if found:
        print(f"ok  llama-server already in {found[0].parent.relative_to(ROOT)}")
        return
    name = f"llama-{LLAMA_BUILD}-bin-{asset}"
    archive = fetch(f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_BUILD}/{name}", ENGINE / "bin" / name)
    target.mkdir(parents=True, exist_ok=True)
    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            z.extractall(target)
    else:
        with tarfile.open(archive) as t:
            t.extractall(target, filter="data")
    archive.unlink()
    for f in target.glob("**/llama-server"):
        f.chmod(0o755)
    print(f"ok  llama.cpp {LLAMA_BUILD} -> {target.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["model", "ocr", "llama"])
    args = ap.parse_args()
    steps = {"model": get_model, "ocr": get_ocr, "llama": get_llama}
    for name, step in steps.items():
        if args.only in (None, name):
            print(f"== {name}")
            step()


if __name__ == "__main__":
    main()
