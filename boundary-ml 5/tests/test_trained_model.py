import unittest
from unittest.mock import Mock
from boundary_ml.trained_model import TrainedModel,parse_score,windows,level
from boundary_ml.schemas import AnalyzeRequest,Analysis

class TrainedModelTests(unittest.TestCase):
    def test_strict_score_parser(self):
        self.assertEqual(parse_score('10, "category": "self_harm"'),(10,'self_harm'))
        for value in ['11, "category":"safe"','true, "category":"safe"','-1, "category":"safe"','7.5, "category":"safe"','7, "category":"invented"','oops']:
            with self.assertRaises((ValueError,TypeError)):parse_score(value)
    def test_thresholds(self):
        self.assertEqual([level(x) for x in [0,3,4,6,7,8,9,10]],['none','none','watch','watch','alert','alert','emergency','emergency'])
    def test_all_windows_scored_and_late_alert_preserved(self):
        text='\n'.join(('safe '+str(i)+' x'*250) for i in range(12))+'\nlate warning'
        chunks=windows(text)
        self.assertGreater(len(chunks),8)
        self.assertTrue(all(len(w)<=520 for w in chunks))
        request=AnalyzeRequest(conversation_id='test',messages=[{'id':f'M{i}','speaker':'other','text':chunk} for i,chunk in enumerate(chunks)])
        model=TrainedModel();model.score_window=Mock(side_effect=lambda t:(9,'self_harm') if 'late warning' in t else (0,'safe'))
        result=model.analyze(request)
        self.assertEqual(result.score,9);self.assertTrue(result.contact_guardian)
        self.assertEqual(model.score_window.call_count,len(chunks))
        self.assertIn(f'M{len(chunks)-1}',result.concerns[0].evidence_ids)
    def test_score_policy_cannot_disagree(self):
        with self.assertRaises(ValueError):Analysis(status='no_clear_concern',score=8,category='self_harm',level='alert',contact_guardian=False)
