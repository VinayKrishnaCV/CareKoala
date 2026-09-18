import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from boundary_ml.schemas import Analysis, AnalyzeRequest, validate_evidence


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        subprocess.run([
            sys.executable,
            "scripts/generate_dataset.py",
            "--output-dir",
            cls.temp.name,
            "--variants-per-family",
            "4",
        ], check=True, capture_output=True, text=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def rows(self, name):
        return [json.loads(line) for line in (Path(self.temp.name) / name).read_text().splitlines()]

    def test_scenario_families_do_not_cross_splits(self):
        families = {}
        for split in ("train.jsonl", "validation.jsonl", "test.jsonl"):
            for row in self.rows(split):
                previous = families.setdefault(row["scenario_family"], split)
                self.assertEqual(previous, split)

    def test_examples_and_labels_validate(self):
        for name in ("train.jsonl", "validation.jsonl", "test.jsonl", "challenge.jsonl", "multilingual_exploratory.jsonl"):
            for row in self.rows(name):
                request = AnalyzeRequest.model_validate(row["input"])
                analysis = Analysis.model_validate(row["label"])
                validate_evidence(analysis, request)

    def test_no_duplicate_conversations_within_split(self):
        for split in ("train.jsonl", "validation.jsonl", "test.jsonl"):
            messages = [json.dumps(row["input"]["messages"], sort_keys=True) for row in self.rows(split)]
            self.assertEqual(len(messages), len(set(messages)))


if __name__ == "__main__":
    unittest.main()

