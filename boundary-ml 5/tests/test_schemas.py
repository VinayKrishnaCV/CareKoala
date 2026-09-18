import unittest

from boundary_ml.parsing import parse_and_validate
from boundary_ml.schemas import AnalyzeRequest


class SchemaTests(unittest.TestCase):
    def request(self):
        return AnalyzeRequest.model_validate({
            "conversation_id": "test",
            "messages": [
                {"id": "M1", "speaker": "other", "text": "Send the OTP"},
                {"id": "M2", "speaker": "user", "text": "No"},
            ],
            "boundaries": [],
        })

    def test_valid_evidence(self):
        output = '{"status":"concern_detected","concerns":[{"type":"credential_request","evidence_ids":["M1"],"explanation":"The message asks for an OTP."}],"clarifying_question":null}'
        self.assertEqual(parse_and_validate(output, self.request()).concerns[0].evidence_ids, ["M1"])

    def test_unknown_evidence_is_rejected(self):
        output = '{"status":"concern_detected","concerns":[{"type":"credential_request","evidence_ids":["M99"],"explanation":"The message asks for an OTP."}],"clarifying_question":null}'
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            parse_and_validate(output, self.request())

    def test_status_and_concerns_must_agree(self):
        output = '{"status":"no_clear_concern","concerns":[{"type":"credential_request","evidence_ids":["M1"],"explanation":"x"}],"clarifying_question":null}'
        with self.assertRaises(ValueError):
            parse_and_validate(output, self.request())

    def test_trailing_model_text_is_rejected(self):
        output = '{"status":"no_clear_concern","concerns":[],"clarifying_question":null} extra'
        with self.assertRaisesRegex(ValueError, "trailing"):
            parse_and_validate(output, self.request())

    def test_concern_may_include_one_clarifying_question(self):
        output = '{"status":"concern_detected","concerns":[{"type":"credential_request","evidence_ids":["M1"],"explanation":"The message asks for an OTP."}],"clarifying_question":"Did you request this login?"}'
        parsed = parse_and_validate(output, self.request())
        self.assertEqual(parsed.clarifying_question, "Did you request this login?")


if __name__ == "__main__":
    unittest.main()
