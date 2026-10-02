import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,cpSync,readdirSync,lstatSync,chownSync,chmodSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';

function ownTree(path,uid){
 const stat=lstatSync(path);chownSync(path,uid,uid);chmodSync(path,stat.isDirectory()?0o700:0o600);
 if(stat.isDirectory())for(const name of readdirSync(path))ownTree(join(path,name),uid);
}
export function supportsUserIsolation(dataDir){
 if(typeof process.getuid!=='function'||process.getuid()!==0)return false;
 const probe=join(resolve(dataDir),`.uid-probe-${process.pid}`);
 try{writeFileSync(probe,'',{flag:'wx',mode:0o600});chownSync(probe,60000,60000);chownSync(probe,0,0);return true;}
 catch{return false;}
 finally{try{unlinkSync(probe);}catch{}}
}
async function freePort(){
 const server=createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;
}

export class IDEWorkers {
 constructor({dataDir,executable,extensionsDir,port=3000,healthTimeout=30000}={}){
  this.dataDir=resolve(dataDir||'/data');this.executable=resolve(executable||'.runtime/code-server/bin/code-server');this.extensionsDir=resolve(extensionsDir||'.runtime/extensions');this.externalPort=port;this.healthTimeout=healthTimeout;this.workers=new Map();this.closing=false;
  this.isolationReady=supportsUserIsolation(this.dataDir);
  if(typeof process.getuid!=='function')throw new Error('Per-user IDE isolation requires Linux user IDs');
 }
 async get(user){
  if(this.closing)throw new Error('IDE workers are shutting down');
  let worker=this.workers.get(user.id);
  if(worker){await worker.ready;return worker;}
  if(!this.isolationReady)throw new Error('The host cannot assign separate Linux users for IDE isolation');
  worker={userId:user.id,uid:user.uid,port:await freePort(),password:cryptoSecret(),child:null,ready:null,closed:false};
  this.workers.set(user.id,worker);worker.ready=this.start(worker,user).catch(error=>{this.workers.delete(user.id);throw error;});
  await worker.ready;return worker;
 }
 setup(user){
  const usersRoot=join(this.dataDir,'users');mkdirSync(usersRoot,{recursive:true,mode:0o711});chmodSync(usersRoot,0o711);
  const root=join(usersRoot,user.id);mkdirSync(root,{recursive:true,mode:0o700});chownSync(root,user.uid,user.uid);chmodSync(root,0o700);
  const home=join(root,'home'),userData=join(root,'ide'),extensions=join(root,'extensions'),projects=join(root,'projects');
  for(const directory of [home,userData,extensions,projects]){mkdirSync(directory,{recursive:true,mode:0o700});chownSync(directory,user.uid,user.uid);chmodSync(directory,0o700);}
  const settings=join(userData,'User');mkdirSync(settings,{recursive:true,mode:0o700});chownSync(settings,user.uid,user.uid);chmodSync(settings,0o700);
  const config=join(settings,'settings.json');if(!existsSync(config))writeFileSync(config,JSON.stringify({'workbench.colorTheme':'Default Dark Modern','window.title':'${dirty}${activeEditorShort}${separator}KARVIN IDE','workbench.startupEditor':'readme','telemetry.telemetryLevel':'off','files.autoSave':'afterDelay','terminal.integrated.defaultProfile.linux':'bash'},null,2),{mode:0o600});
  if(existsSync(this.extensionsDir)&&readdirSync(extensions).length===0)for(const name of readdirSync(this.extensionsDir))cpSync(join(this.extensionsDir,name),join(extensions,name),{recursive:true});
  if(!existsSync(join(projects,'README.md')))writeFileSync(join(projects,'README.md'),'# KARVIN IDE\n\nYour private workspace. Projects, files, terminal commands, and previews are isolated to your account.\n',{mode:0o600});
  ownTree(home,user.uid);ownTree(userData,user.uid);ownTree(extensions,user.uid);ownTree(projects,user.uid);
  return {root,home,userData,extensions,projects};
 }
 async start(worker,user){
  if(!existsSync(this.executable))throw new Error('code-server is missing. Build the full IDE image before starting a user workspace.');
  const paths=this.setup(user),args=['--bind-addr',`127.0.0.1:${worker.port}`,'--auth','password','--disable-telemetry','--disable-update-check','--app-name','KARVIN IDE','--user-data-dir',paths.userData,'--extensions-dir',paths.extensions,paths.projects];
  worker.child=spawn(this.executable,args,{uid:user.uid,gid:user.uid,stdio:'inherit',detached:true,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:paths.home,LANG:'C.UTF-8',PASSWORD:worker.password,NODE_OPTIONS:'--max-old-space-size=384'}});
  worker.child.once('exit',()=>{worker.closed=true;if(this.workers.get(user.id)===worker)this.workers.delete(user.id);});
  worker.child.once('error',error=>{worker.startError=error;});
  const until=Date.now()+this.healthTimeout;
  while(Date.now()<until){if(worker.closed)throw new Error('The user IDE process stopped during startup');if(worker.startError)throw worker.startError;try{const response=await fetch(`http://127.0.0.1:${worker.port}/healthz`,{signal:AbortSignal.timeout(1000)});if(response.ok)return worker;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  this.stopWorker(worker);throw new Error('The user IDE failed its startup health check');
 }
 stopWorker(worker){if(worker.closed||!worker.child?.pid)return;worker.closed=true;try{process.kill(-worker.child.pid,'SIGTERM');}catch{try{worker.child.kill('SIGTERM');}catch{}}}
 async close(){this.closing=true;const workers=[...this.workers.values()];for(const worker of workers){try{await worker.ready;}catch{}this.stopWorker(worker);}await Promise.all(workers.map(worker=>new Promise(resolve=>{if(!worker.child||worker.closed)return resolve();const timer=setTimeout(resolve,3000);worker.child.once('exit',()=>{clearTimeout(timer);resolve();});})));this.workers.clear();}
}

function cryptoSecret(){return randomBytes(32).toString('base64url');}
