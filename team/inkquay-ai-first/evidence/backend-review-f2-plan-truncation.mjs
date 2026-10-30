import http from 'node:http';
const BASE='http://127.0.0.1:5821';
const j=async(p,i={})=>{const r=await fetch(BASE+p,{...i,headers:{'content-type':'application/json',...(i.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t.slice(0,300)}return{status:r.status,body:b}};
const out=(l,v)=>console.log(`\n### ${l}\n${typeof v==='string'?v:JSON.stringify(v,null,1)}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitJob(pid,ms=90000){const t0=Date.now();while(Date.now()-t0<ms){const s=await j(`/api/projects/${pid}/pipeline`);const job=s.body.job;if(!job||['done','failed','cancelled','interrupted'].includes(job.state))return s.body;await sleep(300)}throw new Error('timeout')}

// fake provider that ALWAYS returns 2 valid chapters, regardless of requested batch size
const fake = http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const units=[1,2].map(i=>({title:`假第${i}章`,function:'推进',synopsis:'这是一段足够长的大纲文字，用来通过十五字校验，说明这一章将要发生什么。',minWords:2500,targetWords:3000,maxWords:4000,characters:[]}));
    const content=JSON.stringify({chapters:units});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}}));
  });
});
await new Promise(r=>fake.listen(5831,'127.0.0.1',r));

await j('/api/settings',{method:'PUT',body:JSON.stringify({defaultModel:{providerId:'mock',modelId:'mock-writer'}})});
const created=await j('/api/projects',{method:'POST',body:JSON.stringify({title:'批量多删探针',type:'novel',premise:'一个铁匠的女儿在海边醒来，发现自己能听见潮汐的名字。',targetWords:90000,start:'pipeline'})});
const pid=created.body.project.id;
await waitJob(pid);
await j(`/api/projects/${pid}/stages/p1/confirm`,{method:'POST',body:'{}'});
await j(`/api/projects/${pid}/pipeline/start`,{method:'POST',body:JSON.stringify({stage:'p2'})});
await waitJob(pid);
await j(`/api/projects/${pid}/stages/p2/confirm`,{method:'POST',body:'{}'});
await j(`/api/projects/${pid}/pipeline/start`,{method:'POST',body:JSON.stringify({stage:'p3'})});
let snap=await waitJob(pid);
let units=(await j(`/api/projects/${pid}/units`)).body.units;
out('baseline plan (mock, 3000 words/chapter goal 90000)', {units: units.length, ordinals: units.map(u=>u.ordinal), targets: [...new Set(units.map(u=>u.targetWords))]});
const beforeTitles = units.map(u=>u.title);

// switch to the truncating provider, re-run P3 (same as "按上游重排")
const prov=await j('/api/providers',{method:'POST',body:JSON.stringify({name:'截断假供应商',kind:'openai',baseUrl:'http://127.0.0.1:5831/v1',apiKey:'k',models:[{id:'trunc',name:'trunc',ctx:'8k',tags:[]}]})});
await j('/api/settings',{method:'PUT',body:JSON.stringify({defaultModel:{providerId:prov.body.provider.id,modelId:'trunc'}})});
const start=await j(`/api/projects/${pid}/pipeline/start`,{method:'POST',body:JSON.stringify({stage:'p3'})});
out('start p3 regen', {status:start.status, code:start.body.code});
snap=await waitJob(pid);
units=(await j(`/api/projects/${pid}/units`)).body.units;
out('after regen with a provider that returns 2 chapters per batch', {jobState:snap.job?.state, jobKind:snap.job?.kind, units:units.length, titles:units.map(u=>`${u.ordinal}:${u.title}`), p3:snap.stages.p3.status, lastError:snap.lastError});
out('units lost', {before:beforeTitles.length, after:units.length});
console.log('\nPID='+pid);
fake.close();
