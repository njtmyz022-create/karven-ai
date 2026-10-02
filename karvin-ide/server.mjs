import http from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,chownSync,chmodSync,readdirSync,lstatSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runAgent,checkURL} from './agent.mjs';
import {runCoding} from './coding.mjs';
import {ProjectStore} from './projects.mjs';
import {AccountStore} from './accounts.mjs';
import {supportsUserIsolation} from './ide-workers.mjs';
import {chromium} from 'playwright';
import {zipSync,strToU8} from 'fflate';

const SETTING_KEYS=['LLM_API_KEY','LLM_MODEL','LLM_BASE_URL','CODE_API_KEY','CODE_MODEL','CODE_BASE_URL','CODE_PROVIDER_ID'];
const PUBLIC_ASSETS={
 '/login':['auth.html','text/html'],
 '/auth.js':['auth.js','text/javascript'],
 '/auth.css':['auth.css','text/css'],
};
function ownTree(path,uid){const stat=lstatSync(path);chownSync(path,uid,uid);chmodSync(path,stat.isDirectory()?0o700:0o600);if(stat.isDirectory())for(const name of readdirSync(path))ownTree(join(path,name),uid);}

function safeEqual(left,right){const a=Buffer.from(left||''),b=Buffer.from(right||'');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);}
function modelStatus(settings){return {
 browserReady:Boolean(settings.LLM_API_KEY&&settings.LLM_MODEL),codingReady:Boolean((settings.CODE_API_KEY||settings.LLM_API_KEY)&&(settings.CODE_MODEL||settings.LLM_MODEL)),
 model:settings.LLM_MODEL||null,codingModel:settings.CODE_MODEL||settings.LLM_MODEL||null,
 browserKeyConfigured:Boolean(settings.LLM_API_KEY),codingKeyConfigured:Boolean(settings.CODE_API_KEY||settings.LLM_API_KEY),
 };
}

