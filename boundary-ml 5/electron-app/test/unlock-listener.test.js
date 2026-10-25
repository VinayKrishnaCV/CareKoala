const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {listen}=require('../unlock-listener');
const topic='ck-test';
const record=(id,message,t=topic)=>JSON.stringify({id,event:'message',topic:t,message})+'\n';
async function serve(handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return server;}
function shutdown(server){server.closeAllConnections();server.close();}

test('relay listener joins split records, ignores other events, survives rejected messages and skips replays',async()=>{
 let connections=0;
 const server=await serve((req,res)=>{
  connections++;
  assert.equal(req.url,`/${topic}/json?since=5m`);
  res.writeHead(200,{'Content-Type':'application/x-ndjson'});
  res.write(JSON.stringify({event:'open',topic})+'\n');
  const first=record('m1','first');res.write(first.slice(0,10));
  setTimeout(()=>{
   res.write(first.slice(10)+JSON.stringify({event:'keepalive',topic})+'\nnot json\n'+record('m9','wrong topic','ck-other'));
   // The first stream drops; the replayed m1 on reconnect must not be delivered twice.
   if(connections===1)res.end();else res.write(record('m2','second'));
  },20);
 });
 const received=[],states=[];let listener;
 await new Promise(resolve=>{listener=listen({url:`http://127.0.0.1:${server.address().port}/${topic}/json?since=5m`,topic,retryMs:10,onState:s=>states.push(s),
  onMessage:m=>{received.push(m);if(m==='second')resolve();else throw Error('rejected by caller');}});});
 listener.stop();await listener.done;shutdown(server);
 assert.deepEqual(received,['first','second']);
 assert.equal(connections,2);assert.deepEqual(states,['listening','retrying','listening']);
});

test('relay listener reports an unavailable relay, retries, and stops promptly',async()=>{
 let requests=0;
 const server=await serve((_req,res)=>{requests++;res.writeHead(503);res.end();});
 const states=[];let listener;
 await new Promise(resolve=>{listener=listen({url:`http://127.0.0.1:${server.address().port}/${topic}/json`,topic,retryMs:5,onMessage:()=>assert.fail('no message expected'),
  onState:s=>{states.push(s);if(states.length===3)resolve();}});});
 listener.stop();await listener.done;shutdown(server);
 assert.ok(requests>=3);assert.ok(states.every(s=>s==='retrying'));
});

test('a silent relay stream is abandoned and reopened',async()=>{
 let connections=0;
 const server=await serve((_req,res)=>{connections++;res.writeHead(200);res.write('');});
 let listener;
 await new Promise(resolve=>{listener=listen({url:`http://127.0.0.1:${server.address().port}/${topic}/json`,topic,idleMs:50,retryMs:5,onMessage:()=>{},onState:()=>{if(connections>=2)resolve();}});});
 listener.stop();await listener.done;shutdown(server);
 assert.ok(connections>=2);
});
