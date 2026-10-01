import http from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runAgent,checkURL} from './agent.mjs';
import {runCoding} from './coding.mjs';
import {ProjectStore} from './projects.mjs';
import {chromium} from 'playwright';
import {zipSync,strToU8} from 'fflate';

export function createKarvinServer(config={}){
 const host=config.host||process.env.HOST||'127.0.0.1',port=config.port??Number(process.env.PORT||3000),token=config.token??process.env.WEB_AGENT_TOKEN??'';
 if(!['127.0.0.1','localhost','::1'].includes(host)&&token.length<24)throw new Error('Set WEB_AGENT_TOKEN (at least 24 characters) before exposing Karvin');
 const limit=Math.max(1,Math.min(8,Number(process.env.MAX_CONCURRENCY)||2));
 const dataDir=resolve(config.dataDir||process.env.DATA_DIR||fileURLToPath(new URL('./data/',import.meta.url)));mkdirSync(dataDir,{recursive:true});
 const settingsPath=`${dataDir}/model-settings.json`;
 const settingKeys=['LLM_API_KEY','LLM_MODEL','LLM_BASE_URL','CODE_API_KEY','CODE_MODEL','CODE_BASE_URL'];
 if(existsSync(settingsPath)){const saved=JSON.parse(readFileSync(settingsPath,'utf8'));for(const key of settingKeys)if(saved[key]&&!process.env[key])process.env[key]=saved[key];}
 const store=new ProjectStore(`${dataDir}/projects`),db=new DatabaseSync(`${dataDir}/tasks.sqlite`);
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
 const tasks=new Map(db.prepare('SELECT data FROM tasks').all().map(row=>{const task=JSON.parse(row.data);if(['queued','running','awaiting_approval'].includes(task.status)){task.status='interrupted';task.error='Server restarted before completion';delete task.pendingApproval;}return [task.id,task];}));
 const projects=new Map(db.prepare('SELECT data FROM projects').all().map(row=>{const project=JSON.parse(row.data);return [project.id,project];}));
 const save=task=>db.prepare('INSERT OR REPLACE INTO tasks VALUES (?, ?)').run(task.id,JSON.stringify(task));
 const saveProject=project=>db.prepare('INSERT OR REPLACE INTO projects VALUES (?, ?)').run(project.id,JSON.stringify(project));
 for(const task of tasks.values())save(task);
 const controllers=new Map(),streams=new Map(),approvals=new Map(),queue=[],projectLocks=new Set(),runs=new Set();let active=0,closing=false;
 const browserReady=()=>Boolean(process.env.LLM_API_KEY&&process.env.LLM_MODEL);
 const codingReady=()=>config.codingReady??Boolean((process.env.CODE_API_KEY||process.env.LLM_API_KEY)&&(process.env.CODE_MODEL||process.env.LLM_MODEL));
 const allowCommands=process.env.ENABLE_PROJECT_COMMANDS==='true';
 function event(task,payload){const item={...payload,at:new Date().toISOString(),seq:task.events.length+1};task.events.push(item);save(task);for(const response of streams.get(task.id)||[])response.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);}
 function finishStreams(id){for(const response of streams.get(id)||[])response.end();streams.delete(id);}
 function summary(task){const {events,output,...rest}=task;return {...rest,eventCount:events.length,output:output?{text:output.text,engine:output.engine,result:output.result,steps:output.steps,changedFiles:output.changes?.map(c=>c.path)}:undefined};}
 function pump(){if(closing)return;while(active<limit){const index=queue.findIndex(id=>{const task=tasks.get(id);return task.status==='queued'&&(!task.projectId||!projectLocks.has(task.projectId));});if(index===-1)return;const [id]=queue.splice(index,1),task=tasks.get(id);if(task.projectId)projectLocks.add(task.projectId);active++;const run=execute(task).finally(()=>{active--;runs.delete(run);if(task.projectId)projectLocks.delete(task.projectId);pump();});runs.add(run);}}
 function approve(task,request,signal){
  signal.throwIfAborted();const id=randomUUID();task.status='awaiting_approval';task.pendingApproval={id,...request};event(task,{type:'approval_required',status:task.status,approval:task.pendingApproval});
  return new Promise(resolve=>{let timer;const finish=(approved,reason)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);approvals.delete(id);delete task.pendingApproval;if(!signal.aborted)task.status='running';event(task,{type:'approval_resolved',approvalId:id,approved,status:task.status,reason});resolve({approved,reason});};const abort=()=>finish(false,'Task cancelled');approvals.set(id,{taskId:task.id,finish});signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(false,'Approval expired after five minutes'),300000);});
 }
 async function execute(task){
  const controller=new AbortController();controllers.set(task.id,controller);const timeout=setTimeout(()=>controller.abort(new Error('Task deadline reached')),task.kind==='coding'?1200000:300000);task.status='running';event(task,{type:'status',status:'running'});
  try{
   if(task.kind==='coding')task.output=await runCoding({task:{...task,initialMessages:tasks.get(task.parentTaskId)?.output?.messages},store,signal:controller.signal,emit:payload=>event(task,payload),approve:(request,signal)=>approve(task,request,signal),model:config.codeModel,allowCommands,browserRun:browserReady()?input=>runAgent({...input,maxSteps:20,chromium}):undefined});
   else task.output=await runAgent({url:task.url,goal:task.goal,maxSteps:task.maxSteps,signal:controller.signal,emit:payload=>event(task,payload),chromium});
   controller.signal.throwIfAborted();task.status='completed';
  }catch(error){task.status=controller.signal.aborted&&task.status==='cancelled'?'cancelled':'failed';task.error=controller.signal.aborted?String(controller.signal.reason?.message||'Cancelled'):String(error.message);if(error.changes)task.output={changes:error.changes,checks:error.checks,engine:'@cline/sdk'};}
  finally{clearTimeout(timeout);controllers.delete(task.id);task.finishedAt=new Date().toISOString();event(task,{type:'status',status:task.status,error:task.error,output:task.output?{...task.output,messages:undefined}:undefined});finishStreams(task.id);}
 }
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1200000)throw new Error('Request body too large');}return JSON.parse(data);}
 function authorized(req,u){if(!token)return true;const supplied=req.headers.authorization?.replace(/^Bearer /,'')||u.searchParams.get('token')||'';const a=Buffer.from(supplied),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);}
 const busyProject=id=>[...tasks.values()].some(t=>t.projectId===id&&['running','awaiting_approval','queued'].includes(t.status));
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/api/')){
    if(!authorized(req,u))return json(res,401,{error:'Authentication required'});
    if(['POST','PUT','DELETE'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Origin rejected'});
    if(u.pathname==='/api/settings'&&req.method==='POST'){
     if(active||queue.length)return json(res,409,{error:'Finish active tasks before changing models'});
     const input=await body(req),saved=existsSync(settingsPath)?JSON.parse(readFileSync(settingsPath,'utf8')):{};
     for(const key of settingKeys){if(input[key]===undefined||input[key]==='')continue;if(typeof input[key]!=='string'||input[key].length>2000)throw new Error('Invalid model setting');if(key.endsWith('BASE_URL'))await checkURL(input[key]);saved[key]=input[key].trim();}
     writeFileSync(settingsPath,JSON.stringify(saved),{mode:0o600});for(const key of settingKeys)if(saved[key])process.env[key]=saved[key];
     return json(res,200,{saved:true});
    }
    if(u.pathname==='/api/health'&&req.method==='GET')return json(res,200,{name:'Karvin',accessMode:config.accessMode||'token',ready:browserReady(),browserReady:browserReady(),codingReady:codingReady(),codingEngine:'@cline/sdk',codingModel:process.env.CODE_MODEL||process.env.LLM_MODEL||null,model:process.env.LLM_MODEL||null,commandsEnabled:allowCommands,concurrency:limit,active});
    if(u.pathname==='/api/projects'&&req.method==='GET')return json(res,200,[...projects.values()]);
    if(u.pathname==='/api/projects'&&req.method==='POST'){
     const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw new Error('Project name must be 1–80 characters');
     const project={id:randomUUID(),name:input.name.trim(),createdAt:new Date().toISOString()};await store.create(project.id);projects.set(project.id,project);saveProject(project);return json(res,201,project);
    }
    const projectMatch=u.pathname.match(/^\/api\/projects\/([\w-]+)\/(files|file|export)$/);
    if(projectMatch){
     const id=projectMatch[1];if(!projects.has(id))return json(res,404,{error:'Project not found'});
     if(req.method==='GET'&&projectMatch[2]==='files')return json(res,200,await store.list(id));
     if(req.method==='GET'&&projectMatch[2]==='export'){if(busyProject(id))return json(res,409,{error:'Wait for the project task to finish before exporting'});const files=await store.list(id);let bytes=0;const contents=Object.create(null);for(const file of files){bytes+=file.bytes;if(bytes>10000000)throw new Error('Project export exceeds 10 MB');contents[file.path]=strToU8(await store.read(id,file.path));}const archive=zipSync(contents);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="karvin-project-${id}.zip"`});res.end(archive);return;}
     if(req.method==='GET'&&projectMatch[2]==='file')return json(res,200,{path:u.searchParams.get('path'),content:await store.read(id,u.searchParams.get('path'))});
     if(req.method==='PUT'&&projectMatch[2]==='file'){if(busyProject(id))return json(res,409,{error:'Wait for this project’s active or queued task to finish before editing'});const input=await body(req);return json(res,200,await store.write(id,input.path,input.content));}
     return json(res,405,{error:'Method not allowed'});
    }
    if(u.pathname==='/api/tasks'&&req.method==='GET')return json(res,200,[...tasks.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(summary));
    if(u.pathname==='/api/tasks'&&req.method==='POST'){
     if(queue.length>=100)return json(res,429,{error:'Task queue is full'});
     const input=await body(req),kind=input.kind||'browser';if(!['browser','coding'].includes(kind))throw new Error('Task kind must be browser or coding');
     if(kind==='browser'&&!browserReady())return json(res,503,{error:'Set LLM_API_KEY and LLM_MODEL on the server to run browser tasks'});
     if(kind==='coding'&&!codingReady())return json(res,503,{error:'Configure CODE_API_KEY and CODE_MODEL, or reuse LLM_API_KEY and LLM_MODEL for coding tasks'});
     if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>8000)throw new Error('Goal must be 1–8000 characters');
     const maxSteps=input.maxSteps??30;if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>60)throw new Error('maxSteps must be an integer from 1 to 60');
     if(kind==='browser')await checkURL(input.url);
     else{if(!projects.has(input.projectId))throw new Error('Select an existing project');if(!['plan','act'].includes(input.mode||'plan'))throw new Error('Mode must be plan or act');if(input.parentTaskId){const parent=tasks.get(input.parentTaskId);if(!parent||parent.projectId!==input.projectId||parent.kind!=='coding'||parent.status!=='completed')throw new Error('Follow-up must reference a completed task in this project');}}
     const task={id:randomUUID(),kind,...(kind==='browser'?{url:input.url}:{projectId:input.projectId,projectName:projects.get(input.projectId).name,mode:input.mode||'plan',parentTaskId:input.parentTaskId}),goal:input.goal.trim(),maxSteps,status:'queued',createdAt:new Date().toISOString(),events:[]};tasks.set(task.id,task);event(task,{type:'status',status:'queued'});queue.push(task.id);json(res,202,summary(task));pump();return;
    }
    const match=u.pathname.match(/^\/api\/tasks\/([\w-]+)(?:\/(events|export|approval|undo))?$/);if(!match)return json(res,404,{error:'Endpoint not found'});
    const task=tasks.get(match[1]);if(!task)return json(res,404,{error:'Task not found'});
    if(req.method==='POST'&&match[2]==='approval'){
     const input=await body(req),pending=approvals.get(input.id);if(!pending||pending.taskId!==task.id)return json(res,409,{error:'Approval is no longer pending'});if(typeof input.approved!=='boolean')throw new Error('approved must be true or false');pending.finish(input.approved,input.approved?'Approved by user':'Rejected by user');return json(res,200,summary(task));
    }
    if(req.method==='POST'&&match[2]==='undo'){
     if(task.kind!=='coding'||!task.output?.changes?.length||task.undoneAt)throw new Error('This task has no changes available to undo');if(busyProject(task.projectId))return json(res,409,{error:'Project has an active task'});
     for(const change of task.output.changes)if(await store.optionalRead(task.projectId,change.path)!==change.after)return json(res,409,{error:`${change.path} changed after this task; undo stopped to preserve later edits`});
     for(const change of task.output.changes){if(change.before===null)await store.remove(task.projectId,change.path);else await store.write(task.projectId,change.path,change.before);}task.undoneAt=new Date().toISOString();event(task,{type:'changes_undone'});return json(res,200,summary(task));
    }
    if(req.method==='DELETE'&&!match[2]){if(!['queued','running','awaiting_approval'].includes(task.status))return json(res,409,{error:'Task has already finished'});task.status='cancelled';const queuedIndex=queue.indexOf(task.id);if(queuedIndex>=0)queue.splice(queuedIndex,1);controllers.get(task.id)?.abort(new Error('Cancelled by user'));event(task,{type:'status',status:'cancelled'});finishStreams(task.id);return json(res,200,summary(task));}
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    if(match[2]==='events'){
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const cursor=Number(req.headers['last-event-id']||0);for(const item of task.events)if(item.seq>cursor)res.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);
     if(!['queued','running','awaiting_approval'].includes(task.status)){res.end();return;}
     if(!streams.has(task.id))streams.set(task.id,new Set());streams.get(task.id).add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(heartbeat);streams.get(task.id)?.delete(res);});return;
    }
    if(match[2]==='export')res.setHeader('Content-Disposition',`attachment; filename="karvin-${task.id}.json"`);
    return json(res,200,task);
   }
   const files={'/':['landing.html','text/html'],'/workspace':['index.html','text/html'],'/landing.css':['landing.css','text/css'],'/landing.js':['landing.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};const file=files[u.pathname];if(!file)return json(res,404,{error:'Not found'});
   res.writeHead(200,{'Content-Type':file[1],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(readFileSync(new URL(`./public/${file[0]}`,import.meta.url)));
  }catch(error){if(!res.headersSent)json(res,error.code==='ENOENT'?404:400,{error:error.message});else res.end();}
 });
 async function close(){closing=true;for(const controller of controllers.values())controller.abort(new Error('Server shutting down'));for(const id of streams.keys())finishStreams(id);await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...runs]);db.close();}
 return {server,host,port,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const app=createKarvinServer();app.server.listen(app.port,app.host,()=>console.log(`Karvin: http://${app.host}:${app.server.address().port}`));
 const shutdown=()=>{void app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}

