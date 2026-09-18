from __future__ import annotations

import json
import statistics
from pathlib import Path

from .schemas import AnalyzeRequest, ConcernType


TYPES = [item.value for item in ConcernType]


def load_rows(paths: list[str]) -> list[dict]:
    rows = []
    for path in paths:
        for line in Path(path).read_text().splitlines():
            if line:
                row = json.loads(line)
                row["source_file"] = str(path)
                rows.append(row)
    return rows


def score(rows: list[dict], predictions: list[dict]) -> dict:
    counts = {kind: {"tp": 0, "fp": 0, "fn": 0} for kind in TYPES}
    valid_json = 0
    benign_total = benign_fp = ambiguous_total = ambiguous_correct = 0
    evidence_valid_total = evidence_match_sum = evidence_match_count = 0
    evidence_type_matches = 0
    failures = []
    latencies = []

    for row, prediction in zip(rows, predictions):
        gold = row["label"]
        gold_types = {item["type"] for item in gold["concerns"]}
        if not gold_types:
            benign_total += gold["status"] == "no_clear_concern"
        if gold["status"] == "insufficient_context":
            ambiguous_total += 1
        parsed = prediction.get("parsed")
        if parsed is None:
            predicted_types = set()
            if failures.__len__() < 12:
                failures.append({
                    "example_id": row["example_id"],
                    "reason": prediction.get("error", "invalid output"),
                    "raw": prediction.get("raw", "")[:500],
                })
        else:
            valid_json += 1
            predicted_types = {item["type"] for item in parsed["concerns"]}
            if gold["status"] == "insufficient_context":
                ambiguous_correct += parsed["status"] == "insufficient_context"
            supplied_ids = {message["id"] for message in row["input"]["messages"]}
            for concern in parsed["concerns"]:
                evidence_valid_total += 1
                evidence_ids = set(concern["evidence_ids"])
                if evidence_ids <= supplied_ids:
                    evidence_match_count += 1
            gold_by_type = {item["type"]: set(item["evidence_ids"]) for item in gold["concerns"]}
            pred_by_type = {item["type"]: set(item["evidence_ids"]) for item in parsed["concerns"]}
            for kind in gold_types & predicted_types:
                union = gold_by_type[kind] | pred_by_type[kind]
                evidence_match_sum += len(gold_by_type[kind] & pred_by_type[kind]) / len(union)
                evidence_type_matches += 1
        if not gold_types and predicted_types:
            benign_fp += 1
        for kind in TYPES:
            if kind in gold_types and kind in predicted_types:
                counts[kind]["tp"] += 1
            elif kind not in gold_types and kind in predicted_types:
                counts[kind]["fp"] += 1
            elif kind in gold_types and kind not in predicted_types:
                counts[kind]["fn"] += 1
        if prediction.get("latency_seconds") is not None:
            latencies.append(prediction["latency_seconds"])

    metrics = {}
    for kind, c in counts.items():
        precision = c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else 0.0
        recall = c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else 0.0
        metrics[kind] = {**c, "precision": precision, "recall": recall}
    return {
        "examples": len(rows),
        "per_concern": metrics,
        "false_positive_rate_benign": benign_fp / benign_total if benign_total else 0.0,
        "ambiguous_accuracy": ambiguous_correct / ambiguous_total if ambiguous_total else 0.0,
        "valid_json_rate": valid_json / len(rows) if rows else 0.0,
        "evidence_id_valid_rate": evidence_match_count / evidence_valid_total if evidence_valid_total else 0.0,
        "evidence_jaccard_on_correct_type": evidence_match_sum / evidence_type_matches if evidence_type_matches else 0.0,
        "latency_seconds": {
            "mean": statistics.mean(latencies) if latencies else None,
            "median": statistics.median(latencies) if latencies else None,
        },
        "representative_failures": failures,
    }


def evaluate(model_name: str, adapter: str | None, inputs: list[str], load_in_4bit: bool) -> dict:
    import platform
    import torch

    from .modeling import BoundaryModel, hardware_name

    rows = load_rows(inputs)
    model = BoundaryModel(model_name, adapter=adapter, load_in_4bit=load_in_4bit)
    predictions = []
    for row in rows:
        request = AnalyzeRequest.model_validate(row["input"])
        try:
            result = model.analyze(request)
            predictions.append({
                "parsed": result.analysis.model_dump(mode="json"),
                "raw": result.raw,
                "latency_seconds": result.latency_seconds,
            })
        except Exception as exc:
            predictions.append({"parsed": None, "error": str(exc), "raw": ""})
    return {
        "model": model_name,
        "adapter": adapter,
        "input_files": inputs,
        "hardware": hardware_name(),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "generation": {"do_sample": False, "max_new_tokens": 300, "thinking": False},
        "metrics": score(rows, predictions),
        "predictions": [
            {"example_id": row["example_id"], **prediction}
            for row, prediction in zip(rows, predictions)
        ],
    }
