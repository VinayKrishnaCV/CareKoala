from __future__ import annotations

import json

from .schemas import Analysis, AnalyzeRequest, validate_evidence


def extract_json_object(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    decoder = json.JSONDecoder()
    start = text.find("{")
    if start < 0:
        raise ValueError("model output contains no JSON object")
    value, end = decoder.raw_decode(text[start:])
    if text[start + end :].strip():
        raise ValueError("model output contains trailing text")
    if not isinstance(value, dict):
        raise ValueError("model output must be a JSON object")
    return value


def parse_and_validate(text: str, request: AnalyzeRequest) -> Analysis:
    analysis = Analysis.model_validate(extract_json_object(text))
    return validate_evidence(analysis, request)

