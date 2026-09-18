import base64
import json
import unittest
from unittest.mock import Mock
from boundary_ml.guardian_protocol import seal,open_alert,route_hash,ntfy_topic,TEST_MESSAGE
from boundary_ml.guardian_worker import publish

class GuardianProtocolTests(unittest.TestCase):
    pair={'v':1,'key':base64.b64encode(bytes(range(32))).decode(),'route':base64.b64encode(bytes(range(32,64))).decode()}
    def test_authenticated_round_trip_and_expiry(self):
        envelope=seal(self.pair,1000)
        self.assertTrue(open_alert(self.pair,envelope,1100)['contact_guardian'])
        self.assertNotIn(b'guardian_check_in',envelope)
        with self.assertRaises(ValueError):open_alert(self.pair,envelope,1300)
    def test_tampering_and_wrong_pair_are_rejected(self):
        envelope=json.loads(seal(self.pair,1000));data=bytearray(base64.b64decode(envelope['ciphertext']));data[0]^=1
        envelope['ciphertext']=base64.b64encode(data).decode()
        with self.assertRaises(Exception):open_alert(self.pair,json.dumps(envelope).encode(),1100)
        other={**self.pair,'key':base64.b64encode(bytes(32)).decode()}
        with self.assertRaises(Exception):open_alert(other,seal(self.pair,1000),1100)
    def test_route_rotation(self):
        self.assertEqual(route_hash(self.pair,900),route_hash(self.pair,1199))
        self.assertNotEqual(route_hash(self.pair,1199),route_hash(self.pair,1200))
    def test_sample_warning_is_authenticated_and_distinct(self):
        envelope=seal(self.pair,1000,test=True)
        self.assertNotIn(TEST_MESSAGE.encode(),envelope)
        alert=open_alert(self.pair,envelope,1100)
        self.assertIs(alert['test'],True)
        self.assertEqual(alert['message'],TEST_MESSAGE)
        self.assertNotIn('test',open_alert(self.pair,seal(self.pair,1000),1100))
    def test_ntfy_posts_only_ciphertext_and_checks_ack(self):
        opener=Mock();response=Mock(status=200)
        opener.open.return_value.__enter__=Mock(return_value=response)
        opener.open.return_value.__exit__=Mock(return_value=False)
        response.read.return_value=json.dumps({'event':'message','topic':ntfy_topic(self.pair),'id':'synthetic'}).encode()
        self.assertFalse(publish(self.pair,opener,test=True)['receipt_confirmed'])
        request=opener.open.call_args.args[0]
        self.assertEqual(request.full_url,'https://ntfy.sh/'+ntfy_topic(self.pair))
        self.assertTrue(open_alert(self.pair,request.data)['test'])
        self.assertNotIn(TEST_MESSAGE.encode(),request.data)
        self.assertEqual(opener.open.call_args.kwargs['timeout'],25)
        response.read.return_value=b'{}'
        with self.assertRaises(RuntimeError):publish(self.pair,opener)
    def test_ntfy_failure_does_not_expose_topic(self):
        opener=Mock();opener.open.side_effect=Exception(ntfy_topic(self.pair))
        with self.assertRaises(RuntimeError) as caught:publish(self.pair,opener)
        self.assertNotIn(ntfy_topic(self.pair),str(caught.exception))
