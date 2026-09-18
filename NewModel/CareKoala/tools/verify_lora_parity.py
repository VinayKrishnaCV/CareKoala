"""Check that base.gguf + lora.gguf in llama.cpp == dequantized base + PEFT LoRA in PyTorch."""
import json, os, subprocess, sys, time, urllib.request
sys.path.insert(0, "/home/Riggle19/Projects/CareKoala/training")
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer
from prompt import build_prompt

SP = os.path.dirname(os.path.abspath(__file__))  # writes rand-lora files next to this script; needs training/third_party/llama.cpp
ROOT = "/home/Riggle19/Projects/CareKoala"
BIN = f"{ROOT}/engine/bin/linux-x64/llama-b11036"
torch.set_num_threads(4); torch.manual_seed(0)

tok = AutoTokenizer.from_pretrained(f"{ROOT}/models/base")
m = AutoModelForCausalLM.from_pretrained(f"{ROOT}/models/base", gguf_file="Llama-3.2-1B-Instruct-Q4_K_M.gguf", dtype=torch.float32)
m = get_peft_model(m, LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
                                 layers_to_transform=list(range(6, 16)), layers_pattern="layers", task_type="CAUSAL_LM"))
with torch.no_grad():
    for n, p in m.named_parameters():
        if "lora_B" in n:
            p.normal_(0, 0.02)  # strong, random adapter -> outputs change a lot
m.save_pretrained(f"{SP}/rand-lora")
subprocess.run([sys.executable, f"{ROOT}/training/third_party/llama.cpp/convert_lora_to_gguf.py", f"{SP}/rand-lora", "--base", f"{ROOT}/models/base",
                "--outfile", f"{SP}/rand-lora.gguf", "--outtype", "f32"], check=True, capture_output=True)

prompts = [build_prompt("I can't do this anymore, I just want it all to end.") + '{"score": ',
           build_prompt("Chapter 3 homework: solve the quadratic equations on page 42.") + '{"score": ']


def hf_top(prompt, adapter=True):
    ids = tok(prompt, add_special_tokens=False, return_tensors="pt").input_ids
    with torch.no_grad():
        if adapter:
            logits = m(input_ids=ids).logits[0, -1]
        else:
            with m.disable_adapter():
                logits = m(input_ids=ids).logits[0, -1]
    lp = torch.log_softmax(logits.float(), -1)
    v, i = lp.topk(5)
    return ids.shape[1], [(tok.decode([int(a)]), round(float(b), 3)) for a, b in zip(i, v)]


env = {**os.environ, "LD_LIBRARY_PATH": BIN}
srv = subprocess.Popen([f"{BIN}/llama-server", "-m", f"{ROOT}/models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf", "--lora", f"{SP}/rand-lora.gguf",
                        "--port", "8391", "-c", "2048", "-t", "4", "-np", "1", "--no-webui"], env=env, stdout=subprocess.DEVNULL, stderr=open(f"{SP}/srv.log", "w"))


def post(path, body):
    req = urllib.request.Request(f"http://127.0.0.1:8391{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))


try:
    for _ in range(120):
        try:
            if json.load(urllib.request.urlopen("http://127.0.0.1:8391/health", timeout=2)).get("status") == "ok":
                break
        except Exception:
            time.sleep(1)
    for scale in (1.0, 0.0):
        post("/lora-adapters", [{"id": 0, "scale": scale}])
        for p in prompts:
            # server adds BOS itself, so strip ours
            r = post("/completion", {"prompt": p.removeprefix("<|begin_of_text|>"), "n_predict": 1, "n_probs": 5, "temperature": 0, "cache_prompt": False})
            cp = r["completion_probabilities"][0]
            top = cp.get("top_logprobs") or cp.get("probs")
            cpp = [(t["token"], round(t.get("logprob", 0), 3)) for t in top]
            n, hf = hf_top(p, adapter=scale == 1.0)
            print(f"lora_scale={scale} hf_tokens={n} cpp_tokens={r['tokens_evaluated']}\n   HF : {hf}\n   CPP: {cpp}")
finally:
    srv.terminate()
