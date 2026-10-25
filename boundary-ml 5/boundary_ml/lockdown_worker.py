"""RSA encryption only. The guardian private key never exists on this PC."""
import base64
import json
import sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

def encrypt(public_der, payload):
    public = serialization.load_der_public_key(base64.b64decode(public_der, validate=True))
    if not isinstance(public, rsa.RSAPublicKey) or public.key_size != 3072:
        raise ValueError('A 3072-bit guardian RSA key is required')
    # Android Keystore uses SHA-1 for MGF1 on API 26+, explicitly separate
    # from the main OAEP SHA-256 digest. No handwritten RSA or padding.
    return base64.b64encode(public.encrypt(json.dumps(payload, separators=(',', ':')).encode(),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA256(), label=None))).decode()

if __name__ == '__main__':
    try:
        value = json.loads(sys.stdin.read(16384))
        print(json.dumps({'rsa': encrypt(value['public'], value['payload'])}))
    except Exception:
        print('Guardian encryption failed', file=sys.stderr)
        sys.exit(1)
