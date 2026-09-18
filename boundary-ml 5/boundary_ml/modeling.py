from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from .parsing import parse_and_validate
from .prompting import build_messages
from .schemas import Analysis, AnalyzeRequest


def best_dtype() -> torch.dtype:
    if torch.cuda.is_available():
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if torch.backends.mps.is_available():
        return torch.float16
    return torch.float32


def hardware_name() -> str:
    if torch.cuda.is_available():
        return torch.cuda.get_device_name(0)
    if torch.backends.mps.is_available():
        return "Apple MPS"
    return "CPU"


@dataclass
class GenerationResult:
    analysis: Analysis
    raw: str
    latency_seconds: float


class BoundaryModel:
    def __init__(
        self,
        model_name: str,
        adapter: str | None = None,
        load_in_4bit: bool = False,
    ) -> None:
        quantization_config = None
        if load_in_4bit:
            if not torch.cuda.is_available():
                raise RuntimeError("4-bit loading requires a CUDA GPU")
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=best_dtype(),
                bnb_4bit_use_double_quant=True,
            )
        self.tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=best_dtype(),
            device_map="auto",
            quantization_config=quantization_config,
        )
        if adapter:
            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, adapter)
        self.model.eval()

    @torch.inference_mode()
    def analyze(self, request: AnalyzeRequest, max_new_tokens: int = 300) -> GenerationResult:
        prompt = self.tokenizer.apply_chat_template(
            build_messages(request),
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        started = time.perf_counter()
        output = self.model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=None,
            top_p=None,
            top_k=None,
            pad_token_id=self.tokenizer.eos_token_id,
        )
        elapsed = time.perf_counter() - started
        generated = output[0, inputs["input_ids"].shape[1] :]
        raw = self.tokenizer.decode(generated, skip_special_tokens=True).strip()
        return GenerationResult(
            analysis=parse_and_validate(raw, request), raw=raw, latency_seconds=elapsed
        )
