const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {batches, merge, protectPipe} = require('../pipeline');
test('71 OCR items retain all evidence IDs within bounded requests', () => {
  const messages = Array.from({length:71}, (_, i) => ({id:`M${i+1}`, speaker:'other', text:'message'}));
  const windows = batches(messages);
  assert.equal(windows.length, 2);
  assert.deepEqual([...new Set(windows.flat().map(m => m.id))], messages.map(m => m.id));
  assert.ok(windows.every(w => w.length <= 40));
  assert.equal(windows[1][0].id, 'M37');
});
test('large text is preserved in bounded chunks', () => {
  const windows = batches([{id:'M1',speaker:'other',text:'a'.repeat(23000)}]);
  const unique = new Map(windows.flat().map(m => [m.id,m.text]));
  assert.equal([...unique.values()].join('').length, 23000);
  assert.ok(windows.every(w => w.reduce((n,m) => n+m.text.length,0) <= 6000));
  assert.ok(windows.flat().every(m => m.text.length <= 2000));
});
test('late-window concerns survive merging without duplicate categories', () => {
  const concern = id => ({status:'concern_detected', concerns:[{type:'credential_request', evidence_ids:[id], explanation:'Credential request'}], clarifying_question:null});
  const result = merge([{status:'no_clear_concern',concerns:[],clarifying_question:null},concern('M70'),concern('M70')]);
  assert.equal(result.status,'concern_detected');
  assert.deepEqual(result.concerns[0].evidence_ids,['M70']);
});
test('closed log pipe does not crash while unrelated errors remain visible', () => {
  const stream = new EventEmitter(); protectPipe(stream);
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error(),{code:'EPIPE'})));
  assert.throws(() => stream.emit('error', Object.assign(new Error('disk'),{code:'EIO'})), /disk/);
});

test('trained scores preserve the highest window and its guardian decision',()=>{
  const low={score:2,category:'distress',level:'none',contact_guardian:false,windows:2,status:'no_clear_concern',concerns:[]};
  const high={score:9,category:'self_harm',level:'emergency',contact_guardian:true,windows:3,status:'concern_detected',concerns:[{type:'self_harm',evidence_ids:['M70']}]};
  assert.deepEqual(merge([low,high,low]),{...high,windows:7});
  assert.throws(()=>merge([low,{status:'no_clear_concern',concerns:[]}]),/Incomplete/);
});
