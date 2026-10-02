import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,chmod,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runCoding} from '../coding.mjs';
import {ProjectStore} from '../projects.mjs';
import {supportsUserIsolation} from '../ide-workers.mjs';
import {createKarvinServer} from '../server.mjs';
import {createCodeModel,toChatMessages} from '../code-model.mjs';
import http from 'node:http';
let root,store,id;
test.before(async()=>{root=await mkdtemp(fileURLToPath(new URL('./coding-data-',import.meta.url)));store=new ProjectStore(`${root}/projects`);id=randomUUID();await store.create(id);});
test.after(()=>rm(root,{recursive:true,force:true}));
function scriptedModel(calls){let index=0;return {async *stream(request){const item=calls[index++];assert.ok(item,'Unexpected extra model turn');assert.ok(request.tools.some(t=>t.name==='complete_task'));yield {type:'tool-call-delta',index:0,toolCallId:`call-${index}`,toolName:item.tool,input:item.input};yield {type:'finish',reason:'tool-calls'};}};}
const task=(mode='act')=>({id:randomUUID(),projectId:id,mode,goal:'Write greeting file',maxSteps:5});
test('Karvin coding assistant executes an approved edit and retains a reversible change',async()=>{
 const events=[];let approvals=0;
 const result=await runCoding({task:task(),store,signal:new AbortController().signal,emit:e=>events.push(e),approve:async request=>{approvals++;assert.equal(request.preview.before,null);assert.equal(await store.optionalRead(id,'hello.txt'),null);return {approved:true};},model:scriptedModel([{tool:'write_file',input:{path:'hello.txt',content:'Hello Karvin'}},{tool:'complete_task',input:{summary:'Created greeting; tests were not run.'}}])});
 assert.equal(await store.read(id,'hello.txt'),'Hello Karvin');assert.equal(approvals,1);assert.equal(result.engine,'karvin-coding-agent');assert.equal(result.changes[0].before,null);assert.equal(result.changes[0].after,'Hello Karvin');assert.ok(events.some(e=>e.type==='file_changed'));assert.ok(result.messages.some(m=>m.content.some(p=>p.type==='tool-result')));
});
test('Karvin coding assistant rejects edits without approval',async()=>{
 const result=await runCoding({task:task(),store,signal:new AbortController().signal,emit:()=>{},approve:async()=>({approved:false,reason:'Rejected by user'}),model:scriptedModel([{tool:'write_file',input:{path:'rejected.txt',content:'Should never appear'}},{tool:'complete_task',input:{summary:'No files changed.'}}])});
 assert.equal(await store.optionalRead(id,'rejected.txt'),null);assert.equal(result.changes.length,0);
});
test('Plan mode does not offer edit or command tools to the coding assistant',async()=>{
 const model={async *stream(request){assert.equal(request.tools.some(t=>['write_file','run_check'].includes(t.name)),false);yield {type:'tool-call-delta',index:0,toolCallId:'plan-complete',toolName:'complete_task',input:{summary:'Plan: inspect then build.'}};yield {type:'finish',reason:'tool-calls'};}};
 const result=await runCoding({task:task('plan'),store,signal:new AbortController().signal,emit:()=>{},approve:async()=>assert.fail('Plan requested approval'),model,allowCommands:true});assert.equal(result.mode,'plan');assert.equal(result.changes.length,0);
});
test('project tools reject traversal, credentials and symlink escapes',async()=>{
 await assert.rejects(store.write(id,'../outside.txt','x'),/Invalid/);await assert.rejects(store.write(id,'.env','secret'),/protected/);await symlink(root,`${store.directory(id)}/escape`);await assert.rejects(store.write(id,'escape/outside.txt','x'),/Symbolic/);
});
test('cancellation while the coding assistant is waiting for approval makes no edits',async()=>{
 const controller=new AbortController();
 const promise=runCoding({task:task(),store,signal:controller.signal,emit:()=>{},approve:async(_,signal)=>{setTimeout(()=>controller.abort(new Error('cancelled test')),20);return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({approved:false}),{once:true}));},model:scriptedModel([{tool:'write_file',input:{path:'cancel.txt',content:'x'}}])});
 await assert.rejects(promise,/cancelled test/);assert.equal(await store.optionalRead(id,'cancel.txt'),null);
});
test('Karvin API runs approved coding with export, undo, and project locking',async()=>{
 const apiDir=`${root}/api`;const model={async *stream(request){const count=request.messages.flatMap(m=>m.content).filter(p=>p.type==='tool-result').length;yield {type:'tool-call-delta',index:0,toolCallId:`api-${count}`,toolName:count?'complete_task':'write_file',input:count?{summary:'Created file.'}:{path:'app.js',content:'console.log("Karvin")'}};yield {type:'finish',reason:'tool-calls'};}};
 const app=createKarvinServer({port:0,dataDir:apiDir,codingReady:true,codeModel:model,token:'test-token-for-karvin-long-enough'});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:'Bearer test-token-for-karvin-long-enough','Content-Type':'application/json'};
 const request=async(path,method='GET',value)=>{const response=await fetch(`${base}${path}`,{method,headers,body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json()};};
 try {
  const project=(await request('/api/projects','POST',{name:'Karvin test project'})).data;
  const created=await request('/api/tasks','POST',{kind:'coding',projectId:project.id,mode:'act',goal:'Create app.js'});assert.equal(created.status,202);
  let mission;for(let n=0;n<50;n++){mission=(await request(`/api/tasks/${created.data.id}`)).data;if(mission.pendingApproval)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(mission.status,'awaiting_approval');assert.equal((await request(`/api/projects/${project.id}/file?path=app.js`)).status,404);
  const queued=await request('/api/tasks','POST',{kind:'coding',projectId:project.id,mode:'act',goal:'Second task in same project'});assert.equal((await request(`/api/tasks/${queued.data.id}`)).data.status,'queued');assert.equal((await request(`/api/tasks/${queued.data.id}`,'DELETE')).data.status,'cancelled');
  assert.equal((await request(`/api/projects/${project.id}/file`,'PUT',{path:'app.js',content:'overwrite'})).status,409);
  assert.equal((await request(`/api/tasks/${mission.id}/approval`,'POST',{id:'wrong',approved:true})).status,409);
  await request(`/api/tasks/${mission.id}/approval`,'POST',{id:mission.pendingApproval.id,approved:true});
  for(let n=0;n<50;n++){mission=(await request(`/api/tasks/${mission.id}`)).data;if(mission.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(mission.status,'completed');assert.equal(mission.output.engine,'karvin-coding-agent');assert.equal((await request(`/api/projects/${project.id}/file?path=app.js`)).data.content,'console.log("Karvin")');
  await request(`/api/projects/${project.id}/file`,'PUT',{path:'app.js',content:'Later user edit'});assert.equal((await request(`/api/tasks/${mission.id}/undo`,'POST',{})).status,409);assert.equal((await request(`/api/projects/${project.id}/file?path=app.js`)).data.content,'Later user edit');await request(`/api/projects/${project.id}/file`,'PUT',{path:'app.js',content:'console.log("Karvin")'});
  assert.equal((await request(`/api/tasks/${mission.id}/undo`,'POST',{})).status,200);assert.equal((await request(`/api/projects/${project.id}/file?path=app.js`)).status,404);
 }finally{await app.close();}
});
test('Karvin coding uses the streamed OpenAI-compatible adapter through HTTP',async()=>{
 let turn=0;const provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);assert.equal(request.stream,true);assert.ok(request.tools.some(t=>t.function.name==='complete_task'));turn++;res.setHeader('Content-Type','text/event-stream');const call=turn===1?{name:'list_files',arguments:'{}'}:{name:'complete_task',arguments:JSON.stringify({summary:'Inspected project files.'})};res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:`http-${turn}`,type:'function',function:call}]},finish_reason:null}]})}\n\n`);res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{const result=await runCoding({task:task('plan'),store,signal:new AbortController().signal,emit:()=>{},approve:async()=>({approved:false}),model:createCodeModel({apiKey:'fixture',model:'fixture',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`})});assert.equal(result.engine,'karvin-coding-agent');assert.equal(turn,2);}finally{await new Promise(resolve=>provider.close(resolve));}
});
test('Karvin coding runs an approved Node test and records its actual result',async()=>{
 const checkId=randomUUID();await store.create(checkId);await store.write(checkId,'example.test.mjs',"import test from 'node:test'; import assert from 'node:assert/strict'; test('worker environment',()=>{assert.equal(process.env.LLM_API_KEY,undefined);assert.equal(2+2,4);});");
 let requests=0;const result=await runCoding({task:{...task(),projectId:checkId},store,signal:new AbortController().signal,emit:()=>{},approve:async request=>{requests++;assert.equal(request.tool,'run_check');return {approved:true};},allowCommands:true,model:scriptedModel([{tool:'run_check',input:{check:'node_test'}},{tool:'complete_task',input:{summary:'Node fixture check completed.'}}])});
 assert.equal(requests,1);assert.equal(result.checks[0].exitCode,0);assert.match(result.checks[0].output,/worker environment/);
});

