import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,cpSync} from 'node:fs';
import {resolve} from 'node:path';
import {createKarvinServer} from './server.mjs';
import {createIDEProxy} from './ide-proxy.mjs';

const dataDir=resolve(process.env.DATA_DIR||'data'),idePort=Number(process.env.IDE_PORT||8081);
if((process.env.WEB_AGENT_TOKEN||'').length<24)throw new Error('WEB_AGENT_TOKEN must contain at least 24 characters');
const executable=resolve(process.env.CODE_SERVER_BIN||'.runtime/code-server/bin/code-server');
if(!existsSync(executable))throw new Error('code-server is missing. Run bash scripts/build-ide.sh first.');
for(const dir of ['projects','ide/User','ide-home'])mkdirSync(`${dataDir}/${dir}`,{recursive:true});
if(!existsSync(`${dataDir}/ide/User/settings.json`))writeFileSync(`${dataDir}/ide/User/settings.json`,JSON.stringify({'workbench.colorTheme':'Default Dark Modern','window.title':'${dirty}${activeEditorShort}${separator}KARVIN IDE','workbench.startupEditor':'readme','telemetry.telemetryLevel':'off','files.autoSave':'afterDelay','terminal.integrated.defaultProfile.linux':'bash'},null,2));
if(existsSync('.runtime/extensions')&&!existsSync(`${dataDir}/extensions`))cpSync('.runtime/extensions',`${dataDir}/extensions`,{recursive:true});
if(!existsSync(`${dataDir}/projects/README.md`))writeFileSync(`${dataDir}/projects/README.md`,'# KARVIN IDE\n\nWelcome to your coding workspace.\n\n- Open the Terminal menu to run commands, install dependencies, and start apps.\n- Open Cline from the sidebar and configure your model provider.\n- Open Karvin Mission Control in a second tab for approved coding and browser tasks.\n- Project folders created in Mission Control appear here by project ID.\n- Preview a running app with /ide/proxy/PORT/ on this same site.\n- Commit and push your work to Git, or export a ZIP before closing. Free hosting storage is temporary.\n\nThis is one private workspace for its owner.\n');
const agent=createKarvinServer({host:'127.0.0.1',port:0,dataDir});
await new Promise(r=>agent.server.listen(0,'127.0.0.1',r));
const child=spawn(executable,['--bind-addr',`127.0.0.1:${idePort}`,'--auth','password','--disable-telemetry','--disable-update-check','--app-name','KARVIN IDE','--user-data-dir',`${dataDir}/ide`,'--extensions-dir',`${dataDir}/extensions`,`${dataDir}/projects`],{stdio:'inherit',detached:process.platform!=='win32',env:{PATH:process.env.PATH,HOME:`${dataDir}/ide-home`,LANG:'C.UTF-8',PASSWORD:process.env.WEB_AGENT_TOKEN,NODE_OPTIONS:'--max-old-space-size=256'}});
let stopping=false;
const proxy=createIDEProxy({idePort,agentPort:agent.server.address().port});
async function shutdown(code=0){if(stopping)return;stopping=true;proxy.close();try{if(child.pid)process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGTERM');}catch{}await agent.close();process.exit(code);}
child.on('error',error=>{console.error('IDE process failed:',error.message);void shutdown(1);});
child.on('exit',code=>{if(!stopping){console.error('IDE process exited:',code);void shutdown(1);}});
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{void shutdown();setTimeout(()=>process.exit(0),5000).unref();});
// Fail startup if the IDE never responds; don't publish an apparently healthy shell.
for(let i=0;i<120;i++){try{const r=await fetch(`http://127.0.0.1:${idePort}/healthz`);if(r.ok)break;}catch{}if(i===119)throw new Error('IDE startup timed out');await new Promise(r=>setTimeout(r,500));}
proxy.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('KARVIN IDE ready: /ide/ · Mission Control: /'));
