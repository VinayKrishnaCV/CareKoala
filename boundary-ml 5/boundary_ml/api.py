from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path
import threading
import signal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .guardian import GuardianTransport, create_alert
from .schemas import Analysis, AnalyzeRequest, Concern, GuardianAlertRequest


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("carekoala.api")
analysis_lock = threading.Lock()

app = FastAPI(title="CareKoala Analysis API", version="0.1.0")
origins = [
    value.strip()
    for value in os.getenv("CAREKOALA_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if value.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
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
        "mode": "mock" if os.getenv("CAREKOALA_MOCK") == "1" else "model",
        "model_loaded": analysis_lock.locked(),
        "model": "CareKoala Llama-3.2-1B Q4_K_M + LoRA v2",
    }


@app.post("/model/release")
def release_model() -> dict[str, str]:
    """Release model memory before local OCR performs its own heavy work."""
    with analysis_lock:
        pass  # The inference child has exited before the lock is released.
    return {"status": "released"}


@app.get("/guardian/status")
def guardian_status() -> dict[str, bool]:
    try:
        return {"paired": GuardianTransport.from_environment() is not None}
    except ValueError:
        return {"paired": False}


@app.post("/guardian/alert")
def guardian_alert(request: GuardianAlertRequest) -> dict[str, str]:
    if request.analysis.status != "concern_detected":
        raise HTTPException(status_code=422, detail="A concern is required before requesting help")
    try:
        transport = GuardianTransport.from_environment()
        if transport is None:
            raise RuntimeError("No guardian has been paired")
        alert = create_alert(request.analysis)
        transport.publish(alert)
        return {"status": "sent"}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post(
    "/analyze",
    response_model=Analysis,
    responses={503: {"description": "Model generation or validation failed"}},
)
def analyze(request: AnalyzeRequest) -> Analysis:
    return analyze_request(request, allow_mock=True)


@app.post("/analyze/real", response_model=Analysis)
def analyze_real(request: AnalyzeRequest) -> Analysis:
    return analyze_request(request, allow_mock=False)

@app.post('/analyze/mock',response_model=Analysis)
def analyze_mock(request:AnalyzeRequest)->Analysis:
    return mock_analysis(request)


def run_inference(request):
    child=subprocess.Popen([sys.executable,'-m','boundary_ml.inference_worker'],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
        encoding='utf-8',cwd=Path(__file__).resolve().parents[1],
        env={**os.environ,'PYTHONIOENCODING':'utf-8','OMP_NUM_THREADS':'2'},
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0,
        start_new_session=os.name!='nt')
    try:
        stdout,stderr=child.communicate(request.model_dump_json(),timeout=180)
        return subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)
    except BaseException:
        # Stop llama-server as well as Python before releasing the OCR/model lock.
        if os.name=='nt':
            subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW,timeout=15)
        else:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        child.communicate(timeout=15)
        raise

def analyze_request(request: AnalyzeRequest, allow_mock: bool) -> Analysis:
    try:
        if allow_mock and os.getenv("CAREKOALA_MOCK") == "1":
            return mock_analysis(request)
        # The lock prevents two model generations from exhausting local memory.
        with analysis_lock:
            result = run_inference(request)
            if result.returncode:
                raise RuntimeError("Local model worker failed")
            return Analysis.model_validate_json(result.stdout)
    except Exception:
        # Do not log request bodies, raw generation, or conversation identifiers.
        logger.error("Local analysis failed")
        raise HTTPException(
            status_code=503,
            detail={
                "status": "analysis_unavailable",
                "message": "CareKoala could not produce a validated analysis.",
            },
        )
