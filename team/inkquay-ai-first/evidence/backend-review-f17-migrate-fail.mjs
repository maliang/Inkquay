import { DatabaseSync } from 'node:sqlite';
const BASE='http://127.0.0.1:5821';
const j=async(p,i={})=>{const r=await fetch(BASE+p,{...i,headers:{'content-type':'application/json',...(i.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t.slice(0,200)}return{status:r.status,body:b}};
const out=(l,v)=>console.log(`\n### ${l}\n${typeof v==='string'?v:JSON.stringify(v,null,1)}`);
const db = new DatabaseSync('/tmp/pw-rev-db/studio.db');
const pid='p_legacy_novel_forced';
const now=new Date().toISOString();
db.prepare("DELETE FROM chapter_versions WHERE project_id=?").run(pid);
db.prepare("DELETE FROM chapters WHERE project_id=?").run(pid);
db.prepare("DELETE FROM characters WHERE project_id=?").run(pid);
db.prepare("DELETE FROM outline_beats WHERE project_id=?").run(pid);
db.prepare("DELETE FROM outline_acts WHERE project_id=?").run(pid);
db.prepare("DELETE FROM stages WHERE project_id=?").run(pid);
db.prepare("DELETE FROM stage_items WHERE project_id=?").run(pid);
db.prepare("DELETE FROM migrations WHERE project_id=?").run(pid);
db.prepare("DELETE FROM projects WHERE id=?").run(pid);
db.prepare("INSERT INTO projects (id,title,type,genre,description,status,total_words,goal_words,created_at,updated_at,pipeline_status,schema_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(pid,'旧长篇样例','novel','悬疑','一个不愿升职的刑警被迫接手父亲留下的悬案。','writing',0,60000,now,now,'legacy',1);
const bodies=['第一章正文：雨夜里的旧档案被翻到第七页。','第二章正文：证人改口，监控缺失了四十秒。','第三章正文：父亲的笔记本里夹着一张火车票。'];
bodies.forEach((content,i)=>{
  const cid=`${pid}_c${i+1}`;
  db.prepare("INSERT INTO chapters (id,project_id,volume,number,title,content,status,sort_order,words,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(cid,pid,'第一卷',i+1,`第${i+1}章`,content,'完成',i,Buffer.byteLength(content,'utf8'),now);
  db.prepare("INSERT INTO chapter_versions (id,project_id,chapter_id,source,title,content,words,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(`${cid}_v1`,pid,cid,'manual',`第${i+1}章`,content,Buffer.byteLength(content,'utf8'),now);
});
db.prepare("INSERT INTO characters (id,project_id,name,role,age,tags,quote,description,secret,relations,sort_order,motivation,arc,is_protagonist,locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(`${pid}_chr1`,pid,'林昭','主角','38','[]','','不愿升职的刑警','','[]',0,'查清父亲失踪真相','从逃避到直面',1,0);
db.prepare("INSERT INTO outline_acts (id,project_id,title,summary,sort_order,act_function) VALUES (?,?,?,?,?,?)")
  .run(`${pid}_act1`,pid,'第一幕 旧案重启','档案室里的第七页档案把父亲的名字带了回来。',0,'钩子');
console.log('seeded legacy novel', pid);

const before = { chapters: db.prepare('SELECT id,content FROM chapters WHERE project_id=? ORDER BY sort_order').all(pid) };
const pre = await j(`/api/projects/${pid}/migrate/precheck`);
out('precheck', {status:pre.status, body:pre.body});
const bad = await j(`/api/projects/${pid}/migrate`,{method:'POST',body:JSON.stringify({forceFail:true})});
out('migrate with forceFail=true', {status:bad.status, code:bad.body.code, msg:bad.body.message, detail:bad.body.detail});
const snapFail = await j(`/api/projects/${pid}/pipeline`);
out('snapshot after forced failure', {p1:snapFail.body.stages?.p1, next:snapFail.body.nextStep, lastError:snapFail.body.lastError, migration:snapFail.body.migration && {state:snapFail.body.migration.state, checks:(snapFail.body.migration.checks||[]).filter(c=>!c.ok), error:snapFail.body.migration.error}});
const rows = {
  stages: db.prepare('SELECT COUNT(*) n FROM stages WHERE project_id=?').get(pid).n,
  stage_items: db.prepare('SELECT COUNT(*) n FROM stage_items WHERE project_id=?').get(pid).n,
  migration: db.prepare('SELECT status,error FROM migrations WHERE project_id=? ORDER BY started_at DESC').all(pid),
  project: db.prepare('SELECT pipeline_status,stale,last_error,migration_id,schema_version FROM projects WHERE id=?').get(pid),
};
const after = db.prepare('SELECT id,content FROM chapters WHERE project_id=? ORDER BY sort_order').all(pid);
out('db after forced failure (dirty data?)', {rows, chaptersIntact: JSON.stringify(before.chapters)===JSON.stringify(after)});
const good = await j(`/api/projects/${pid}/migrate`,{method:'POST',body:JSON.stringify({})});
out('retry migrate normally', {status:good.status, code:good.body.code, state:good.body.migration&&good.body.migration.state});
const snapOk = await j(`/api/projects/${pid}/pipeline`);
out('snapshot after successful migrate', {p1:snapOk.body.stages.p1.status,p2:snapOk.body.stages.p2.status,p3:snapOk.body.stages.p3.status,p4:snapOk.body.stages.p4.status,next:snapOk.body.nextStep&&snapOk.body.nextStep.kind, lastError:snapOk.body.lastError});
const after2 = db.prepare('SELECT id,content FROM chapters WHERE project_id=? ORDER BY sort_order').all(pid);
out('chapters bytes preserved through migrate', {intact: JSON.stringify(before.chapters)===JSON.stringify(after2)});
db.close();
