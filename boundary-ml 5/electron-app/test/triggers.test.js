const {test}=require('node:test');
const assert=require('node:assert/strict');
const t=require('../triggers');
const {AutoMode}=require('../auto-mode');

test('trigger words match whole words and phrases, ignoring case, punctuation and line breaks',()=>{
 const list=['rain','loud noise','Café'];
 assert.deepEqual(t.matches(list,['It will RAIN today.']),['rain']);
 assert.deepEqual(t.matches(list,['It is raining','a drain']),[]);
 assert.deepEqual(t.matches(list,['There was a loud','noise outside!']),['loud noise']);
 assert.deepEqual(t.matches(list,['Meet at the CAFÉ']),['Café']);
 assert.deepEqual(t.matches(list,['loud, noise']),['loud noise']);
 assert.deepEqual(t.matches([],['rain']),[]);
 assert.deepEqual(t.matches(undefined,['rain']),[]);
});
test('trigger lists are trimmed, de-duplicated and bounded',()=>{
 assert.deepEqual(t.clean(['  loud   noise ','Loud noise!','','rain']),['loud noise','rain']);
 assert.throws(()=>t.clean('rain'),/Invalid/);
 assert.throws(()=>t.clean([5]),/Invalid/);
 assert.throws(()=>t.clean(['!!!']),/letter or number/);
 assert.throws(()=>t.clean(['x'.repeat(t.MAX_LENGTH+1)]),/under 100/);
 assert.throws(()=>t.clean(Array.from({length:t.MAX_TRIGGERS+1},(_,i)=>`word${i}`)),/up to 50/);
});

function run(texts,{decide=async()=>false,triggers=m=>t.matches(['rain'],m.map(x=>x.text))}={}){
 let auto,captures=0;const alerts=[];
 auto=new AutoMode({capture:async()=>{if(++captures>texts.length){auto.stop();return [];}return ['screen'];},
  ocr:async()=>({lines:[{text:texts[captures-1]}]}),hash:s=>s,decide,triggers,alert:async()=>{alerts.push(auto.status);return 'published';}});
 auto.start();
 return auto.pending.then(()=>({auto,alerts}));
}
test('a trigger word alerts the guardian once while it stays on screen, even with a low score',async()=>{
 const {auto,alerts}=await run(['rain today','more rain','sunny','rain again']);
 assert.equal(alerts.length,2);
 assert.match(alerts[0],/personal trigger word/);
 assert.doesNotMatch(alerts[0],/rain/);
 assert.equal(auto.snapshot().triggered,true);
});
test('without a trigger match the model decision alone controls alerts',async()=>{
 const {alerts}=await run(['sunny','cloudy']);
 assert.equal(alerts.length,0);
});
test('a trigger word still alerts when the model fails, then real mode pauses',async()=>{
 const {auto,alerts}=await run(['rain'],{decide:async()=>{throw Error('model offline');}});
 assert.equal(alerts.length,1);
 assert.equal(auto.running,false);
 assert.equal(auto.status,'Paused: model offline');
 assert.ok(auto.snapshot().lastPublication);
});
test('model failure without a trigger match pauses without alerting',async()=>{
 const {auto,alerts}=await run(['sunny'],{decide:async()=>{throw Error('model offline');}});
 assert.equal(alerts.length,0);
 assert.equal(auto.status,'Paused: model offline');
});
test('score 8+ still locks first; a trigger does not add a separate alert',async()=>{
 let auto,locked=0;const alerts=[];
 auto=new AutoMode({capture:async()=>['x'],ocr:async()=>({lines:[{text:'rain'}]}),hash:s=>s,
  decide:async()=>{auto.score=9;return true;},triggers:()=>['rain'],lockdown:async()=>{locked++;},alert:async()=>{alerts.push(1);return 'published';}});
 auto.start();await auto.pending;
 assert.equal(locked,1);assert.equal(alerts.length,0);
});
