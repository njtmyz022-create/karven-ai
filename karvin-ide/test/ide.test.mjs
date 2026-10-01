import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createIDEProxy} from '../ide-proxy.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>s.close(r));
test('IDE health detects a stopped editor or mission service',async()=>{
 let editorReady=true;
 const ide=http.createServer((req,res)=>{res.writeHead(editorReady?200:503);res.end('editor');});
 const agent=http.createServer((req,res)=>res.end('mission control'));
 const proxy=createIDEProxy({idePort:await listen(ide),agentPort:await listen(agent)}),base=`http://127.0.0.1:${await listen(proxy)}`;
 let agentClosed=false;
 try{
  assert.equal((await fetch(base+'/healthz')).status,200);
  editorReady=false;
  assert.equal((await fetch(base+'/healthz')).status,503);
  editorReady=true;
  await close(agent);agentClosed=true;
  assert.equal((await fetch(base+'/healthz')).status,503);
 }finally{await close(proxy);if(!agentClosed)await close(agent);await close(ide);}
});
test('IDE proxy preserves login redirects, cookies and WebSocket authentication rejection',async()=>{
 const ide=http.createServer((req,res)=>{if(req.url==='/'){res.writeHead(302,{location:'/login'});res.end();}else{res.setHeader('Set-Cookie','session=test; HttpOnly; Path=/');res.end('Sign in to KARVIN IDE');}});
 ide.on('upgrade',(req,socket)=>socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'));
 const agent=http.createServer((req,res)=>res.end('mission control'));
 const proxy=createIDEProxy({idePort:await listen(ide),agentPort:await listen(agent)}),port=await listen(proxy),base=`http://127.0.0.1:${port}`;
 try{
  assert.equal((await fetch(base+'/')).status,200);
  const redirect=await fetch(base+'/ide/',{redirect:'manual'});assert.equal(redirect.headers.get('location'),'/ide/login');
  const login=await fetch(base+'/ide/login');assert.match(await login.text(),/KARVIN IDE/);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const response=await new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>s.write('GET /ide/ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));let data='';s.on('data',b=>data+=b);s.on('end',()=>resolve(data));s.on('error',reject);});assert.match(response,/401 Unauthorized/);
 }finally{await close(proxy);await close(agent);await close(ide);}
});

test('GitHub gateway fails closed outside private Codespaces ports',async()=>{
 const {createCodespacesGate}=await import('../codespaces-gateway.mjs');
 assert.throws(()=>createCodespacesGate({}),/requires a Codespace/);
 let visibility='private';
 const gate=createCodespacesGate({CODESPACES:'true',CODESPACE_NAME:'example',PORT:'3000'},async()=>[{sourcePort:3000,visibility}]);
 assert.equal(await gate.allow({headers:{host:'example-3000.app.github.dev'}}),true);
 // Codespaces' private forwarding gateway rewrites Host. Privacy is checked
 // against GitHub's port metadata, so the incoming Host header is not trusted.
 assert.equal(await gate.allow({headers:{host:'attacker.example'}}),true);
 visibility='public';assert.equal(await gate.verify(),false);
 const broken=createCodespacesGate({CODESPACES:'true',CODESPACE_NAME:'example'},async()=>{throw new Error('offline');});assert.equal(await broken.verify(),false);
});
test('private gateway injects internal API auth and denies unverified HTTP and WebSockets',async()=>{
 let allowed=true;
 const ide=http.createServer((req,res)=>res.end('editor'));
 const agent=http.createServer((req,res)=>{res.end(req.headers.authorization||'missing');});
 const gate={allow:async()=>allowed,verify:async()=>allowed};
 const proxy=createIDEProxy({idePort:await listen(ide),agentPort:await listen(agent),gate,agentToken:'internal-only'}),port=await listen(proxy),base=`http://127.0.0.1:${port}`;
 try{assert.equal(await (await fetch(base+'/api/health')).text(),'Bearer internal-only');allowed=false;assert.equal((await fetch(base+'/api/health')).status,403);assert.equal((await fetch(base+'/ide/')).status,403);}finally{await close(proxy);await close(agent);await close(ide);}
});
test('private gateway opens password-protected editor with an internal session',async()=>{
 let logins=0;
 const ide=http.createServer(async(req,res)=>{if(req.url==='/login'){let body='';for await(const chunk of req)body+=chunk;assert.equal(new URLSearchParams(body).get('password'),'internal-secret');logins++;res.writeHead(302,{'set-cookie':'code-server-session=internal; HttpOnly; Path=/','location':'/'});res.end();}else{res.writeHead(req.headers.cookie==='code-server-session=internal'?200:401);res.end('editor');}});
 const agent=http.createServer((req,res)=>res.end('missions'));
 const proxy=createIDEProxy({idePort:await listen(ide),agentPort:await listen(agent),gate:{allow:async()=>true,verify:async()=>true},editorToken:'internal-secret'}),base=`http://127.0.0.1:${await listen(proxy)}`;
 try{assert.equal((await fetch(base+'/ide/')).status,200);assert.equal((await fetch(base+'/ide/')).status,200);assert.equal(logins,1);}finally{await close(proxy);await close(agent);await close(ide);}
});
