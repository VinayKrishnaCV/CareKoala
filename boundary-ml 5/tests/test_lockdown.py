import base64
import unittest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from boundary_ml.lockdown_worker import encrypt

class LockdownTests(unittest.TestCase):
    def test_rsa_round_trip_requires_guardian_private_key(self):
        key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        der=key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        payload={'key':'a'*32,'issued_at':1234}
        ciphertext=base64.b64decode(encrypt(base64.b64encode(der).decode(),payload))
        scheme=padding.OAEP(mgf=padding.MGF1(hashes.SHA1()),algorithm=hashes.SHA256(),label=None)
        self.assertIn(b'a'*32,key.decrypt(ciphertext,scheme))
        other=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        with self.assertRaises(ValueError):other.decrypt(ciphertext,scheme)
        tampered=bytearray(ciphertext);tampered[0]^=1
        with self.assertRaises(ValueError):key.decrypt(bytes(tampered),scheme)
