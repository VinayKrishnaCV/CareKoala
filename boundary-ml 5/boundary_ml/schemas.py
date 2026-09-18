from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ConcernType(str, Enum):
    safe = "safe"
    distress = "distress"
    self_harm = "self_harm"
    harassment = "harassment"
    hate_speech = "hate_speech"
    violence = "violence"
    credential_request = "credential_request"
    pressure_after_refusal = "pressure_after_refusal"
    assistance_related_coercion = "assistance_related_coercion"


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=80)
    speaker: Literal["user", "other"]
    text: str = Field(min_length=1, max_length=2_000)


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    conversation_id: str = Field(min_length=1, max_length=128)
    messages: list[Message] = Field(min_length=1, max_length=40)
    boundaries: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("boundaries")
    @classmethod
    def validate_boundaries(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 300 for value in cleaned):
            raise ValueError("boundaries must contain 1-300 characters")
        return cleaned

    @model_validator(mode="after")
    def validate_request(self) -> "AnalyzeRequest":
        ids = [message.id for message in self.messages]
        if len(ids) != len(set(ids)):
            raise ValueError("message IDs must be unique")
        if sum(len(message.text) for message in self.messages) > 20_000:
            raise ValueError("conversation exceeds 20,000 characters")
        return self


class Concern(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    type: ConcernType
    evidence_ids: list[str] = Field(min_length=1, max_length=12)
    explanation: str = Field(min_length=1, max_length=500)


class Analysis(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: Literal[
        "concern_detected", "no_clear_concern", "insufficient_context"
    ]
    concerns: list[Concern] = Field(default_factory=list, max_length=3)
    clarifying_question: str | None = Field(default=None, max_length=300)
    score: int | None = Field(default=None, ge=0, le=10, strict=True)
    category: Literal['safe','distress','self_harm','harassment','hate_speech','violence'] | None = None
    level: Literal['none','watch','alert','emergency'] | None = None
    contact_guardian: bool | None = None
    windows: int | None = Field(default=None,ge=1)
    model: str | None = None

    @model_validator(mode="after")
    def validate_semantics(self) -> "Analysis":
        if self.score is not None:
            expected='emergency' if self.score>=9 else 'alert' if self.score>=7 else 'watch' if self.score>=4 else 'none'
            if self.category is None or self.level!=expected or self.contact_guardian is not (self.score>=7):
                raise ValueError('Score policy mismatch')
            if self.status!=('concern_detected' if self.score>=7 else 'no_clear_concern'):
                raise ValueError('Score status mismatch')
        if self.status == "concern_detected" and not self.concerns:
            raise ValueError("concern_detected requires at least one concern")
        if self.status != "concern_detected" and self.concerns:
            raise ValueError("only concern_detected may contain concerns")
        if self.status == "insufficient_context" and not self.clarifying_question:
            raise ValueError("insufficient_context requires a clarifying question")
        if self.status == "no_clear_concern" and self.clarifying_question:
            raise ValueError("no_clear_concern must not contain a clarifying question")
        types = [concern.type for concern in self.concerns]
        if len(types) != len(set(types)):
            raise ValueError("concern types must not repeat")
        return self


class GuardianAlertRequest(BaseModel):
    """A user-approved help request that intentionally excludes raw messages."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    analysis: Analysis


class GuardianAlert(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    version: Literal[1] = 1
    kind: Literal["carekoala_help_request"] = "carekoala_help_request"
    request_help: Literal[True] = True
    summary: str = Field(min_length=1, max_length=1_000)


class UnavailableResponse(BaseModel):
    status: Literal["analysis_unavailable"] = "analysis_unavailable"
    message: str


def validate_evidence(analysis: Analysis, request: AnalyzeRequest) -> Analysis:
    valid_ids = {message.id for message in request.messages}
    for concern in analysis.concerns:
        unknown = set(concern.evidence_ids) - valid_ids
        if unknown:
            raise ValueError(f"unknown evidence IDs: {sorted(unknown)}")
        if len(concern.evidence_ids) != len(set(concern.evidence_ids)):
            raise ValueError("evidence IDs must not repeat")
    return analysis
