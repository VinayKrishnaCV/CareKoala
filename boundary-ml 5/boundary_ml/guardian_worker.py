"""Publish authenticated ciphertext to ntfy; never log pairing or topic."""
import json
import os
import sys
import threading
import urllib.request
from .guardian_protocol import seal, ntfy_topic

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def publish(pair, opener=None, test=False):
    topic=ntfy_topic(pair)
    request=urllib.request.Request('https://ntfy.sh/'+topic, data=seal(pair,test=test),
        headers={'Content-Type':'text/plain; charset=utf-8','User-Agent':'CareKoala/0.1.4','X-Firebase':'no'}, method='POST')
    opener=opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request,timeout=25) as response:
            if response.status!=200: raise ValueError('Publish rejected')
            raw=response.read(8193)
            if len(raw)>8192: raise ValueError('Oversized relay response')
            result=json.loads(raw)
            if result.get('event')!='message' or result.get('topic')!=topic or not result.get('id'):
                raise ValueError('Invalid relay response')
        return {'status':'published','receipt_confirmed':False,'transport':'ntfy'}
    except Exception:
        raise RuntimeError('Encrypted ntfy publication failed or timed out. Check internet access and try again.') from None

def main():
    # A stalled network request cannot hold the app forever.
    watchdog=threading.Timer(40,lambda:os._exit(2));watchdog.daemon=True;watchdog.start()
    try:
        pair=json.loads(sys.stdin.read(4096))
        print(json.dumps(publish(pair,test='--test' in sys.argv[1:])))
    except Exception:
        print('Encrypted guardian publication unavailable',file=sys.stderr)
        raise SystemExit(2)
    finally: watchdog.cancel()

if __name__=='__main__':main()
