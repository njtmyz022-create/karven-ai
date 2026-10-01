import http from 'node:http';

// Regular deployments retain code-server auth. Codespaces mode requires a private GitHub gateway on every request.
export function createIDEProxy({idePort,agentPort,gate=null,agentToken=null,editorToken=null}) {
 let editorSession;
 async function editorHeaders(req){
  if(!editorToken)return headers(req);
  editorSession??=(async()=>{
   const response=await fetch(`http://127.0.0.1:${idePort}/login`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:editorToken}),redirect:'manual',signal:AbortSignal.timeout(10000)});
   const cookie=response.headers.get('set-cookie')?.split(';')[0];await response.body?.cancel();
   if(response.status!==302||!cookie)throw new Error('Editor session unavailable');
   return cookie;
  })().catch(error=>{editorSession=null;throw error;});
  return {...headers(req),cookie:await editorSession};
 }
 const route = url => url.startsWith('/ide/') ? {port:idePort,path:url.slice(4)} : {port:agentPort,path:url};
 const headers = req => ({...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':req.headers['x-forwarded-proto']||'http'});
 const server=http.createServer(async(req,res)=>{
  if(gate&&req.url!=='/healthz'&&!await gate.allow(req)){res.writeHead(403);return res.end('This workspace requires its private GitHub Codespaces port.');}
  if(req.url==='/ide'){res.writeHead(302,{Location:'/ide/'});return res.end();}
  if(req.url==='/healthz'){
   const checks=await Promise.all([['editor',idePort,'/healthz'],['missions',agentPort,'/']].map(async([name,port,path])=>{
    try{const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(2000),redirect:'manual'});await response.body?.cancel();return [name,response.ok];}catch{return [name,false];}
   }));
   const ready=checks.every(([,ok])=>ok);
   res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
   return res.end(JSON.stringify({name:'KARVIN IDE',status:ready?'ready':'unavailable',services:Object.fromEntries(checks)}));
  }
  const target=route(req.url);let forwarded;try{forwarded=target.port===idePort?await editorHeaders(req):headers(req);}catch{res.writeHead(503);return res.end('Editor is starting. Refresh shortly.');}
  const upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,method:req.method,headers:{...forwarded,...(target.port===agentPort&&agentToken?{authorization:`Bearer ${agentToken}`}:{})}},response=>{
   const h={...response.headers};
   if(target.port===idePort&&h.location?.startsWith('/')&&!h.location.startsWith('/ide/'))h.location='/ide'+h.location;
   res.writeHead(response.statusCode,h);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('KARVIN IDE is starting. Refresh shortly.');});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('upgrade',async(req,socket,head)=>{
  if(gate&&!await gate.allow(req))return socket.destroy();
  if(!req.url.startsWith('/ide/'))return socket.destroy();
  const target=route(req.url);let forwarded;try{forwarded=await editorHeaders(req);}catch{return socket.destroy();}
  const upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,headers:forwarded});
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);
   const guard=gate?setInterval(async()=>{if(!await gate.verify()){socket.destroy();remote.destroy();}},15000):null;
   socket.on('close',()=>clearInterval(guard));socket.pipe(remote).pipe(socket);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
  });
  upstream.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);response.resume();});
  upstream.on('error',()=>socket.destroy());upstream.end();
 });
 return server;
}
