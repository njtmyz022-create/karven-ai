import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// The GitHub gateway supplies account authentication. Never enable this mode
// outside Codespaces, or when the forwarded application port is not private.
export function createCodespacesGate(env=process.env,inspect=async()=>{
 const {stdout}=await run('gh',['codespace','ports','--codespace',env.CODESPACE_NAME,'--json','sourcePort,visibility'],{timeout:10000,maxBuffer:100000});
 return JSON.parse(stdout);
}){
 if(env.CODESPACES!=='true'||!env.CODESPACE_NAME)throw new Error('GitHub gateway mode requires a Codespace');
 const port=Number(env.PORT||3000),hostname=`${env.CODESPACE_NAME}-${port}.app.github.dev`;
 let pending;
 const verify=()=>pending??=(async()=>{try{const ports=await inspect();return ports.some(p=>Number(p.sourcePort)===port&&p.visibility==='private')&&ports.every(p=>Number(p.sourcePort)!==Number(env.IDE_PORT||8081)||p.visibility==='private');}catch{return false;}finally{pending=null;}})();
 return {verify,async allow(req){return req.headers.host===hostname&&await verify();}};
}
