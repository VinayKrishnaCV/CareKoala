"""CareKoala v2 GGUF inference. CPU-only; one short-lived server per analysis."""
import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from .trained_prompt import build_prompt, ANSWER_PREFIX, CATEGORIES, MAX_TEXT_CHARS
from .schemas import Analysis, AnalyzeRequest, Concern

ROOT=Path(__file__).resolve().parents[1]
MODEL_ROOT=Path(os.getenv('CAREKOALA_MODEL_ROOT',str(ROOT.parent/'NewModel'/'CareKoala')))
BASE=MODEL_ROOT/'models'/'base'/'Llama-3.2-1B-Instruct-Q4_K_M.gguf'
LORA=MODEL_ROOT/'models'/'carekoala-lora-v2.gguf'

def server_path():
    configured=os.getenv('CAREKOALA_LLAMA_SERVER')
    if configured:return Path(configured)
    name='llama-server.exe' if os.name=='nt' else 'llama-server'
    hits=sorted((ROOT/'runtime').rglob(name))
    return hits[-1] if hits else ROOT/'runtime'/'llama-b11036'/name

def assets():
    return {'base':str(BASE),'adapter':str(LORA),'runtime':str(server_path())}

def windows(text):
    """Training-sized windows without silently discarding later screen text."""
    result=[];current=''
    for line in (line.strip() for line in text.splitlines()):
        if not line:continue
        while len(line)>MAX_TEXT_CHARS:
            if current:result.append(current);current=''
            cut=line.rfind(' ',0,MAX_TEXT_CHARS)
            if cut<=MAX_TEXT_CHARS//2:cut=MAX_TEXT_CHARS
            result.append(line[:cut]);line=line[cut:].strip()
        if current and len(current)+1+len(line)>MAX_TEXT_CHARS:
            result.append(current);current=''
        current=current+'\n'+line if current else line
    if current:result.append(current)
    return result

def parse_score(content):
    # The completion stops before its closing brace, matching the training engine.
    value=json.loads(ANSWER_PREFIX+content+'}')
    score=value.get('score');category=value.get('category')
    if type(score) is not int or not 0<=score<=10 or category not in CATEGORIES:
        raise ValueError('Invalid trained-model score/category')
    return score,category

def level(score):
    return 'emergency' if score>=9 else 'alert' if score>=7 else 'watch' if score>=4 else 'none'

class TrainedModel:
    def __enter__(self):
        for name,value in assets().items():
            if not Path(value).is_file():raise RuntimeError(f'Missing CareKoala {name}: {value}')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));self.port=sock.getsockname()[1]
        self.http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        args=[str(server_path()),'-m',str(BASE),'--lora',str(LORA),'--host','127.0.0.1',
              '--port',str(self.port),'-c','2048','-np','1','-t','2','-ngl','0',
              '--no-webui','--cache-ram','0']
        self.proc=subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
             creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        try:
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                if self.proc.poll() is not None:raise RuntimeError('CareKoala model server exited during startup')
                try:
                    with self.http.open(f'http://127.0.0.1:{self.port}/health',timeout=2) as response:
                        if json.load(response).get('status')=='ok':return self
                except OSError:pass
                time.sleep(.2)
            raise TimeoutError('CareKoala model startup timed out')
        except BaseException:
            self.close();raise

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:self.proc.wait(5)
            except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()

    def __exit__(self,*args):self.close()

    def score_window(self,text):
        prompt=build_prompt(text).removeprefix('<|begin_of_text|>')+ANSWER_PREFIX
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}/completion',
            data=json.dumps({'prompt':prompt,'n_predict':12,'temperature':0,'n_probs':11,
                             'stop':['}'],'cache_prompt':True}).encode(),headers={'Content-Type':'application/json'})
        with self.http.open(req,timeout=60) as response:result=json.load(response)
        return parse_score(result['content'])

    def analyze(self,request:AnalyzeRequest):
        text='\n'.join(message.text for message in request.messages)
        chunks=windows(text)
        if not chunks:raise ValueError('No screen text to score')
        results=[(self.score_window(chunk),chunk) for chunk in chunks]
        (score,category),excerpt=max(results,key=lambda item:item[0][0])
        # OCR speaker estimates/boundaries are not part of this model's training prompt.
        evidence=[m.id for m in request.messages if m.text in excerpt or excerpt in m.text or
                  any(line and line in m.text for line in excerpt.splitlines())][:12]
        concerns=[]
        if score>=7:
            concerns=[Concern(type=category,evidence_ids=evidence or [request.messages[0].id],
                       explanation=f'The trained model rated this screen text {score}/10 ({category.replace("_"," ")}). A guardian check-in is recommended.')]
        return Analysis(status='concern_detected' if score>=7 else 'no_clear_concern',concerns=concerns,
            score=score,category=category,level=level(score),contact_guardian=score>=7,
            windows=len(chunks),model='CareKoala Llama-3.2-1B Q4_K_M + LoRA v2')
