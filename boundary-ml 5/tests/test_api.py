import os
import unittest
from unittest.mock import patch

os.environ["CAREKOALA_MOCK"] = "1"

from fastapi.testclient import TestClient

from boundary_ml.api import app


class ApiTests(unittest.TestCase):
    def test_mock_transport_and_schema(self):
        response = TestClient(app).post("/analyze", json={
            "conversation_id": "electron-window",
            "messages": [
                {"id": "M1", "speaker": "other", "text": "Send the OTP"},
                {"id": "M2", "speaker": "user", "text": "Why?"},
            ],
            "boundaries": [],
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "concern_detected")
        self.assertEqual(body["concerns"][0]["evidence_ids"], ["M1"])

    def test_duplicate_message_ids_are_rejected(self):
        response = TestClient(app).post("/analyze", json={
            "conversation_id": "x",
            "messages": [
                {"id": "M1", "speaker": "other", "text": "first"},
                {"id": "M1", "speaker": "user", "text": "second"},
            ],
            "boundaries": [],
        })
        self.assertEqual(response.status_code, 422)

    def test_model_release_endpoint(self):
        response = TestClient(app).post("/model/release")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "released"})

    @patch.dict(os.environ, {"CAREKOALA_GUARDIAN_PUBLIC_KEY": "", "CAREKOALA_GUARDIAN_RENDEZVOUS_KEY": ""})
    @patch("boundary_ml.guardian.GuardianTransport.publish", side_effect=AssertionError("No network allowed"))
    def test_guardian_alert_requires_pairing(self, publish):
        response = TestClient(app).post("/guardian/alert", json={
            "analysis": {
                "status": "concern_detected",
                "concerns": [{
                    "type": "credential_request",
                    "evidence_ids": ["M1"],
                    "explanation": "This message asks for an authentication secret.",
                }],
                "clarifying_question": None,
            },
        })
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "No guardian has been paired")
        publish.assert_not_called()

    @patch.dict(os.environ, {"CAREKOALA_GUARDIAN_PUBLIC_KEY": "test", "CAREKOALA_GUARDIAN_RENDEZVOUS_KEY": ""})
    @patch("boundary_ml.guardian.GuardianTransport.publish", side_effect=AssertionError("No network allowed"))
    def test_incomplete_pairing_fails_safely(self, publish):
        response = TestClient(app).post("/guardian/alert", json={"analysis": {
            "status": "concern_detected",
            "concerns": [{"type": "credential_request", "evidence_ids": ["M1"],
                          "explanation": "This message asks for an authentication secret."}],
            "clarifying_question": None,
        }})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Guardian pairing is incomplete")
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
