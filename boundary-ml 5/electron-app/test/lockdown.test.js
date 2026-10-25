const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const p=require('../lockdown-protocol');
const {AutoMode}=require('../auto-mode');
test('only score 8+ locks; 6–7 notify; malformed scores do neither',()=>{
 assert.deepEqual([0,5,6,7,8,10,11,null,NaN,'8'].map(p.actionForScore),['none','none','notify','notify','lockdown','lockdown',null,null,null,null]);
});
test('guardian public-key import enforces RSA strength and pairing binding',()=>{
 const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
 const data={v:1,pair:'paired',spki:publicKey.export({type:'spki',format:'der'}).toString('base64')};
 const code='CKR1.'+Buffer.from(JSON.stringify(data)).toString('base64url');
 assert.equal(p.publicKey(code,'paired').spki,data.spki);
 assert.equal(p.publicKey(' \n'+code.match(/.{1,55}/g).join('\r\n\u200b')+'\n','paired').spki,data.spki);
 const corrupt='CKR1.'+Buffer.from('{"v" 1,"pair":"paired"}').toString('base64url');
 assert.throws(()=>p.publicKey(corrupt,'paired'),/incomplete or changed during copying/);
 assert.throws(()=>p.publicKey(code.slice(0,-7),'paired'),/incomplete or changed during copying/);
 assert.throws(()=>p.publicKey(code+'!','paired'),/incomplete or changed during copying/);
 assert.throws(()=>p.publicKey('CKR1.'+Buffer.from('null').toString('base64url'),'paired'),/incomplete or changed during copying/);
 assert.throws(()=>p.publicKey(code,'other'),/different pairing/);
 assert.throws(()=>p.publicKey('CK1.test','paired'));
});
test('public-key fingerprints accept copy formatting but reject short pairing fingerprints',()=>{
 const hex='0123456789abcdef'.repeat(4),expected=hex.match(/.{4}/g).join('-');
 assert.equal(p.normalizeFingerprint(hex.toUpperCase()),expected);
 assert.equal(p.normalizeFingerprint(hex.match(/.{4}/g).join(' :\n\u200b')),expected);
 assert.throws(()=>p.normalizeFingerprint('3832-3b47-6362-1a7c-ff47-d9d4'),/shorter pairing fingerprint/);
});
test('one-time key is only inside RSA, never in outer metadata; AES authenticates transport',()=>{
 const pair={key:crypto.randomBytes(32).toString('base64'),route:crypto.randomBytes(32).toString('base64')};
 const event=p.event(true),hash=p.digest(event.key);
 assert.ok(p.matches(event.key,hash));assert.equal(p.matches(p.event().key,hash),false);
 const outer=JSON.parse(p.seal(pair,event,'encrypted-rsa-value'));
 const data=Buffer.from(outer.ciphertext,'base64'),dec=crypto.createDecipheriv('aes-256-gcm',Buffer.from(pair.key,'base64'),Buffer.from(outer.nonce,'base64'));
 dec.setAAD(Buffer.from('CareKoala guardian check-in v1'));dec.setAuthTag(data.subarray(-16));
 const opened=JSON.parse(Buffer.concat([dec.update(data.subarray(0,-16)),dec.final()]));
 assert.equal(opened.key,undefined);assert.equal(opened.rsa,'encrypted-rsa-value');assert.equal(opened.id,event.id);
 assert.equal(event.expires_at-event.issued_at,300);assert.equal(event.key.length,32);
 assert.match(p.topic(pair),/^ck-[A-Za-z0-9_-]{43}$/);
});
// Same test pair as guardian-android protocol-vector.json.
const vectorPair={v:1,key:'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',route:'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8='};
function sealUnlock(pair,value,aad='CareKoala guardian unlock v1'){
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(pair.key,'base64'),nonce);cipher.setAAD(Buffer.from(aad));
 return JSON.stringify({v:1,nonce:nonce.toString('base64'),ciphertext:Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64')});
}
test('guardian unlock has its own topic and AAD; only authentic, well-formed messages open',()=>{
 assert.equal(p.unlockTopic(vectorPair),'ck-FtOFKVJCIWTJnkcqmAX2NxmBXf2KTmuQEgVTzyvsBoE');
 assert.notEqual(p.unlockTopic(vectorPair),p.topic(vectorPair));
 const value={v:1,kind:'unlock',id:crypto.randomUUID(),key:crypto.randomBytes(24).toString('base64url'),issued_at:1000,expires_at:1300};
 assert.deepEqual(p.openUnlock(vectorPair,sealUnlock(vectorPair,value)),value);
 // A desktop alert can never be reflected back as an unlock.
 assert.throws(()=>p.openUnlock(vectorPair,p.seal(vectorPair,p.event(true),'encrypted-rsa-value')));
 assert.throws(()=>p.openUnlock(vectorPair,sealUnlock(vectorPair,value,'CareKoala guardian check-in v1')));
 assert.throws(()=>p.openUnlock({key:crypto.randomBytes(32).toString('base64')},sealUnlock(vectorPair,value)));
 const outer=JSON.parse(sealUnlock(vectorPair,value)),data=Buffer.from(outer.ciphertext,'base64');data[3]^=1;
 assert.throws(()=>p.openUnlock(vectorPair,JSON.stringify({...outer,ciphertext:data.toString('base64')})));
 for(const bad of [{...value,kind:'lockdown'},{...value,key:'short'},{...value,id:'not-a-uuid'},{...value,issued_at:'1000'},{...value,v:2}])
  assert.throws(()=>p.openUnlock(vectorPair,sealUnlock(vectorPair,bad)));
 assert.throws(()=>p.openUnlock(vectorPair,'x'.repeat(5000)));
});
test('guardian unlock freshness follows the five-minute protocol window',()=>{
 const v={issued_at:1000,expires_at:1300};
 assert.ok(p.fresh(v,970));assert.ok(p.fresh(v,1299));
 assert.equal(p.fresh(v,969),false);assert.equal(p.fresh(v,1300),false);
 assert.equal(p.fresh({issued_at:1000,expires_at:1301},1100),false);
 assert.equal(p.fresh({issued_at:1000,expires_at:1000},1000),false);
});
test('desktop opens an unlock sealed by the Android Guardian implementation',()=>{
 const v=require('./fixtures/android-unlock-vector.json');
 const value=p.openUnlock(v.pair,v.envelope);
 assert.equal(value.id,v.id);assert.equal(value.key,v.key);assert.ok(p.fresh(value,v.now));
 assert.ok(p.matches(value.key,p.digest(v.key)));
});
test('escalation from 6 to 8 locks even after notification was already sent',async()=>{
 let count=0,alerts=0,locks=0,auto;
 auto=new AutoMode({capture:async()=>['screen'],ocr:async()=>({lines:[{text:String(++count)}]}),hash:s=>s,
  decide:async()=>{auto.score=count===1?6:8;return true;},alert:async()=>{alerts++;return 'sent';},lockdown:async()=>{locks++;assert.equal(auto.running,false);}});
 auto.start();await auto.pending;
 assert.equal(alerts,1);assert.equal(locks,1);assert.equal(count,2);assert.equal(auto.status,'Paused for guardian unlock');
});
