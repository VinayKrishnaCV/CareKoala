"""LoRA fine-tune of Llama-3.2-1B-Instruct (4-bit Q4_K_M base) into the CareKoala danger scorer.

The base weights are the SAME 4-bit GGUF file that ships with the app (de-quantized for
training), so the adapter is trained against exactly the weights it will run on.
Built for CPU: LoRA only on the upper layers (backprop stops half-way down) and the
128k-vocab output layer is only evaluated on answer tokens.

    python training/train_lora.py                  # full run, resumes automatically
    python training/train_lora.py --max-steps 3    # smoke test
"""
import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine"))
from prompt import ANSWER_PREFIX, build_answer, build_prompt  # noqa: E402  (shared with the runtime engine)

ROOT = Path(__file__).resolve().parent.parent
BASE_DIR = ROOT / "models" / "base"
BASE_GGUF = "Llama-3.2-1B-Instruct-Q4_K_M.gguf"
TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def load_base(threads):
    torch.set_num_threads(threads)
    tok = AutoTokenizer.from_pretrained(BASE_DIR)
    model = AutoModelForCausalLM.from_pretrained(BASE_DIR, gguf_file=BASE_GGUF, dtype=torch.float32, attn_implementation="sdpa")
    return tok, model


MAX_PROMPT_TOKENS = 300  # emoji / Devanagari heavy text can be ~2 tokens per character


def encode(tok, rows):
    """Prompt and answer are tokenized separately, exactly as they are at inference time."""
    prefix_len = len(tok(ANSWER_PREFIX, add_special_tokens=False).input_ids)
    out = []
    for r in rows:
        text = r["text"]
        p = tok(build_prompt(text), add_special_tokens=False).input_ids
        while len(p) > MAX_PROMPT_TOKENS:
            text = text[: int(len(text) * 0.85)]
            p = tok(build_prompt(text), add_special_tokens=False).input_ids
        a = tok(build_answer(r["score"], r["category"]), add_special_tokens=False).input_ids
        out.append({"ids": p + a, "n_prompt": len(p), "score_pos": len(p) + prefix_len, **r})
    return out


def batches(examples, bs, rng, max_tokens):
    """Length-bucketed batches capped at `bs` examples AND `max_tokens` padded tokens.

    Sorting within shuffled chunks keeps padding small; the token cap bounds attention
    memory (CPU attention materialises T x T scores per head).
    """
    idx = list(range(len(examples)))
    rng.shuffle(idx)
    out = []
    for c in range(0, len(idx), bs * 32):
        cur = []
        for i in sorted(idx[c:c + bs * 32], key=lambda i: len(examples[i]["ids"])):
            if cur and (len(cur) == bs or (len(cur) + 1) * len(examples[i]["ids"]) > max_tokens):
                out.append(cur); cur = []
            cur.append(i)
        out.append(cur)
    rng.shuffle(out)
    return out


def collate(examples, pad_id):
    T = max(len(e["ids"]) for e in examples)
    ids = torch.full((len(examples), T), pad_id)
    mask = torch.zeros((len(examples), T), dtype=torch.long)
    rows, pos, tgt = [], [], []
    for b, e in enumerate(examples):
        n = len(e["ids"])
        ids[b, :n] = torch.tensor(e["ids"])
        mask[b, :n] = 1
        for j in range(e["n_prompt"], n):  # position j-1 predicts token j
            rows.append(b); pos.append(j - 1); tgt.append(e["ids"][j])
    return ids, mask, torch.tensor(rows), torch.tensor(pos), torch.tensor(tgt)


def answer_loss(model, ids, mask, rows, pos, tgt):
    inner = model.get_base_model()
    hidden = inner.model(input_ids=ids, attention_mask=mask).last_hidden_state
    logits = inner.lm_head(hidden[rows, pos])
    return F.cross_entropy(logits.float(), tgt)


