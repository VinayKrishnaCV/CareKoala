#!/usr/bin/env python3
"""Parallel, resumable HTTP range downloader (for a per-connection-throttled link).

usage: pdl.py URL OUT [--conns N] [--chunk-mb M]
State is kept in OUT.pdl (set of finished chunk indices), so re-running resumes.
"""
import argparse, json, os, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "pdl/1.0"}


def size_of(url):
    req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range")
        if cr:
            return int(cr.split("/")[-1])
        return int(r.headers["Content-Length"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url"); ap.add_argument("out")
    ap.add_argument("--conns", type=int, default=8)
    ap.add_argument("--chunk-mb", type=float, default=4)
    a = ap.parse_args()

    total = size_of(a.url)
    chunk = int(a.chunk_mb * 1024 * 1024)
    n = (total + chunk - 1) // chunk
    state_path = a.out + ".pdl"
    done = set(json.load(open(state_path))) if os.path.exists(state_path) else set()
    if not os.path.exists(a.out) or os.path.getsize(a.out) != total:
        with open(a.out, "ab") as f:
            f.truncate(total)
    fd = os.open(a.out, os.O_WRONLY)
    lock = threading.Lock()
    got = [len(done) * chunk]
    t0 = time.time(); b0 = got[0]

    def fetch(i):
        start, end = i * chunk, min(total, (i + 1) * chunk) - 1
        for attempt in range(1000):
            try:
                req = urllib.request.Request(a.url, headers={**UA, "Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                if len(data) != end - start + 1:
                    raise IOError(f"short read {len(data)}")
                os.pwrite(fd, data, start)
                with lock:
                    done.add(i); got[0] += len(data)
                    json.dump(sorted(done), open(state_path, "w"))
                return
            except Exception as e:  # noqa: BLE001 - retry anything on a flaky link
                time.sleep(min(60, 3 * (attempt + 1)))

    todo = [i for i in range(n) if i not in done]
    stop = threading.Event()

    def progress():
        while not stop.wait(30):
            el = time.time() - t0
            rate = (got[0] - b0) / max(el, 1)
            left = (total - got[0]) / max(rate, 1)
            print(f"[pdl] {os.path.basename(a.out)} {got[0]/1e6:.0f}/{total/1e6:.0f} MB "
                  f"{rate/1024:.0f} KB/s eta {left/60:.0f} min", flush=True)

    threading.Thread(target=progress, daemon=True).start()
    with ThreadPoolExecutor(a.conns) as ex:
        list(ex.map(fetch, todo))
    stop.set(); os.close(fd)
    if len(done) == n:
        os.remove(state_path)
        print(f"[pdl] DONE {a.out} ({total} bytes)", flush=True)
    else:
        sys.exit(f"[pdl] incomplete: {len(done)}/{n} chunks")


if __name__ == "__main__":
    main()
