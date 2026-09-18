const test=require('node:test');
const assert=require('node:assert/strict');
const {mockMode,endpoint,validateResult}=require('../analysis-mode');
test('normal and periodic analysis use real inference even with inherited mock environment',()=>{
 const previous=process.env.CAREKOALA_MOCK;process.env.CAREKOALA_MOCK='1';
 try{assert.equal(mockMode(['electron','.']),false);assert.equal(endpoint(false,false),'/analyze/real');}
 finally{if(previous===undefined)delete process.env.CAREKOALA_MOCK;else process.env.CAREKOALA_MOCK=previous;}
});
test('mock needs an explicit flag and real mode always bypasses it',()=>{
 assert.equal(mockMode(['electron','.','--mock']),true);
 assert.equal(endpoint(true,false),'/analyze/mock');assert.equal(endpoint(true,true),'/analyze/real');
});
test('unscored mock/old results cannot appear as a real safety result',()=>{
 const demo={status:'no_clear_concern',concerns:[]};
 assert.throws(()=>validateResult(demo,false),/did not return/);
 assert.equal(validateResult(demo,true).mock,true);
 assert.equal(validateResult({score:8,category:'self_harm',contact_guardian:true,status:'concern_detected'},false).score,8);
});