@torch.no_grad()
def quick_eval(model, examples, pad_id, score_ids, bs=16):
    """Teacher-forced: loss on the answer + accuracy of the score token."""
    model.eval()
    inner = model.get_base_model()
    losses, exact, within1, n = [], 0, 0, 0
    for i in range(0, len(examples), bs):
        batch = examples[i:i + bs]
        ids, mask, rows, pos, tgt = collate(batch, pad_id)
        hidden = inner.model(input_ids=ids, attention_mask=mask).last_hidden_state
        losses.append(F.cross_entropy(inner.lm_head(hidden[rows, pos]).float(), tgt).item())
        sp = torch.tensor([e["score_pos"] - 1 for e in batch])
        pred = inner.lm_head(hidden[torch.arange(len(batch)), sp])[:, score_ids].argmax(-1)
        for p, e in zip(pred.tolist(), batch):
            exact += p == e["score"]; within1 += abs(p - e["score"]) <= 1; n += 1
    model.train()
    return sum(losses) / len(losses), exact / n, within1 / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "models" / "carekoala-lora"))
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--accum", type=int, default=2)
    ap.add_argument("--max-batch-tokens", type=int, default=1600)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=32)
    ap.add_argument("--first-layer", type=int, default=6, help="LoRA on layers first-layer..15")
    ap.add_argument("--threads", type=int, default=8, help="8 was fastest on the Core Ultra 7 255H")
    ap.add_argument("--save-every", type=int, default=25)
    ap.add_argument("--eval-every", type=int, default=100)
    ap.add_argument("--max-steps", type=int, default=0)
    ap.add_argument("--train-file", default="train", help="name in data/processed/ (without .jsonl)")
    ap.add_argument("--init-adapter", help="continue training from this PEFT adapter (e.g. models/carekoala-lora)")
    args = ap.parse_args()

    out = Path(args.out); ckpt = out / "checkpoint"
    out.mkdir(parents=True, exist_ok=True)
    log = open(out / "train_log.jsonl", "a")
    random.seed(0); torch.manual_seed(0)

    tok, model = load_base(args.threads)
    n_layers = model.config.num_hidden_layers
    if (ckpt / "adapter_config.json").exists():
        model = PeftModel.from_pretrained(model, ckpt, is_trainable=True)
        print(f"resuming from {ckpt}")
    elif args.init_adapter:
        model = PeftModel.from_pretrained(model, args.init_adapter, is_trainable=True)
        print(f"continuing from adapter {args.init_adapter}")
    else:
        model = get_peft_model(model, LoraConfig(
            r=args.rank, lora_alpha=args.alpha, lora_dropout=0.05, target_modules=TARGETS,
            layers_to_transform=list(range(args.first_layer, n_layers)), layers_pattern="layers", task_type="CAUSAL_LM"))
    model.print_trainable_parameters()
    model.train()

    read = lambda s: [json.loads(l) for l in open(ROOT / "data" / "processed" / f"{s}.jsonl")]  # noqa: E731
    train, val = encode(tok, read(args.train_file)), encode(tok, read("val"))
    val_small = random.Random(1).sample(val, min(160, len(val)))
    score_ids = [tok(str(s), add_special_tokens=False).input_ids[0] for s in range(11)]
    assert all(len(tok(str(s), add_special_tokens=False).input_ids) == 1 for s in range(11))
    pad_id = tok.convert_tokens_to_ids("<|finetune_right_pad_id|>")

    rng = random.Random(42)
    epoch_plans = [batches(train, args.batch, rng, args.max_batch_tokens) for _ in range(math.ceil(args.epochs))]
    plan = [b for ep in epoch_plans for b in ep][: int(len(epoch_plans[0]) * args.epochs)]
    total_steps = len(plan) // args.accum
    if args.max_steps:
        total_steps = min(total_steps, args.max_steps)
    warmup = max(1, int(0.05 * total_steps))

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warmup) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total_steps)))))
    step = 0
    if (ckpt / "state.pt").exists():
        st = torch.load(ckpt / "state.pt", weights_only=True)
        opt.load_state_dict(st["opt"]); sched.load_state_dict(st["sched"]); step = st["step"]
    print(f"{len(train)} train examples, {total_steps} optimizer steps (batch {args.batch} x accum {args.accum}), starting at {step}")

    t0, tok_count, run_loss, start_step = time.time(), 0, [], step
    for step in range(step, total_steps):
        for k in range(args.accum):
            ex = [train[i] for i in plan[step * args.accum + k]]
            ids, mask, rows, pos, tgt = collate(ex, pad_id)
            loss = answer_loss(model, ids, mask, rows, pos, tgt) / args.accum
            loss.backward()
            run_loss.append(loss.item() * args.accum); tok_count += int(mask.sum())
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)

        s = step + 1
        if s % 5 == 0 or s == total_steps:
            el = time.time() - t0
            rec = {"step": s, "loss": round(sum(run_loss) / len(run_loss), 4), "lr": sched.get_last_lr()[0],
                   "tok_per_s": round(tok_count / el, 1), "eta_min": round(el / (s - start_step) * (total_steps - s) / 60, 1)}
            print(json.dumps(rec), flush=True); log.write(json.dumps(rec) + "\n"); log.flush()
            run_loss = []
        if s % args.eval_every == 0 or s == total_steps:
            vl, acc, w1 = quick_eval(model, val_small, pad_id, score_ids)
            rec = {"step": s, "val_loss": round(vl, 4), "val_score_exact": round(acc, 3), "val_score_within1": round(w1, 3)}
            print(json.dumps(rec), flush=True); log.write(json.dumps(rec) + "\n"); log.flush()
        if s % args.save_every == 0 or s == total_steps:
            model.save_pretrained(ckpt)
            torch.save({"opt": opt.state_dict(), "sched": sched.state_dict(), "step": s}, ckpt / "state.pt")

    model.save_pretrained(out)
    tok.save_pretrained(out)
    json.dump(vars(args) | {"base": f"{BASE_DIR.name}/{BASE_GGUF}", "total_steps": total_steps}, open(out / "train_args.json", "w"), indent=2)
    print(f"saved LoRA adapter to {out}")


if __name__ == "__main__":
    main()
