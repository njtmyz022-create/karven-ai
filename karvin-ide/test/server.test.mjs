import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(fileURLToPath(new URL('./api-data-',import.meta.url)));
const token='test-workspace-token-long-enough';let child,origin;
test.before(async()=>{
 const db=new DatabaseSync(`${dir}/tasks.sqlite`);db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
 db.prepare('INSERT INTO tasks VALUES (?,?)').run('restart-fixture',JSON.stringify({id:'restart-fixture',url:'https://example.com',goal:'Interrupted test',status:'running',createdAt:new Date().toISOString(),events:[]}));db.close();
 child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0',DATA_DIR:dir,WEB_AGENT_TOKEN:token,LLM_API_KEY:'',LLM_MODEL:''},stdio:['ignore','pipe','pipe']});
 origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited: ${code}`));});});
});
test.after(async()=>{child.kill('SIGTERM');await once(child,'exit');rmSync(dir,{recursive:true,force:true});});
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
test('API requires auth and reports missing configuration honestly',async()=>{
 assert.equal((await fetch(`${origin}/api/health`)).status,401);
 const health=await (await fetch(`${origin}/api/health`,{headers})).json();assert.equal(health.ready,false);
 const response=await fetch(`${origin}/api/tasks`,{method:'POST',headers,body:JSON.stringify({url:'https://example.com',goal:'Test'})});assert.equal(response.status,503);assert.match((await response.json()).error,/LLM_API_KEY/);
});
test('persistent interrupted tasks, JSON export and SSE replay',async()=>{
 const tasks=await (await fetch(`${origin}/api/tasks`,{headers})).json();assert.equal(tasks[0].status,'interrupted');
 const exportResponse=await fetch(`${origin}/api/tasks/restart-fixture/export`,{headers});assert.match(exportResponse.headers.get('content-disposition'),/attachment/);assert.equal((await exportResponse.json()).status,'interrupted');
 const events=await fetch(`${origin}/api/tasks/restart-fixture/events`,{headers});assert.equal(events.headers.get('content-type'),'text/event-stream');assert.match(await events.text(),/connected/);
 assert.equal((await fetch(`${origin}/api/tasks/restart-fixture`,{method:'DELETE',headers})).status,409);
});
test('dashboard assets serve Karvin and reject path traversal',async()=>{
 const response=await fetch(origin);assert.equal(response.status,200);assert.match(await response.text(),/KARVIN IDE/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal((await fetch(`${origin}/app.js`)).status,200);assert.equal((await fetch(`${origin}/style.css`)).status,200);assert.equal((await fetch(`${origin}/.env`)).status,404);
});
