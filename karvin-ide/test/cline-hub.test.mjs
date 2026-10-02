import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIDEProxy} from '../ide-proxy.mjs';
import {rebrandClineHub} from '../scripts/rebrand-cline-hub.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('original browser workspace routes per signed-in account and keeps KARVIN auth private',async()=>{
 const hubs=new Map(),agent=http.createServer((req,res)=>{res.end(`karvin:${req.url}`);});
 for(const id of ['alice','bob']){
  const server=http.createServer((req,res)=>{
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({id,path:req.url,cookie:req.headers.cookie||'',authorization:req.headers.authorization||'',host:req.headers.host,origin:req.headers.origin}));
  });
  hubs.set(id,{server,port:await listen(server)});
 }
 const users={alice:{id:'alice',uid:20001},bob:{id:'bob',uid:20002}};
 const manager={isReady:()=>true,async get(user){return hubs.get(user.id);}};
 const proxy=createIDEProxy({idePort:0,agentPort:await listen(agent),clineHubManager:manager,resolveUser:async req=>users[req.headers.cookie?.split('=')[1]]||null});
 const port=await listen(proxy),base=`http://127.0.0.1:${port}`;
 try{
  const anonymous=await fetch(base+'/',{redirect:'manual'});assert.equal(anonymous.status,302);assert.match(anonymous.headers.get('location'),/login\?next=%2F/);
  const alice=await (await fetch(base+'/sessions',{headers:{cookie:'karvin_session=alice',authorization:'Bearer should-not-cross'}})).json();
  assert.equal(alice.id,'alice');assert.equal(alice.path,'/sessions');assert.equal(alice.cookie,'');assert.equal(alice.authorization,'');assert.match(alice.host,/^127\.0\.0\.1:\d+$/);assert.equal(alice.origin,undefined);
  const bob=await (await fetch(base+'/settings/providers',{headers:{cookie:'karvin_session=bob'}})).json();assert.equal(bob.id,'bob');assert.equal(bob.path,'/settings/providers');
  const catalog=await (await fetch(base+'/api/marketplace/catalog',{headers:{cookie:'karvin_session=alice'}})).json();assert.equal(catalog.id,'alice');
  assert.equal(await (await fetch(base+'/api/auth/me',{headers:{cookie:'karvin_session=alice'}})).text(),'karvin:/api/auth/me');
  const oldMission=await fetch(base+'/workspace',{redirect:'manual'});assert.equal(oldMission.status,302);assert.equal(oldMission.headers.get('location'),'/');
  const unrelated=await fetch(base+'/workspace-archive');assert.equal(unrelated.status,200);assert.equal(await unrelated.text(),'karvin:/workspace-archive');
  const rejected=await fetch(base+'/browser',{method:'POST',headers:{cookie:'karvin_session=alice',origin:'https://attacker.example'}});assert.equal(rejected.status,403);
  const accepted=await (await fetch(base+'/browser',{method:'POST',headers:{cookie:'karvin_session=alice',authorization:'Bearer should-not-cross',origin:base}})).json();
  assert.equal(accepted.id,'alice');assert.equal(accepted.path,'/browser');assert.equal(accepted.cookie,'');assert.equal(accepted.authorization,'');assert.equal(accepted.origin,`http://127.0.0.1:${hubs.get('alice').port}`);
 }finally{await close(proxy);await close(agent);for(const {server} of hubs.values())await close(server);}
});

test('upstream page branding keeps the original structure while replacing visible Cline identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'karvin-rebrand-'));
 const write=async(path,body)=>{const full=join(root,path);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,body);};
 try{
  await write('apps/cline-hub/src/webview/index.html','<title>Cline Hub</title>');
  await write('apps/cline-hub/src/webview/src/App.tsx','Cline Hub src="/cline-logo-filled.svg" https://github.com/cline/cline/issues/new');
  await write('apps/cline-hub/src/webview/src/components/branding.tsx','title="Cline Hub"');
  await write('apps/cline-hub/src/webview/src/vscode.ts','Disconnected from the Cline Hub server.');
  await write('apps/cline-hub/src/server/http.ts','Cline Hub webview is not built. Run `bun run build:webview` from apps/cline-hub.');
  await write('apps/cline-hub/src/server.ts',`const PUBLIC_BROWSER_PATHS = new Set([\n\t"/version",\n\t"/icon.png",\n\t"/icon.svg",\n\t"/icon.ico",\n\t"/32x32.png",\n\t"/cline-logo-filled.svg",\n\t"/favicon.svg",\n]);\nCline Hub dashboard`);
  for(const name of ['cline-logo-filled.svg','icon.png','icon.ico','32x32.png'])await write(`apps/cline-hub/src/webview/public/${name}`,'old icon');
  rebrandClineHub(root);
  assert.equal(await readFile(join(root,'apps/cline-hub/src/webview/index.html'),'utf8'),'<title>KARVIN AI</title>');
  assert.match(await readFile(join(root,'apps/cline-hub/src/webview/src/App.tsx'),'utf8'),/KARVIN AI src="\/karvin-mark\.svg" https:\/\/github\.com\/njtmyz022-create\/karven-ai\/issues\/new/);
  assert.equal(await readFile(join(root,'apps/cline-hub/src/webview/src/components/branding.tsx'),'utf8'),'title="KARVIN AI"');
  const server=await readFile(join(root,'apps/cline-hub/src/server.ts'),'utf8');assert.match(server,/"\/icon\.svg"/);assert.match(server,/"\/favicon\.svg"/);assert.doesNotMatch(server,/icon\.png|icon\.ico|32x32\.png|cline-logo-filled|Cline Hub/);
  assert.match(await readFile(join(root,'apps/cline-hub/src/webview/public/favicon.svg'),'utf8'),/<svg/);
  for(const name of ['cline-logo-filled.svg','icon.png','icon.ico','32x32.png'])await assert.rejects(readFile(join(root,'apps/cline-hub/src/webview/public',name)));
 }finally{await rm(root,{recursive:true,force:true});}
});
