import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createIDEProxy} from '../ide-proxy.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>s.close(r));
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