test('approved account checks run under the tenant UID with a clean environment',async t=>{
 if(process.getuid?.()!==0)return t.skip('This isolation check requires root to switch to a fixture UID');
 const tenantRoot=await mkdtemp(fileURLToPath(new URL('./tenant-check-',import.meta.url)));await chmod(tenantRoot,0o711);
 try{
  if(!supportsUserIsolation(tenantRoot))return t.skip('This host does not permit per-user filesystem ownership');
  const tenantUid=60000,tenantStore=new ProjectStore(`${tenantRoot}/projects`,{uid:tenantUid}),tenantProject=randomUUID(),home=`${tenantRoot}/home`;
  await tenantStore.create(tenantProject);await mkdir(home,{mode:0o700});await tenantStore.own(home,0o700);
  await tenantStore.write(tenantProject,'uid.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';test('tenant identity and clean env',()=>{assert.equal(process.getuid(),60000);assert.equal(process.env.LLM_API_KEY,undefined);});");
  const result=await runCoding({task:{...task(),projectId:tenantProject},store:tenantStore,signal:new AbortController().signal,emit:()=>{},approve:async()=>({approved:true}),allowCommands:true,workerUid:tenantUid,workerGid:tenantUid,workerHome:home,model:scriptedModel([{tool:'run_check',input:{check:'node_test'}},{tool:'complete_task',input:{summary:'Tenant-scoped check completed.'}}])});
  assert.equal(result.checks[0].exitCode,0);assert.match(result.checks[0].output,/tenant identity and clean env/);
 }finally{await rm(tenantRoot,{recursive:true,force:true});}
});
