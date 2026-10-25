const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const renderer=path.resolve(__dirname,'..','renderer');

test('lockdown overlay keeps its unlock controls and adds a local fun-facts card',()=>{
 const html=fs.readFileSync(path.join(renderer,'lockdown.html'),'utf8');
 for(const id of ['reason','remote','unlock','key','result','delivery','resend'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/<script src="lockdown-renderer.js"><\/script>/);
 assert.match(html,/id="fact"[^>]*aria-live="polite"/);
 assert.match(html,/<script src="fun-facts.js"><\/script>/);
 assert.match(html,/script-src 'self'/);
 assert.doesNotMatch(fs.readFileSync(path.join(renderer,'fun-facts.js'),'utf8'),/https?:|fetch\(|XMLHttpRequest|window\.lockdown/);
});

test('fun facts show every fact once before repeating',()=>{
 const elements={fact:{textContent:''},'fact-count':{textContent:''},'next-fact':{listeners:[],addEventListener(type,fn){this.listeners.push(fn);}}};
 const document={getElementById:id=>elements[id]||null};
 vm.runInNewContext(fs.readFileSync(path.join(renderer,'fun-facts.js'),'utf8'),{document,Math});
 const total=Number(elements['fact-count'].textContent.match(/of (\d+)/)[1]);
 assert.ok(total>=30);
 const seen=new Set([elements.fact.textContent]);
 for(let i=1;i<total;i++){elements['next-fact'].listeners[0]();seen.add(elements.fact.textContent);}
 assert.equal(seen.size,total);
 assert.equal(elements['fact-count'].textContent,`Fact ${total} of ${total}`);
 elements['next-fact'].listeners[0]();
 assert.equal(elements['fact-count'].textContent,`Fact 1 of ${total}`);
 for(const fact of seen)assert.ok(fact.length>10 && fact.length<160,fact);
});
