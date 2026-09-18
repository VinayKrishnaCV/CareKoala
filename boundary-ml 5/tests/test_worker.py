import os
import subprocess
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from boundary_ml.api import app,run_inference
from boundary_ml.schemas import AnalyzeRequest

class WorkerTests(unittest.TestCase):
    payload = {"conversation_id": "test", "messages": [{"id": "M1", "speaker": "other", "text": "hello"}], "boundaries": []}

    @unittest.skipUnless(os.name=='nt','Windows tree cleanup')
    @patch('boundary_ml.api.subprocess.run')
    @patch('boundary_ml.api.subprocess.Popen')
    def test_timeout_terminates_model_descendants_before_return(self,popen,run):
        child=popen.return_value;child.pid=12345
        child.communicate.side_effect=[subprocess.TimeoutExpired('worker',180),('','')]
        with self.assertRaises(subprocess.TimeoutExpired):run_inference(AnalyzeRequest.model_validate(self.payload))
        self.assertEqual(run.call_args.args[0],['taskkill','/PID','12345','/T','/F'])
        self.assertEqual(child.communicate.call_count,2)

    @patch.dict(os.environ, {"CAREKOALA_MOCK": "0"})
    @patch("boundary_ml.api.run_inference")
    def test_worker_is_waited_for_and_release_remains_available(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '{"status":"no_clear_concern","concerns":[],"clarifying_question":null}', '')
        client = TestClient(app)
        self.assertEqual(client.post('/analyze', json=self.payload).status_code, 200)
        self.assertEqual(run.call_args.args[0].conversation_id,'test')
        self.assertEqual(client.post('/model/release').status_code, 200)

    @patch.dict(os.environ, {"CAREKOALA_MOCK": "0"})
    @patch("boundary_ml.api.run_inference", side_effect=subprocess.TimeoutExpired('worker', 180))
    def test_timeout_is_safe_and_releases_lock(self, run):
        client = TestClient(app)
        self.assertEqual(client.post('/analyze', json=self.payload).status_code, 503)
        self.assertEqual(client.post('/model/release').status_code, 200)


class RealEndpointTests(unittest.TestCase):
    @patch.dict(os.environ, {"CAREKOALA_MOCK": "1"})
    @patch("boundary_ml.api.run_inference")
    def test_real_endpoint_cannot_silently_use_mock(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '{"status":"no_clear_concern","concerns":[],"clarifying_question":null}', '')
        response=TestClient(app).post('/analyze/real',json=WorkerTests.payload)
        self.assertEqual(response.status_code,200)
        run.assert_called_once()
