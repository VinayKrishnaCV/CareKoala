import os
import unittest

os.environ["BOUNDARY_MOCK"] = "1"

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


if __name__ == "__main__":
    unittest.main()
