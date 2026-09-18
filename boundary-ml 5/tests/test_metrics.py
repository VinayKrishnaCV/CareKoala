import unittest

from boundary_ml.evaluation import score


class MetricTests(unittest.TestCase):
    def test_invalid_output_counts_as_missed_concern(self):
        rows = [{
            "example_id": "x",
            "input": {"messages": [{"id": "M1", "speaker": "other", "text": "OTP?"}]},
            "label": {
                "status": "concern_detected",
                "concerns": [{"type": "credential_request", "evidence_ids": ["M1"], "explanation": "x"}],
                "clarifying_question": None,
            },
        }]
        result = score(rows, [{"parsed": None, "error": "invalid"}])
        self.assertEqual(result["valid_json_rate"], 0)
        self.assertEqual(result["per_concern"]["credential_request"]["fn"], 1)


if __name__ == "__main__":
    unittest.main()