export function createKarvinServer(config={}){
 process.umask(0o077);
 const host=config.host||process.env.HOST||'127.0.0.1';
 const port=config.port??Number(process.env.PORT||3000);
 const token=config.token??process.env.WEB_AGENT_TOKEN??'';
 const authMode=config.authMode||'token';
 const internalToken=config.internalToken??process.env.WEB_AGENT_TOKEN??'';
 const ownerEmail=(config.ownerEmail??process.env.OWNER_EMAIL??'').trim().toLowerCase();
 const allowSignup=config.allowSignup??(process.env.ALLOW_SIGNUP==='true');
 const allowOwnerBootstrap=Boolean(config.allowOwnerBootstrap);
 if(!['token','accounts'].includes(authMode))throw new Error('authMode must be token or accounts');
 if(!['127.0.0.1','localhost','::1'].includes(host)&&authMode==='token'&&token.length<24)throw new Error('Set WEB_AGENT_TOKEN (at least 24 characters) before exposing token mode');
 const limit=Math.max(1,Math.min(8,Number(process.env.MAX_CONCURRENCY)||2));
 const dataDir=resolve(config.dataDir||process.env.DATA_DIR||fileURLToPath(new URL('./data/',import.meta.url)));
 mkdirSync(dataDir,{recursive:true,mode:0o700});chmodSync(dataDir,authMode==='accounts'?0o711:0o700);
 const settingsPath=join(dataDir,'model-settings.json');
 if(existsSync(settingsPath)){if(authMode==='accounts')chmodSync(settingsPath,0o600);const saved=JSON.parse(readFileSync(settingsPath,'utf8'));for(const key of SETTING_KEYS)if(saved[key]&&!process.env[key])process.env[key]=saved[key];}
 const databasePath=join(dataDir,'tasks.sqlite');
 const db=new DatabaseSync(databasePath);for(const path of [databasePath,`${databasePath}-wal`,`${databasePath}-shm`])try{chmodSync(path,0o600);}catch{}
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
 const accounts=new AccountStore(db,{dataDir,encryptionKey:config.encryptionKey});
 const uidIsolationAvailable=authMode==='accounts'&&supportsUserIsolation(dataDir);
 const legacyStore=new ProjectStore(join(dataDir,'projects'));
 const userStores=new Map();
 const storeFor=user=>{
  if(user.id==='karvin-local-owner')return legacyStore;
  let store=userStores.get(user.id);
  if(!store){store=new ProjectStore(join(dataDir,'users',user.id,'projects'),uidIsolationAvailable?{uid:user.uid,gid:user.uid}:{});userStores.set(user.id,store);}
  return store;
 };
 const tasks=new Map(db.prepare('SELECT data FROM tasks').all().map(row=>{const task=JSON.parse(row.data);if(['queued','running','awaiting_approval'].includes(task.status)){task.status='interrupted';task.error='Server restarted before completion';delete task.pendingApproval;}return [task.id,task];}));
 const projects=new Map(db.prepare('SELECT data FROM projects').all().map(row=>[JSON.parse(row.data).id,JSON.parse(row.data)]));
 const save=task=>db.prepare('INSERT OR REPLACE INTO tasks VALUES (?, ?)').run(task.id,JSON.stringify(task));
 const saveProject=project=>db.prepare('INSERT OR REPLACE INTO projects VALUES (?, ?)').run(project.id,JSON.stringify(project));
 for(const task of tasks.values())save(task);
 if(authMode==='token'){
  for(const project of projects.values())if(!project.userId){project.userId='karvin-local-owner';saveProject(project);}
  for(const task of tasks.values())if(!task.userId){task.userId='karvin-local-owner';save(task);}
 }
 const controllers=new Map(),streams=new Map(),approvals=new Map(),queue=[],projectLocks=new Set(),runs=new Set();let active=0,closing=false;
 const loginFailures=new Map();
 const fallbackSettings=()=>Object.fromEntries(SETTING_KEYS.map(key=>[key,process.env[key]||'']));
 const settingsFor=user=>authMode==='accounts'?{...fallbackSettings(),...accounts.getSettings(user.id)}:fallbackSettings();
 const canUseToken=(req,u)=>{
  if(!token)return true;
  const supplied=req.headers.authorization?.replace(/^Bearer /,'')||(authMode==='token'?u.searchParams.get('token'):'')||'';
  return safeEqual(supplied,token);
 };
 const actorFor=req=>{
  if(authMode==='accounts'){const session=accounts.sessionFromRequest(req);return session?{...session.user,uid:session.uid}:null;}
  return canUseToken(req,new URL(req.url,'http://localhost'))?{id:'karvin-local-owner',email:null,name:'Workspace owner',role:'owner',status:'active',uid:typeof process.getuid==='function'?process.getuid():1000}:null;
 };
 const activeFor=userId=>[...tasks.values()].filter(t=>t.userId===userId&&['queued','running','awaiting_approval'].includes(t.status));
 const storeForId=userId=>storeFor(authMode==='accounts'?accounts.user(userId):{id:'karvin-local-owner'});
 const browserReady=settings=>Boolean(settings.LLM_API_KEY&&settings.LLM_MODEL);
 const codingReady=settings=>config.codingReady??Boolean((settings.CODE_API_KEY||settings.LLM_API_KEY)&&(settings.CODE_MODEL||settings.LLM_MODEL));
 const allowCommands=process.env.ENABLE_PROJECT_COMMANDS==='true'&&(authMode!=='accounts'||uidIsolationAvailable);
 function ensureTenantRoot(user){
  const usersRoot=join(dataDir,'users');mkdirSync(usersRoot,{recursive:true,mode:0o711});chmodSync(usersRoot,0o711);
  const root=join(usersRoot,user.id);mkdirSync(root,{recursive:true,mode:0o700});
  if(uidIsolationAvailable){chownSync(root,user.uid,user.uid);chmodSync(root,0o700);}
  const home=join(root,'home');mkdirSync(home,{recursive:true,mode:0o700});if(uidIsolationAvailable){chownSync(home,user.uid,user.uid);chmodSync(home,0o700);}
  return root;
 }
 async function claimLegacyData(owner){
  if(!owner||owner.role!=='owner')return;
  ensureTenantRoot(owner);
  const userStore=storeFor(owner);
  for(const project of projects.values()){
   if(project.userId)continue;
   const source=legacyStore.directory(project.id),destination=userStore.directory(project.id);
   if(existsSync(source)&&!existsSync(destination)){mkdirSync(dirname(destination),{recursive:true,mode:0o700});if(uidIsolationAvailable){chownSync(dirname(destination),owner.uid,owner.uid);chmodSync(dirname(destination),0o700);}renameSync(source,destination);if(uidIsolationAvailable)ownTree(destination,owner.uid);}
   project.userId=owner.id;saveProject(project);
  }
  for(const task of tasks.values())if(!task.userId){task.userId=owner.id;save(task);}
 }
 function event(task,payload){const item={...payload,at:new Date().toISOString(),seq:task.events.length+1};task.events.push(item);save(task);for(const response of streams.get(task.id)||[])response.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);}
 function finishStreams(id){for(const response of streams.get(id)||[])response.end();streams.delete(id);}
 function summary(task){const {events,output,...rest}=task;return {...rest,eventCount:events.length,output:output?{text:output.text,engine:output.engine,result:output.result,steps:output.steps,changedFiles:output.changes?.map(c=>c.path)}:undefined};}
 function pump(){
  if(closing)return;
  while(active<limit){
   const index=queue.findIndex(id=>{const task=tasks.get(id);return task?.status==='queued'&&(!task.projectId||!projectLocks.has(`${task.userId}:${task.projectId}`));});
   if(index===-1)return;
   const [id]=queue.splice(index,1),task=tasks.get(id),lock=task.projectId?`${task.userId}:${task.projectId}`:null;
   if(lock)projectLocks.add(lock);active++;
   const run=execute(task).finally(()=>{active--;runs.delete(run);if(lock)projectLocks.delete(lock);pump();});runs.add(run);
  }
 }
 function approve(task,request,signal){
  signal.throwIfAborted();const id=randomUUID();task.status='awaiting_approval';task.pendingApproval={id,...request};event(task,{type:'approval_required',status:task.status,approval:task.pendingApproval});
  return new Promise(resolve=>{let timer;const finish=(approved,reason)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);approvals.delete(id);delete task.pendingApproval;if(!signal.aborted)task.status='running';event(task,{type:'approval_resolved',approvalId:id,approved,status:task.status,reason});resolve({approved,reason});};const abort=()=>finish(false,'Task cancelled');approvals.set(id,{taskId:task.id,userId:task.userId,finish});signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(false,'Approval expired after five minutes'),300000);});
 }
 async function execute(task){
  const controller=new AbortController();controllers.set(task.id,controller);const timeout=setTimeout(()=>controller.abort(new Error('Task deadline reached')),task.kind==='coding'?1200000:300000);task.status='running';event(task,{type:'status',status:'running'});
  try{
   const user=authMode==='accounts'?accounts.runtimeUser(task.userId):{id:'karvin-local-owner',uid:typeof process.getuid==='function'?process.getuid():undefined};
   if(!user)throw new Error('Task owner account is unavailable');
   const settings=settingsFor(user),store=storeFor(user);
   if(task.kind==='coding')task.output=await runCoding({task:{...task,initialMessages:tasks.get(task.parentTaskId)?.output?.messages},store,signal:controller.signal,emit:payload=>event(task,payload),approve:(request,signal)=>approve(task,request,signal),model:config.codeModel,settings,allowCommands,workerUid:authMode==='accounts'?user.uid:undefined,workerGid:authMode==='accounts'?user.uid:undefined,workerHome:authMode==='accounts'?join(dataDir,'users',user.id,'home'):undefined,browserRun:browserReady(settings)?input=>runAgent({...input,maxSteps:20,chromium,modelConfig:settings}):undefined});
   else task.output=await runAgent({url:task.url,goal:task.goal,maxSteps:task.maxSteps,signal:controller.signal,emit:payload=>event(task,payload),chromium,modelConfig:settings});
   controller.signal.throwIfAborted();task.status='completed';
  }catch(error){task.status=controller.signal.aborted&&task.status==='cancelled'?'cancelled':'failed';task.error=controller.signal.aborted?String(controller.signal.reason?.message||'Cancelled'):String(error.message);if(error.changes)task.output={changes:error.changes,checks:error.checks,engine:'karvin-coding-agent'};}
  finally{clearTimeout(timeout);controllers.delete(task.id);task.finishedAt=new Date().toISOString();event(task,{type:'status',status:task.status,error:task.error,output:task.output?{...task.output,messages:undefined}:undefined});finishStreams(task.id);}
 }
 const json=(res,status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));};
 async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1200000)throw new Error('Request body too large');}return JSON.parse(data);}
 function secureCookie(req){return req.socket.encrypted||req.headers['x-forwarded-proto']==='https';}
 function originAllowed(req){const origin=req.headers.origin;if(!origin)return true;const proto=req.headers['x-forwarded-proto']||(req.socket.encrypted?'https':'http');const host=req.headers['x-forwarded-host']||req.headers.host;return origin===`${proto}://${host}`;}
 function sendSession(res,req,session){res.setHeader('Set-Cookie',accounts.cookie(session.token,{secure:secureCookie(req)}));}
 function sendClearedCookie(res,req){res.setHeader('Set-Cookie',accounts.cookie('',{secure:secureCookie(req),clear:true}));}
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/api/')){
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!originAllowed(req))return json(res,403,{error:'Origin rejected'});
   if(u.pathname==='/api/auth/status'&&req.method==='GET'){const hasOwner=accounts.countUsers()>0;return json(res,200,{enabled:authMode==='accounts',registrationOpen:authMode==='accounts'&&(hasOwner?allowSignup:Boolean(ownerEmail||allowOwnerBootstrap)),ownerSetupReady:hasOwner||Boolean(ownerEmail||allowOwnerBootstrap),hasOwner});}
    if(authMode==='accounts'&&u.pathname==='/api/auth/register'&&req.method==='POST'){
     const input=await body(req),wasEmpty=accounts.countUsers()===0;if(wasEmpty&&!ownerEmail&&!allowOwnerBootstrap)return json(res,503,{error:'Owner account setup is not configured yet'});if(wasEmpty&&ownerEmail&&String(input.email||'').trim().toLowerCase()!==ownerEmail)return json(res,403,{error:'The first account must use the configured owner email'});if(!wasEmpty&&!allowSignup&&!input.inviteToken)return json(res,403,{error:'Registration is invitation-only'});
     const user=await accounts.register(input),runtimeUser=accounts.runtimeUser(user.id);if(wasEmpty)await claimLegacyData(runtimeUser);else ensureTenantRoot(runtimeUser);
     const session=accounts.createSession(user.id);sendSession(res,req,session);return json(res,201,{user,csrf:session.csrf,expiresAt:session.expiresAt});
    }
    if(authMode==='accounts'&&u.pathname==='/api/auth/login'&&req.method==='POST'){
     const ip=req.socket.remoteAddress||'unknown',record=loginFailures.get(ip)||{count:0,until:0};if(record.until>Date.now()&&record.count>=8)return json(res,429,{error:'Too many sign-in attempts. Try again later.'},{'Retry-After':String(Math.ceil((record.until-Date.now())/1000))});
     const input=await body(req),user=await accounts.verifyPassword(input.email,input.password);
     if(!user){record.count++;record.until=record.count>=8?Date.now()+15*60*1000:0;loginFailures.set(ip,record);return json(res,401,{error:'Email or password is incorrect'});}
     loginFailures.delete(ip);const session=accounts.createSession(user.id);sendSession(res,req,session);return json(res,200,{user,csrf:session.csrf,expiresAt:session.expiresAt});
    }
    if(authMode==='accounts'&&u.pathname==='/api/internal/session'&&req.method==='GET'){
     if(!internalToken||!safeEqual(req.headers.authorization?.replace(/^Bearer /,''),internalToken))return json(res,401,{error:'Internal authentication required'});
     const session=accounts.sessionFromRequest(req);return session?json(res,200,{user:{id:session.user.id,uid:session.user.uid,role:session.user.role}}):json(res,401,{error:'Account session required'});
    }
    const actor=actorFor(req);
    if(u.pathname==='/api/health'&&req.method==='GET'){
     const settings=actor?settingsFor(actor):{};const state=modelStatus(settings);
     return json(res,200,{name:'Karvin',accessMode:authMode==='accounts'?'accounts':(config.accessMode||'token'),ready:state.browserReady,browserReady:state.browserReady,codingReady:codingReady(settings),codingEngine:'karvin-coding-agent',codingModel:state.codingModel,model:state.model,commandsEnabled:allowCommands,ideIsolationReady:authMode!=='accounts'||uidIsolationAvailable,concurrency:limit,active:actor?activeFor(actor.id).filter(t=>['running','awaiting_approval'].includes(t.status)).length:0});
    }
    if(!actor)return json(res,401,{error:'Sign in to continue'});
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&authMode==='accounts'&&!['/api/auth/login','/api/auth/register'].includes(u.pathname)){
     const session=accounts.sessionFromRequest(req);if(!accounts.verifyCsrf(session,req.headers['x-csrf-token']))return json(res,403,{error:'Session verification failed. Refresh and try again.'});
    }
    if(authMode==='accounts'&&u.pathname==='/api/auth/me'&&req.method==='GET'){
     const session=accounts.sessionFromRequest(req);if(!session)return json(res,401,{error:'Sign in to continue'});return json(res,200,{user:session.user,csrf:session.csrf,expiresAt:session.expiresAt});
    }
    if(authMode==='accounts'&&u.pathname==='/api/auth/csrf'&&req.method==='GET'){
     const session=accounts.sessionFromRequest(req);if(!session)return json(res,401,{error:'Sign in to continue'});
     return json(res,200,{csrf:session.csrf,user:session.user,expiresAt:session.expiresAt});
    }
    if(authMode==='accounts'&&u.pathname==='/api/auth/logout'&&req.method==='POST'){
     accounts.revokeRequest(req);sendClearedCookie(res,req);return json(res,200,{signedOut:true});
    }
    if(authMode==='accounts'&&u.pathname==='/api/auth/password'&&req.method==='POST'){
     const input=await body(req);await accounts.changePassword(actor.id,input.currentPassword,input.newPassword);const session=accounts.createSession(actor.id);sendSession(res,req,session);return json(res,200,{changed:true,csrf:session.csrf,expiresAt:session.expiresAt});
    }
    if(authMode==='accounts'&&u.pathname==='/api/admin/users'&&req.method==='GET'){
     if(!['owner','admin'].includes(actor.role))return json(res,403,{error:'Admin role required'});return json(res,200,{users:accounts.listUsers(),total:accounts.countUsers()});
    }
    if(authMode==='accounts'&&u.pathname==='/api/admin/invites'&&req.method==='GET'){
     if(!['owner','admin'].includes(actor.role))return json(res,403,{error:'Admin role required'});return json(res,200,{invites:accounts.listInvites()});
    }
    if(authMode==='accounts'&&u.pathname==='/api/admin/invites'&&req.method==='POST'){
     if(!['owner','admin'].includes(actor.role))return json(res,403,{error:'Admin role required'});const input=await body(req),invite=accounts.createInvite(actor,input);return json(res,201,{invite:{id:invite.id,email:invite.email,role:invite.role,expiresAt:invite.expiresAt,path:`/login?invite=${encodeURIComponent(invite.token)}&email=${encodeURIComponent(invite.email)}`}});
    }
    const inviteMatch=u.pathname.match(/^\/api\/admin\/invites\/([\w-]+)$/);
    if(authMode==='accounts'&&inviteMatch&&req.method==='DELETE'){
     if(!['owner','admin'].includes(actor.role))return json(res,403,{error:'Admin role required'});return accounts.revokeInvite(inviteMatch[1])?json(res,200,{revoked:true}):json(res,404,{error:'Invitation not found'});
    }
    const adminUser=u.pathname.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if(authMode==='accounts'&&adminUser&&req.method==='PATCH'){
     if(!['owner','admin'].includes(actor.role))return json(res,403,{error:'Admin role required'});const input=await body(req);return json(res,200,{user:accounts.updateUser(actor,adminUser[1],input)});
    }
    if(u.pathname==='/api/billing/status'&&req.method==='GET')return json(res,200,{enabled:false,plan:'unmetered-development',status:'payments-not-configured',message:'Payments are intentionally disabled until Karvin billing is configured.'});
    if(u.pathname==='/api/apps'&&req.method==='GET')return json(res,200,[
     {id:'workspace',name:'Karvin AI workspace',category:'development',href:'/',status:'available'},
     {id:'ide',name:'Karvin IDE',category:'development',href:'/ide/',status:'available'},
     {id:'terminal',name:'Terminal',category:'development',href:'/ide/',status:'available'},
     {id:'git',name:'Git',category:'development',href:'/ide/',status:'available'},
     {id:'projects',name:'Projects and files',category:'workspace',href:'/',status:'available'},
     {id:'missions',name:'AI sessions',category:'automation',href:'/sessions',status:'available'},
     {id:'previews',name:'App previews',category:'development',href:'/ide/',status:'available'},
    ]);
    if(u.pathname==='/api/settings'&&req.method==='GET'){
     const settings=settingsFor(actor);return json(res,200,{LLM_MODEL:settings.LLM_MODEL||'',LLM_BASE_URL:settings.LLM_BASE_URL||'https://api.openai.com/v1',CODE_MODEL:settings.CODE_MODEL||'',CODE_BASE_URL:settings.CODE_BASE_URL||'',CODE_PROVIDER_ID:settings.CODE_PROVIDER_ID||'',LLM_API_KEY_CONFIGURED:Boolean(settings.LLM_API_KEY),CODE_API_KEY_CONFIGURED:Boolean(settings.CODE_API_KEY)});
    }
    if(u.pathname==='/api/settings'&&req.method==='POST'){
     const inFlight=activeFor(actor.id);if(inFlight.length)return json(res,409,{error:'Finish your active tasks before changing model connections'});
     const input=await body(req),saved=authMode==='accounts'?accounts.getSettings(actor.id):fallbackSettings();
     for(const key of SETTING_KEYS){if(input[key]===undefined||input[key]==='')continue;if(typeof input[key]!=='string'||input[key].length>2000)throw new Error('Invalid model setting');if(key.endsWith('BASE_URL'))await checkURL(input[key]);saved[key]=input[key].trim();}
     if(authMode==='accounts')accounts.saveSettings(actor.id,saved);else{writeFileSync(settingsPath,JSON.stringify(saved),{mode:0o600});for(const key of SETTING_KEYS)if(saved[key])process.env[key]=saved[key];}
     return json(res,200,{saved:true,settings:(()=>{const state=modelStatus({...fallbackSettings(),...saved});return {browserReady:state.browserReady,codingReady:codingReady({...fallbackSettings(),...saved})};})()});
    }
    if(u.pathname==='/api/projects'&&req.method==='GET')return json(res,200,[...projects.values()].filter(project=>project.userId===actor.id).map(({userId,...project})=>project));
    if(u.pathname==='/api/projects'&&req.method==='POST'){
     const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw new Error('Project name must be 1–80 characters');
     if(authMode==='accounts')ensureTenantRoot(actor);
     const project={id:randomUUID(),name:input.name.trim(),userId:actor.id,createdAt:new Date().toISOString()};await storeFor(actor).create(project.id);projects.set(project.id,project);saveProject(project);const {userId,...publicProject}=project;return json(res,201,publicProject);
    }
    const projectMatch=u.pathname.match(/^\/api\/projects\/([\w-]+)\/(files|file|export)$/);
    if(projectMatch){
     const id=projectMatch[1],project=projects.get(id);if(!project||project.userId!==actor.id)return json(res,404,{error:'Project not found'});const store=storeFor(actor);
     if(req.method==='GET'&&projectMatch[2]==='files')return json(res,200,await store.list(id));
     if(req.method==='GET'&&projectMatch[2]==='export'){
      if(busyProject(id,actor.id))return json(res,409,{error:'Wait for the project task to finish before exporting'});
      const files=await store.list(id);let bytes=0;const contents=Object.create(null);for(const file of files){bytes+=file.bytes;if(bytes>10000000)throw new Error('Project export exceeds 10 MB');contents[file.path]=strToU8(await store.read(id,file.path));}
      const archive=zipSync(contents);res.writeHead(200,{'Content-Type':'application/zip','Cache-Control':'no-store','Content-Disposition':`attachment; filename="karvin-project-${id}.zip"`});res.end(archive);return;
     }
     if(req.method==='GET'&&projectMatch[2]==='file')return json(res,200,{path:u.searchParams.get('path'),content:await store.read(id,u.searchParams.get('path'))});
     if(req.method==='PUT'&&projectMatch[2]==='file'){if(busyProject(id,actor.id))return json(res,409,{error:'Wait for this project’s active or queued task to finish before editing'});const input=await body(req);return json(res,200,await store.write(id,input.path,input.content));}
     return json(res,405,{error:'Method not allowed'});
    }
    if(u.pathname==='/api/tasks'&&req.method==='GET')return json(res,200,[...tasks.values()].filter(task=>task.userId===actor.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(summary));
    if(u.pathname==='/api/tasks'&&req.method==='POST'){
     if(queue.length>=100)return json(res,429,{error:'Task queue is full'});
     const input=await body(req),kind=input.kind||'browser',settings=settingsFor(actor);if(!['browser','coding'].includes(kind))throw new Error('Task kind must be browser or coding');
     if(kind==='browser'&&!browserReady(settings))return json(res,503,{error:authMode==='accounts'?'Configure a browser model in your account Connections first':'Set LLM_API_KEY and LLM_MODEL on the server to run browser tasks'});
     if(kind==='coding'&&!codingReady(settings))return json(res,503,{error:authMode==='accounts'?'Configure a coding model in your account Connections first':'Configure CODE_API_KEY and CODE_MODEL, or reuse LLM_API_KEY and LLM_MODEL for coding tasks'});
     if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>8000)throw new Error('Goal must be 1–8000 characters');
     const maxSteps=input.maxSteps??30;if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>60)throw new Error('maxSteps must be an integer from 1 to 60');
     if(kind==='browser')await checkURL(input.url);
     else{
      const project=projects.get(input.projectId);if(!project||project.userId!==actor.id)throw new Error('Select one of your own projects');
      if(!['plan','act'].includes(input.mode||'plan'))throw new Error('Mode must be plan or act');
      if(input.parentTaskId){const parent=tasks.get(input.parentTaskId);if(!parent||parent.userId!==actor.id||parent.projectId!==input.projectId||parent.kind!=='coding'||parent.status!=='completed')throw new Error('Follow-up must reference a completed task in this project');}
     }
     const project=kind==='coding'?projects.get(input.projectId):null;
     const task={id:randomUUID(),userId:actor.id,kind,...(kind==='browser'?{url:input.url}:{projectId:input.projectId,projectName:project.name,mode:input.mode||'plan',parentTaskId:input.parentTaskId}),goal:input.goal.trim(),maxSteps,status:'queued',createdAt:new Date().toISOString(),events:[]};
     tasks.set(task.id,task);event(task,{type:'status',status:'queued'});queue.push(task.id);json(res,202,summary(task));pump();return;
    }
    const match=u.pathname.match(/^\/api\/tasks\/([\w-]+)(?:\/(events|export|approval|undo))?$/);if(!match)return json(res,404,{error:'Endpoint not found'});
    const task=tasks.get(match[1]);if(!task||task.userId!==actor.id)return json(res,404,{error:'Task not found'});
    if(req.method==='POST'&&match[2]==='approval'){
     const input=await body(req),pending=approvals.get(input.id);if(!pending||pending.taskId!==task.id||pending.userId!==actor.id)return json(res,409,{error:'Approval is no longer pending'});if(typeof input.approved!=='boolean')throw new Error('approved must be true or false');pending.finish(input.approved,input.approved?'Approved by user':'Rejected by user');return json(res,200,summary(task));
    }
    if(req.method==='POST'&&match[2]==='undo'){
     const store=storeFor(actor);if(task.kind!=='coding'||!task.output?.changes?.length||task.undoneAt)throw new Error('This task has no changes available to undo');if(busyProject(task.projectId,actor.id))return json(res,409,{error:'Project has an active task'});
     for(const change of task.output.changes)if(await store.optionalRead(task.projectId,change.path)!==change.after)return json(res,409,{error:`${change.path} changed after this task; undo stopped to preserve later edits`});
     for(const change of task.output.changes){if(change.before===null)await store.remove(task.projectId,change.path);else await store.write(task.projectId,change.path,change.before);}task.undoneAt=new Date().toISOString();event(task,{type:'changes_undone'});return json(res,200,summary(task));
    }
    if(req.method==='DELETE'&&!match[2]){if(!['queued','running','awaiting_approval'].includes(task.status))return json(res,409,{error:'Task has already finished'});task.status='cancelled';const queuedIndex=queue.indexOf(task.id);if(queuedIndex>=0)queue.splice(queuedIndex,1);controllers.get(task.id)?.abort(new Error('Cancelled by user'));event(task,{type:'status',status:'cancelled'});finishStreams(task.id);return json(res,200,summary(task));}
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    if(match[2]==='events'){
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const cursor=Number(req.headers['last-event-id']||0);for(const item of task.events)if(item.seq>cursor)res.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);
     if(!['queued','running','awaiting_approval'].includes(task.status)){res.end();return;}
     if(!streams.has(task.id))streams.set(task.id,new Set());streams.get(task.id).add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(heartbeat);streams.get(task.id)?.delete(res);});return;
    }
    if(match[2]==='export')res.setHeader('Content-Disposition',`attachment; filename="karvin-${task.id}.json"`);
    return json(res,200,task);
   }
   const asset=PUBLIC_ASSETS[u.pathname];if(!asset)return json(res,404,{error:'Not found'});
   res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
   res.end(readFileSync(new URL(`./public/${asset[0]}`,import.meta.url)));
  }catch(error){if(!res.headersSent)json(res,error.status|| (error.code==='ENOENT'?404:400),{error:error.message});else res.end();}
 });
 function busyProject(id,userId){return [...tasks.values()].some(t=>t.projectId===id&&t.userId===userId&&['running','awaiting_approval','queued'].includes(t.status));}
 async function close(){closing=true;for(const controller of controllers.values())controller.abort(new Error('Server shutting down'));for(const id of streams.keys())finishStreams(id);await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...runs]);db.close();}
 return {server,host,port,close,accounts,authMode,internalToken};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const app=createKarvinServer();app.server.listen(app.port,app.host,()=>console.log(`Karvin: http://${app.host}:${app.server.address().port}`));
 const shutdown=()=>{void app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
