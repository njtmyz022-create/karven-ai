import {mkdirSync,existsSync,readFileSync,openSync,writeSync,closeSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {createKarvinServer} from './server.mjs';
import {createIDEProxy} from './ide-proxy.mjs';
import {createCodespacesGate} from './codespaces-gateway.mjs';
import {IDEWorkers} from './ide-workers.mjs';

const dataDir=resolve(process.env.DATA_DIR||'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
const executable=resolve(process.env.CODE_SERVER_BIN||'.runtime/code-server/bin/code-server');
if(!existsSync(executable))throw new Error('code-server is missing. Build the full IDE image before starting Karvin.');
function internalSecret(){
 const supplied=process.env.KARVIN_INTERNAL_TOKEN;if(supplied&&supplied.length>=24)return supplied;
 const path=join(dataDir,'.internal-token');if(existsSync(path)){const value=readFileSync(path,'utf8').trim();if(value.length>=24){chmodSync(path,0o600);return value;}throw new Error('Stored internal service key is invalid');}
 const value=randomBytes(32).toString('base64url');let fd;try{fd=openSync(path,'wx',0o600);writeSync(fd,value);closeSync(fd);chmodSync(path,0o600);return value;}catch(error){if(fd!==undefined)try{closeSync(fd);}catch{}if(error.code==='EEXIST'){const existing=readFileSync(path,'utf8').trim();if(existing.length>=24)return existing;}throw error;}
}
const internalToken=internalSecret(),githubGateway=process.env.KARVIN_GITHUB_GATEWAY==='true'||process.env.CODESPACES==='true';
const gate=githubGateway?createCodespacesGate():null;
const agent=createKarvinServer({host:'127.0.0.1',port:0,dataDir,authMode:'accounts',accessMode:'accounts',internalToken,allowOwnerBootstrap:githubGateway});
await new Promise(resolve=>agent.server.listen(0,'127.0.0.1',resolve));
const agentPort=agent.server.address().port;
const ideManager=new IDEWorkers({dataDir,executable,extensionsDir:resolve('.runtime/extensions')});
const resolveUser=async req=>{
 try{
  const response=await fetch(`http://127.0.0.1:${agentPort}/api/internal/session`,{headers:{cookie:req.headers.cookie||'',authorization:`Bearer ${internalToken}`},signal:AbortSignal.timeout(3000)});
  if(!response.ok){await response.body?.cancel();return null;}
  return (await response.json()).user;
 }catch{return null;}
};
const proxy=createIDEProxy({agentPort,gate,agentToken:githubGateway?internalToken:null,ideManager,resolveUser,healthCheck:async()=>existsSync(executable)&&ideManager.isolationReady});
let stopping=false;
async function shutdown(code=0){if(stopping)return;stopping=true;proxy.close();await ideManager.close();await agent.close();if(code)process.exit(code);}
proxy.on('error',error=>{console.error('KARVIN proxy failed:',error.message);void shutdown(1);});
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{void shutdown();setTimeout(()=>process.exit(0),5000).unref();});
proxy.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('KARVIN platform ready: sign in · workspace · IDE · app previews'));
