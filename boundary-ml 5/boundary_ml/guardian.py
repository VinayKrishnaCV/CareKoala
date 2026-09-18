from __future__ import annotations

import json
import os
from dataclasses import dataclass

from .schemas import Analysis, GuardianAlert


def create_alert(analysis: Analysis) -> GuardianAlert:
    """Create the minimum useful guardian alert without conversation content."""
    items = [
        f"{concern.type.replace('_', ' ')}: {concern.explanation}"
        for concern in analysis.concerns
    ]
    if not items:
        raise ValueError("A guardian alert requires a detected concern")
    return GuardianAlert(
        summary="CareKoala recommends that you contact your guardian. "
        "The user is requesting help. " + " ".join(items),
    )


@dataclass(frozen=True)
class GuardianTransport:
    rendezvous_key: str
    guardian_public_key: str

    @classmethod
    def from_environment(cls) -> "GuardianTransport | None":
        rendezvous_key = os.getenv("CAREKOALA_GUARDIAN_RENDEZVOUS_KEY", "").strip()
        guardian_public_key = os.getenv("CAREKOALA_GUARDIAN_PUBLIC_KEY", "").strip()
        if not rendezvous_key and not guardian_public_key:
            return None
        if not rendezvous_key or not guardian_public_key:
            raise ValueError("Guardian pairing is incomplete")
        raise ValueError("Legacy guardian pairing is unsupported. Verify a new pairing in CareKoala settings.")

    def publish(self, alert: GuardianAlert) -> None:
        raise RuntimeError("Use the verified, protected desktop guardian pairing")
