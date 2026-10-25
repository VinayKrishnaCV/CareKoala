const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const p=require('../enrollment-protocol');
const {Enrollment}=require('../enrollment');
const fingerprint=pair=>crypto.createHash('sha256').update(Buffer.from(pair.key,'base64')).update(Buffer.from(pair.route,'base64')).digest('hex').slice(0,24).match(/.{4}/g).join('-');
test('single invitation round-trips, accepts typed formatting, detects changes and keeps channels separate',()=>{
 for(let i=0;i<50;i++){const secret=crypto.randomBytes(16),code=p.invitation(secret),value=p.parse(code);assert.deepEqual(value.secret,secret);assert.equal(p.parse(code.toLowerCase().replaceAll('-',' \n')).pair.key,value.pair.key);}
 const code=p.invitation(Buffer.alloc(16));assert.equal(p.parse(code.replaceAll('0','O')).pair.key,p.parse(code).pair.key);
 assert.throws(()=>p.parse(code.slice(0,-1)+(code.endsWith('A')?'B':'A')),/typing error/);
 assert.throws(()=>p.parse('123456'),/complete CK2/);
 assert.notEqual(p.channel(p.parse(code).pair),require('../lockdown-protocol').topic(p.parse(code).pair));
});
test('enrollment messages authenticate direction, payload and lifetime',()=>{
 const pair=p.parse(p.invitation()).pair,now=1000,payload={v:2,kind:'guardian_offer',issued_at:now,expires_at:now+600};
 const sealed=p.seal(pair,payload,'offer');assert.deepEqual(p.open(pair,sealed,'offer',now),payload);
 assert.throws(()=>p.open(pair,sealed,'ack',now));assert.throws(()=>p.open(pair,sealed,'offer',now+600));assert.throws(()=>p.open(pair,sealed,'offer',now-31));
 const other=p.parse(p.invitation()).pair;assert.throws(()=>p.open(other,sealed,'offer',now));
 const changed=JSON.parse(sealed);changed.ciphertext=Buffer.alloc(60).toString('base64');assert.throws(()=>p.open(pair,JSON.stringify(changed),'offer',now));
});
test('automatic enrollment waits for approval, keeps old pairing on cancel, and RSA-wraps independent final keys',async()=>{
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:3072}),publicDer=key.publicKey.export({format:'der',type:'spki'}).toString('base64');
 let committed=null,sent=[],encrypted=[],stopped=0;
 const settings={fingerprint,installPair:async(...args)=>{committed=args;}};
 const manager=new Enrollment({settings,encodeQr:async code=>'data:image/png;base64,test',encrypt:async(_pub,bundle)=>{encrypted.push(bundle);return 'RSA-CIPHERTEXT';},publish:async(topic,body)=>sent.push(body),subscribe:()=>({stop(){stopped++;}})});
 try{
  const start=await manager.start('Alex’s PC'),bootstrap=p.parse(start.code).pair,now=Math.floor(Date.now()/1000),id=crypto.randomUUID();
  const publicCode='CKR1.'+Buffer.from(JSON.stringify({v:1,pair:fingerprint(bootstrap),spki:publicDer})).toString('base64url');
  const offer=p.seal(bootstrap,{v:2,kind:'guardian_offer',id,guardian:'Sam',public_code:publicCode,issued_at:now,expires_at:now+300},'offer');
  await manager.receive(manager.session,offer);assert.equal(committed,null);assert.equal(manager.snapshot().phase,'confirm');
  await manager.approve();assert.ok(committed);assert.notEqual(committed[0].key,bootstrap.key);assert.notEqual(committed[0].route,bootstrap.route);assert.equal(manager.snapshot().code,null);
  const ack=p.open(bootstrap,sent[0],'ack');assert.equal(ack.id,id);assert.equal(ack.rsa,'RSA-CIPHERTEXT');assert.equal(ack.pair,undefined);assert.deepEqual(encrypted[0].pair,committed[0]);
  const count=sent.length;await manager.receive(manager.session,offer);assert.equal(sent.length,count+1,'Lost acknowledgements can be retried without replacing keys');
  const persisted=committed;await manager.start('Another PC');manager.cancel();assert.equal(committed,persisted);assert.ok(stopped>0);
 }finally{manager.cancel();}
});
