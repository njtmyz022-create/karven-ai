import http from 'node:http';

// code-server authenticates HTTP and WebSocket requests itself. Never bypass it.
export function createIDEProxy({idePort,agentPort}) {
 const route = url => url.startsWith('/ide/') ? {port:idePort,path:url.slice(4)} : {port:agentPort,path:url};
 const headers = req => ({...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':req.headers['x-forwarded-proto']||'http'});
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/ide'){res.writeHead(302,{Location:'/ide/'});return res.end();}
  if(req.url==='/healthz'){
   const checks=await Promise.all([['editor',idePort,'/healthz'],['missions',agentPort,'/']].map(async([name,port,path])=>{
    try{const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(2000),redirect:'manual'});await response.body?.cancel();return [name,response.ok];}catch{return [name,false];}
   }));
   const ready=checks.every(([,ok])=>ok);
   res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
   return res.end(JSON.stringify({name:'KARVIN IDE',status:ready?'ready':'unavailable',services:Object.fromEntries(checks)}));
  }
  const target=route(req.url),upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,method:req.method,headers:headers(req)},response=>{
   const h={...response.headers};
   if(target.port===idePort&&h.location?.startsWith('/')&&!h.location.startsWith('/ide/'))h.location='/ide'+h.location;
   res.writeHead(response.statusCode,h);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('KARVIN IDE is starting. Refresh shortly.');});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('upgrade',(req,socket,head)=>{
  if(!req.url.startsWith('/ide/'))return socket.destroy();
  const target=route(req.url),upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,headers:headers(req)});
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);
   socket.pipe(remote).pipe(socket);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
  });
  upstream.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);response.resume();});
  upstream.on('error',()=>socket.destroy());upstream.end();
 });
 return server;
}
