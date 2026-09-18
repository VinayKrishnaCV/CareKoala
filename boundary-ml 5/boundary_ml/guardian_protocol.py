"""CareKoala v1: paired AES-GCM, rotating routing keys, bounded lifetime."""
import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD=b"CareKoala guardian check-in v1"
TTL=300
TEST_MESSAGE='This is a test warning from your paired CareKoala desktop. Please check in. No real concern was detected.'

def keys(pair):
    if pair.get('v') != 1: raise ValueError('Unsupported pairing version')
    key=base64.b64decode(pair['key'],validate=True)
    route=base64.b64decode(pair['route'],validate=True)
    if len(key)!=32 or len(route)!=32: raise ValueError('Invalid pairing keys')
    return key,route

def route_hash(pair, now=None):
    _,route=keys(pair)
    slot=int(time.time() if now is None else now)//TTL
    digest=hmac.new(route,f'carekoala/route/v1/{slot}'.encode(),hashlib.sha256).digest()
    return hashlib.sha1(digest).hexdigest()

def ntfy_topic(pair):
    _,route=keys(pair)
    digest=hmac.new(route,b'carekoala/ntfy/v1',hashlib.sha256).digest()
    return 'ck-'+base64.urlsafe_b64encode(digest).decode().rstrip('=')

def seal(pair, now=None, test=False):
    key,_=keys(pair)
    now=int(time.time() if now is None else now)
    payload={'v':1,'kind':'guardian_check_in','id':str(uuid.uuid4()),'issued_at':now,
             'expires_at':now+TTL,'contact_guardian':True}
    if test:
        payload.update(test=True, message=TEST_MESSAGE)
    nonce=secrets.token_bytes(12)
    data=AESGCM(key).encrypt(nonce,json.dumps(payload,separators=(',',':')).encode(),AAD)
    return json.dumps({'v':1,'nonce':base64.b64encode(nonce).decode(),
                       'ciphertext':base64.b64encode(data).decode()},separators=(',',':')).encode()

def open_alert(pair, envelope, now=None):
    if len(envelope)>4096: raise ValueError('Alert too large')
    key,_=keys(pair); outer=json.loads(envelope)
    if outer.get('v')!=1: raise ValueError('Unsupported version')
    nonce=base64.b64decode(outer['nonce'],validate=True)
    if len(nonce)!=12: raise ValueError('Invalid nonce')
    payload=json.loads(AESGCM(key).decrypt(nonce,base64.b64decode(outer['ciphertext'],validate=True),AAD))
    now=int(time.time() if now is None else now)
    issued=payload['issued_at']; expires=payload['expires_at']
    if type(issued)!=int or type(expires)!=int or not issued<=now+30 or not now<expires or not 0<expires-issued<=TTL:
        raise ValueError('Expired or invalid alert lifetime')
    if payload.get('v')!=1 or payload.get('kind')!='guardian_check_in' or payload.get('contact_guardian') is not True:
        raise ValueError('Invalid alert')
    uuid.UUID(payload['id'])
    if 'test' in payload and type(payload['test']) is not bool:
        raise ValueError('Invalid test marker')
    if payload.get('test') and payload.get('message')!=TEST_MESSAGE:
        raise ValueError('Invalid sample text')
    return payload
