import {spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,chownSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:net';

async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const {port}=server.address();
 await new Promise(resolve=>server.close(resolve));
 return port;
}

export class ClineHubWorkers {
 constructor({dataDir,sourceDir,executable,workspaceManager,isolationReady=false,healthTimeout=45000}={}){
  this.dataDir=resolve(dataDir||'/data');
  this.sourceDir=resolve(sourceDir||process.env.CLINE_HUB_SOURCE_DIR||'.runtime/cline-source');
  this.executable=resolve(executable||process.env.CLINE_HUB_BUN_BIN||'.runtime/bun/bin/bun');
  this.workspaceManager=workspaceManager;
  this.isolationReady=isolationReady;
  this.healthTimeout=healthTimeout;
  this.workers=new Map();
  this.closing=false;
 }

 isReady(){
  return this.isolationReady&&existsSync(this.executable)&&
   existsSync(join(this.sourceDir,'apps/cline-hub/src/server.ts'))&&
   existsSync(join(this.sourceDir,'apps/cline-hub/dist/webview/index.html'));
 }

 async get(user){
  if(this.closing)throw new Error('KARVIN AI workspaces are shutting down');
  if(!this.isolationReady)throw new Error('The host cannot isolate KARVIN AI workspaces by account');
  if(!Number.isInteger(user?.uid)||user.uid<=0)throw new Error('The KARVIN account has no isolated workspace identity');
  if(!this.isReady())throw new Error('The KARVIN AI browser runtime is not built. Run scripts/build-ide.sh before starting the platform.');
  let worker=this.workers.get(user.id);
  if(worker){await worker.ready;return worker;}
  worker={userId:user.id,uid:user.uid,port:await freePort(),child:null,ready:null,closed:false};
  this.workers.set(user.id,worker);
  worker.ready=this.start(worker,user).catch(error=>{this.workers.delete(user.id);throw error;});
  await worker.ready;
  return worker;
 }

 async start(worker,user){
  const paths=this.workspaceManager?.setup(user);
  if(!paths?.home||!paths?.projects)throw new Error('The isolated KARVIN workspace is unavailable');
  const temp=join(paths.home,'tmp'),config=join(paths.home,'.config'),data=join(paths.home,'.local/share'),cache=join(paths.home,'.cache');
  for(const path of [temp,config,data,cache]){mkdirSync(path,{recursive:true,mode:0o700});chownSync(path,user.uid,user.uid);chmodSync(path,0o700);}
  const port=worker.port,serverFile=join(this.sourceDir,'apps/cline-hub/src/server.ts');
  const env={
   PATH:`${dirname(this.executable)}:/usr/local/bin:/usr/bin:/bin`,
   HOME:paths.home,
   XDG_CONFIG_HOME:config,
   XDG_DATA_HOME:data,
   XDG_CACHE_HOME:cache,
   TMPDIR:temp,
   LANG:'C.UTF-8',
   HOST:'127.0.0.1',
   CLINE_HUB_DASHBOARD_PORT:String(port),
   PUBLIC_URL:`http://127.0.0.1:${port}`,
   WORKSPACE_ROOT:paths.projects,
  };
  worker.child=spawn(this.executable,['run',serverFile],{
   cwd:this.sourceDir,
   uid:user.uid,
   gid:user.uid,
   detached:true,
   stdio:'ignore',
   env,
  });
  worker.child.once('exit',()=>{worker.closed=true;if(this.workers.get(user.id)===worker)this.workers.delete(user.id);});
  worker.child.once('error',error=>{worker.startError=error;});
  const until=Date.now()+this.healthTimeout;
  while(Date.now()<until){
   if(worker.closed)throw new Error('The KARVIN AI workspace stopped during startup');
   if(worker.startError)throw worker.startError;
   try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1200)});if(response.ok){await response.body?.cancel();return worker;}await response.body?.cancel();}catch{}
   await new Promise(resolve=>setTimeout(resolve,300));
  }
  this.stopWorker(worker);
  throw new Error('The KARVIN AI workspace failed its startup check');
 }

 stopWorker(worker){
  if(worker.closed||!worker.child?.pid)return;
  worker.closed=true;
  try{process.kill(-worker.child.pid,'SIGTERM');}catch{try{worker.child.kill('SIGTERM');}catch{}}
 }

 async close(){
  this.closing=true;
  const workers=[...this.workers.values()];
  for(const worker of workers){try{await worker.ready;}catch{}this.stopWorker(worker);}
  await Promise.all(workers.map(worker=>new Promise(resolve=>{
   if(!worker.child||worker.closed)return resolve();
   const timer=setTimeout(resolve,3000);
   worker.child.once('exit',()=>{clearTimeout(timer);resolve();});
  })));
  this.workers.clear();
 }
}
