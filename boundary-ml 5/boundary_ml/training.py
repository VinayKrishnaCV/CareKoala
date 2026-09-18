from __future__ import annotations

import json
import platform
import random
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
    set_seed,
)

from .modeling import best_dtype, hardware_name
from .prompting import build_messages, expected_json
from .schemas import AnalyzeRequest


class JsonlDataset(Dataset):
    def __init__(self, path: str, tokenizer, max_length: int):
        self.rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line]
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        row = self.rows[index]
        request = AnalyzeRequest.model_validate(row["input"])
        prompt_ids = self.tokenizer.apply_chat_template(
            build_messages(request),
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        full_ids = self.tokenizer.apply_chat_template(
            build_messages(request)
            + [{"role": "assistant", "content": expected_json(row)}],
            tokenize=True,
            add_generation_prompt=False,
            enable_thinking=False,
        )
        if full_ids[: len(prompt_ids)] != prompt_ids:
            raise RuntimeError("chat-template prompt is not a prefix of the training sample")
        if len(full_ids) > self.max_length:
            raise ValueError(
                f"example {row.get('example_id', index)} is {len(full_ids)} tokens; "
                f"increase --max-length instead of truncating evidence"
            )
        return {
            "input_ids": full_ids,
            "attention_mask": [1] * len(full_ids),
            "labels": [-100] * len(prompt_ids) + full_ids[len(prompt_ids) :],
        }


class CompletionCollator:
    def __init__(self, pad_token_id: int):
        self.pad_token_id = pad_token_id

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
        max_len = max(len(feature["input_ids"]) for feature in features)
        batch = {"input_ids": [], "attention_mask": [], "labels": []}
        for feature in features:
            padding = max_len - len(feature["input_ids"])
            batch["input_ids"].append(feature["input_ids"] + [self.pad_token_id] * padding)
            batch["attention_mask"].append(feature["attention_mask"] + [0] * padding)
            batch["labels"].append(feature["labels"] + [-100] * padding)
        return {key: torch.tensor(value, dtype=torch.long) for key, value in batch.items()}


def train(args) -> dict:
    random.seed(args.seed)
    np.random.seed(args.seed)
    set_seed(args.seed)
    if args.load_in_4bit and not torch.cuda.is_available():
        raise RuntimeError("--load-in-4bit requires CUDA and bitsandbytes")
    if hardware_name() == "CPU" and not args.allow_cpu:
        raise RuntimeError(
            "No CUDA or MPS accelerator detected. Use the notebook/GPU setup, or pass "
            "--allow-cpu only for a deliberately slow smoke run."
        )

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    quantization_config = None
    if args.load_in_4bit:
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=best_dtype(),
            bnb_4bit_use_double_quant=True,
        )
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=best_dtype(),
        device_map="auto",
        quantization_config=quantization_config,
    )
    if args.load_in_4bit:
        model = prepare_model_for_kbit_training(model)
    model.config.use_cache = False
    model = get_peft_model(
        model,
        LoraConfig(
            r=args.lora_rank,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=[
                "q_proj", "k_proj", "v_proj", "o_proj",
                "gate_proj", "up_proj", "down_proj",
            ],
        ),
    )
    train_data = JsonlDataset(args.train_file, tokenizer, args.max_length)
    val_data = JsonlDataset(args.val_file, tokenizer, args.max_length)
    max_steps = args.max_steps if args.max_steps is not None else -1
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=args.epochs,
        max_steps=max_steps,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        warmup_ratio=0.05,
        weight_decay=0.01,
        logging_steps=1,
        eval_strategy="steps",
        eval_steps=max(1, args.eval_steps),
        save_strategy="steps",
        save_steps=max(1, args.eval_steps),
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        fp16=torch.cuda.is_available() and not torch.cuda.is_bf16_supported(),
        gradient_checkpointing=True,
        report_to="none",
        seed=args.seed,
        data_seed=args.seed,
        remove_unused_columns=False,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_data,
        eval_dataset=val_data,
        data_collator=CompletionCollator(tokenizer.pad_token_id),
    )
    result = trainer.train()
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    metadata = {
        "base_model": args.model,
        "hardware": hardware_name(),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "seed": args.seed,
        "train_examples": len(train_data),
        "validation_examples": len(val_data),
        "training_arguments": vars(args),
        "train_metrics": result.metrics,
    }
    (output_dir / "run_metadata.json").write_text(
        json.dumps(metadata, indent=2, default=str) + "\n"
    )
    return metadata

