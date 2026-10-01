import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const dataDir=resolve('data');mkdirSync(dataDir,{recursive:true});
const envPath=resolve('.env');
if(!existsSync(envPath))writeFileSync(envPath,'WEB_AGENT_TOKEN='+randomBytes(32).toString('hex')+'\nPORT=3000\nDATA_DIR='+dataDir+'\nMAX_CONCURRENCY=1\nENABLE_PROJECT_COMMANDS=true\n',{mode:0o600});
const pidPath=resolve('data/ide-launcher.pid');
if(existsSync(pidPath)){try{process.kill(Number(readFileSync(pidPath,'utf8')),0);console.log('KARVIN IDE is already running on port 3000.');process.exit(0);}catch{}}
const log=openSync(resolve('data/ide.log'),'a',0o600);
const child=spawn(process.execPath,['--env-file=.env','ide.mjs'],{cwd:process.cwd(),env:process.env,detached:true,stdio:['ignore',log,log]});
child.unref();closeSync(log);
writeFileSync(pidPath,String(child.pid));
let ready=false;
for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
if(!ready){console.error('KARVIN IDE did not become ready. See data/ide.log.');process.exit(1);}
console.log('KARVIN IDE is ready on forwarded port 3000. Open Ports → KARVIN IDE.');
console.log('The access token and IDE password are in .env (WEB_AGENT_TOKEN). Keep the forwarded port private.');
