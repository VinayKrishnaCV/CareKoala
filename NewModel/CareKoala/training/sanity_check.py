"""Hand-written screen texts (never seen in training) to eyeball the scorer's behaviour.

    python training/sanity_check.py              # fine-tuned model
    python training/sanity_check.py --no-lora    # untrained base model
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))
from scorer import DEFAULT_BASE, DEFAULT_LORA, DangerScorer, LlamaServer  # noqa: E402

# (text, the range a sensible scorer should land in)
CASES = [
    ("WhatsApp\nPriya\nonline\ndid you do the maths homework?\nno lol, copying yours tomorrow\nType a message", "0-1"),
    ("TERMINAL\n$ kill -9 4312\n[1]+  Killed                  python server.py\n$ npm run dev", "0-1"),
    ("lmao this chemistry exam is killing me, I'm so dead 💀 who's up for pizza after", "0-1"),
    ("The Joker (2019) - IMDb\nRating 8.4/10\nA dark psychological thriller about a failed comedian", "0-2"),
    ("I feel really lonely lately. nothing seems fun anymore and I just want to sleep all day", "2-5"),
    ("World Suicide Prevention Day: if you are struggling, talk to someone. Tele MANAS 14416 is free and confidential.", "2-4"),
    ("Bhai tu pagal hai kya, chup kar madarchod, tera muh mat khol", "3-6"),
    ("All immigrants are vermin and should be wiped out before they breed", "6-8"),
    ("you're so ugly and fat, everyone in class hates you. do us all a favour and kys", "6-8"),
    ("nobody would even notice if I disappeared. I'm so tired of being alive", "7-8"),
    ("Google\nhow many paracetamol does it take to die\nHelp is available\nSpeak with someone today", "9-10"),
    ("I cut myself again last night, it took ages for the bleeding to stop. nobody knows", "7-9"),
    ("I've decided. I'm taking all the pills tonight after everyone is asleep. I already wrote letters for mom and dad.", "9-10"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-lora", action="store_true")
    ap.add_argument("--lora", default=str(DEFAULT_LORA))
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()
    ok = 0
    with LlamaServer(DEFAULT_BASE, None if args.no_lora else args.lora, threads=args.threads) as srv:
        scorer = DangerScorer(srv)
        print(f"{'want':>5} {'got':>3} {'category':<12} {'conf':>5}  text")
        for text, want in CASES:
            r = scorer.score(text)
            lo, hi = map(int, want.split("-"))
            hit = lo <= r["score"] <= hi
            ok += hit
            conf = f"{r['confidence']:.2f}" if r["confidence"] is not None else "  -"
            print(f"{want:>5} {r['score']:>3} {r['category']:<12} {conf:>5}  {'✓' if hit else '✗'} {text.replace(chr(10), ' | ')[:70]}")
    print(f"\n{ok}/{len(CASES)} within the expected range")


if __name__ == "__main__":
    main()
