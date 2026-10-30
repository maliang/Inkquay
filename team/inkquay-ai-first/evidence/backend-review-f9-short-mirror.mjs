const BASE='http://127.0.0.1:5821';
const j=async(p,i={})=>{const r=await fetch(BASE+p,{...i,headers:{'content-type':'application/json',...(i.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t.slice(0,300)}return{status:r.status,body:b}};
const out=(l,v)=>console.log(`\n### ${l}\n${typeof v==='string'?v:JSON.stringify(v,null,1)}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitJob(pid,ms=60000){const t0=Date.now();while(Date.now()-t0<ms){const s=await j(`/api/projects/${pid}/pipeline`);const job=s.body.job;if(!job||['done','failed','cancelled','interrupted'].includes(job.state))return s.body;await sleep(300)}throw new Error('timeout')}
const pid='p_legacy_short_1';
await j('/api/settings',{method:'PUT',body:JSON.stringify({defaultModel:{providerId:'mock',modelId:'mock-writer'}})});
let units=(await j(`/api/projects/${pid}/units`)).body.units;
out('units before', units.map(u=>`${u.ordinal}:${u.title}`));
for (const u of units) {
  await j(`/api/projects/${pid}/stages/p3/units/${u.id}`,{method:'PATCH',body:JSON.stringify({synopsis:'这是一段足够长的节拍大纲文字，用来说明这一节拍将会发生什么事情。',acceptDeviation:true})});
}
await j(`/api/projects/${pid}/pipeline/accept-deviation`,{method:'POST',body:JSON.stringify({accepted:true})});
const c1=await j(`/api/projects/${pid}/stages/p3/confirm`,{method:'POST',body:'{}'});
out('confirm p3 after synopsis fix', {status:c1.status, code:c1.body.code, blockers:c1.body.blockers});
// reorder: swap first two units
units=(await j(`/api/projects/${pid}/units`)).body.units;
const ids=[units[1].id,units[0].id,units[2].id];
const ro=await j(`/api/projects/${pid}/stages/p3/units/reorder`,{method:'POST',body:JSON.stringify({ids})});
out('reorder', {status:ro.status, code:ro.body.code});
units=(await j(`/api/projects/${pid}/units`)).body.units;
out('units after reorder', units.map(u=>`${u.ordinal}:${u.title}`));
const c2=await j(`/api/projects/${pid}/stages/p3/confirm`,{method:'POST',body:'{}'});
out('re-confirm p3', {status:c2.status, code:c2.body.code});
// chapters rows in legacy view
const proj=await j(`/api/projects/${pid}`);
out('legacy chapters before writing', proj.body.project.chapters.map(c=>({id:c.id,sort:c.sortOrder??c.sort_order,title:c.title,content:String(c.content).slice(0,12)})));
// write the beat that is now ordinal 0 (originally 第2节)
const target=units[0];
const w=await j(`/api/projects/${pid}/writing/start`,{method:'POST',body:JSON.stringify({mode:'single',unitId:target.id})});
out('start writing', {status:w.status, code:w.body.code, msg:w.body.message});
const snap=await waitJob(pid);
out('job', {state:snap.lastJob?.state, err:snap.lastError});
const proj2=await j(`/api/projects/${pid}`);
out('legacy chapters after writing beat「'+target.title+'」', proj2.body.project.chapters.map(c=>({sort:c.sortOrder??c.sort_order,title:c.title,content:String(c.content).slice(0,20)})));
const units2=(await j(`/api/projects/${pid}/units`)).body.units;
out('units after write', units2.map(u=>`${u.ordinal}:${u.title} words=${u.words}`));
