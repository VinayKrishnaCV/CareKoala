"""Build the continued-training set for adapter v2: every v2 addition + a replay sample of v1 data.

v2 additions (see build_dataset.py): self-injury posts (`nssi`), harmless "cut/blade/scar" posts
(`nssi_neg`) and people being told to kill themselves (`kys_*`). Replaying earlier data stops the
model forgetting what it already learned.

    python training/make_update_set.py          # -> data/processed/train_update.jsonl
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPLAY = 1200
NEW_PREFIXES = ("nssi", "kys_")

rows = [json.loads(l) for l in open(ROOT / "data" / "processed" / "train.jsonl")]
new = [r for r in rows if r["source"].startswith(NEW_PREFIXES)]
old = [r for r in rows if not r["source"].startswith(NEW_PREFIXES)]
rng = random.Random(7)
mix = new + rng.sample(old, min(REPLAY, len(old)))
rng.shuffle(mix)
with open(ROOT / "data" / "processed" / "train_update.jsonl", "w") as f:
    for r in mix:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"train_update.jsonl: {len(new)} new + {len(mix) - len(new)} replay = {len(mix)}")
