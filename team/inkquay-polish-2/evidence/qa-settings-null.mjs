import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['--import','tsx','src/server/index.ts'], { cwd:'/Users/maliang/Documents/develop/maliang/私家写手/software', env:{...process.env, PORT:'8796', PW_DATA_DIR:'/tmp/qa-oldlib'}, stdio:'ignore' });
const base='http://127.0.0.1:8796';
for (let i=0;i<60;i++){ try{ if((await fetch(base+'/api/health')).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
const get = async () => (await (await fetch(base+'/api/settings')).json()).settings.defaultModel;
console.log('before', JSON.stringify(await get()));
await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultModel:null})});
console.log('after PUT null', JSON.stringify(await get()));
await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultModel:{providerId:'mock',modelId:'mock-writer'}})});
console.log('after PUT mock', JSON.stringify(await get()));
await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultModel:null})});
console.log('after PUT null again', JSON.stringify(await get()));
server.kill('SIGKILL');
