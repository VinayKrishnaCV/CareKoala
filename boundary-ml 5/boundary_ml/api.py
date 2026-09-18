from __future__ import annotations

import logging
import os
import gc
import threading
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import Analysis, AnalyzeRequest, Concern


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("boundary.api")
analysis_lock = threading.Lock()

app = FastAPI(title="Boundary Analysis API", version="0.1.0")
origins = [
    value.strip()
    for value in os.getenv("BOUNDARY_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if value.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


@lru_cache(maxsize=1)
def get_model():
    from .modeling import BoundaryModel

    return BoundaryModel(
        os.getenv("BOUNDARY_MODEL", "Qwen/Qwen3-0.6B"),
        adapter=os.getenv("BOUNDARY_ADAPTER") or None,
        load_in_4bit=os.getenv("BOUNDARY_LOAD_IN_4BIT", "0") == "1",
    )


def mock_analysis(request: AnalyzeRequest) -> Analysis:
    """Deterministic transport test. Never present this as model analysis."""
    for message in request.messages:
        lowered = message.text.lower()
        if message.speaker == "other" and any(
            term in lowered for term in ("otp", "password", "verification code")
        ):
            return Analysis(
                status="concern_detected",
                concerns=[Concern(
                    type="credential_request",
                    evidence_ids=[message.id],
                    explanation="This message asks for an authentication secret.",
                )],
                clarifying_question=None,
            )
    return Analysis(status="no_clear_concern", concerns=[], clarifying_question=None)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "mode": "mock" if os.getenv("BOUNDARY_MOCK") == "1" else "model",
        "model_loaded": get_model.cache_info().currsize > 0,
    }


@app.post("/model/release")
def release_model() -> dict[str, str]:
    """Release model memory before local OCR performs its own heavy work."""
    with analysis_lock:
        get_model.cache_clear()
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except ImportError:
            pass
    return {"status": "released"}


@app.post(
    "/analyze",
    response_model=Analysis,
    responses={503: {"description": "Model generation or validation failed"}},
)
def analyze(request: AnalyzeRequest) -> Analysis:
    try:
        if os.getenv("BOUNDARY_MOCK") == "1":
            return mock_analysis(request)
        # The lock prevents two model generations from exhausting local memory.
        with analysis_lock:
            return get_model().analyze(request).analysis
    except Exception:
        # Do not log request bodies, raw generation, or conversation identifiers.
        logger.exception("analysis failed")
        raise HTTPException(
            status_code=503,
            detail={
                "status": "analysis_unavailable",
                "message": "Boundary could not produce a validated analysis.",
            },
        )
