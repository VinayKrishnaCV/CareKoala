const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AutoMode}=require('../auto-mode');
test('completion-driven stages do not overlap, unchanged text skips model, positive streak sends once',async()=>{
 let auto,captures=0,ocrActive=false,decisions=0,alerts=0;
 const texts=['same','same','changed','negative'];
 auto=new AutoMode({capture:async()=>{captures++;return ['screen'];},ocr:async()=>{assert.equal(ocrActive,false);ocrActive=true;await new Promise(r=>setImmediate(r));ocrActive=false;return {lines:[{text:texts[captures-1]}]};},hash:s=>s,
 decide:async()=>{assert.equal(ocrActive,false);decisions++;return captures<4;},alert:async()=>{alerts++;return 'published';},changed:()=>{if(auto.status==='Guardian check-in recommended: No')auto.stop();}});
 auto.start();await auto.pending;
 assert.equal(captures,4);assert.equal(decisions,3);assert.equal(alerts,1);
});
test('stop during OCR prevents inference and sending',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r);const hold=new Promise(r=>release=r);
 let model=0;const auto=new AutoMode({capture:async()=>['x'],ocr:async()=>{entered();await hold;return {lines:[{text:'otp'}]};},hash:s=>s,decide:async()=>{model++;return true;},alert:async()=>{throw Error('must not send');}});
 auto.start();await ready;auto.stop();assert.throws(()=>auto.start(),/finishing/);release();await auto.pending;assert.equal(model,0);
});
test('transport failure pauses instead of repeatedly publishing',async()=>{
 const auto=new AutoMode({capture:async()=>['x'],ocr:async()=>({lines:[{text:'otp'}]}),hash:s=>s,decide:async()=>true,alert:async()=>{throw Error('offline');}});
 auto.start();await auto.pending;assert.equal(auto.running,false);assert.equal(auto.status,'Paused: offline');
 assert.equal(auto.snapshot().error,'offline');assert.equal(auto.snapshot().recognizedItems,1);
 assert.ok(auto.snapshot().lastCheck);assert.equal(auto.snapshot().lastPublication,null);
});

test('real mode retains progress and publication after the next capture starts',async()=>{
 let auto,captures=0;
 auto=new AutoMode({capture:async()=>{if(++captures===2)auto.stop();return ['x'];},ocr:async()=>({lines:[{text:'sample'}]}),hash:s=>s,decide:async()=>true,alert:async()=>'published'});
 auto.start();await auto.pending;
 const snapshot=auto.snapshot();assert.equal(snapshot.cycles,1);assert.equal(snapshot.recognizedItems,1);
 assert.ok(snapshot.lastPublication);assert.ok(snapshot.lastCheck);
});
