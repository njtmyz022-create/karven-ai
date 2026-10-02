import http from 'node:http';

// The public proxy keeps the app and IDE on one origin. In accounts mode it
// resolves the signed-in user through the private API and opens that user's
// isolated code-server worker. The application API continues to receive the
// user's own session cookie and applies its normal tenant checks.
export function createIDEProxy({idePort,agentPort,gate=null,agentToken=null,editorToken=null,ideManager=null,resolveUser=null,healthCheck=null}){
 const editorSessions=new Map();
 const headers=req=>({...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':req.headers['x-forwarded-proto']||'http'});
 async function editorHeaders(req,target){
  if(!target.editorToken)return headers(req);
  let cached=editorSessions.get(target.userId||'single');
  if(!cached||cached.port!==target.port){
   const pending=(async()=>{
    const response=await fetch(`http://127.0.0.1:${target.port}/login`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:target.editorToken}),redirect:'manual',signal:AbortSignal.timeout(10000)});
    const cookie=response.headers.get('set-cookie')?.split(';')[0];await response.body?.cancel();
    if(response.status!==302||!cookie)throw new Error('Editor session unavailable');
    return {port:target.port,cookie};
   })();
   editorSessions.set(target.userId||'single',{port:target.port,pending});
   try{cached=await pending;editorSessions.set(target.userId||'single',cached);}catch(error){editorSessions.delete(target.userId||'single');throw error;}
  }else if(cached.pending)cached=await cached.pending;
  return {...headers(req),cookie:cached.cookie};
 }
 const agentRoute=url=>({port:agentPort,path:url});
 async function authenticatedIDE(req){
  if(!ideManager||!resolveUser)return {port:idePort,path:req.url.slice(4),editorToken,userId:'single'};
  const user=await resolveUser(req);if(!user)return null;
  const worker=await ideManager.get(user);return {port:worker.port,path:req.url.slice(4),editorToken:worker.password,userId:user.id,user};
 }
 function loginRedirect(req,res){res.writeHead(302,{Location:`/login?next=${encodeURIComponent(req.url)}`,'Cache-Control':'no-store'});res.end();}
 const server=http.createServer(async(req,res)=>{
  if(gate&&req.url!=='/healthz'&&!await gate.allow(req)){res.writeHead(403);return res.end('This workspace requires its private GitHub Codespaces port.');}
  if(req.url.startsWith('/api/internal/')){res.writeHead(404);return res.end('Not found');}
  if(req.url==='/healthz'){
   const editorOK=healthCheck?await healthCheck():await (async()=>{try{const response=await fetch(`http://127.0.0.1:${idePort}/healthz`,{signal:AbortSignal.timeout(1500)});await response.body?.cancel();return response.ok;}catch{return false;}})();
   const missionsOK=await (async()=>{try{const response=await fetch(`http://127.0.0.1:${agentPort}/`,{signal:AbortSignal.timeout(1500),redirect:'manual'});await response.body?.cancel();return response.ok;}catch{return false;}})();
   const ready=Boolean(editorOK&&missionsOK);res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({name:'KARVIN IDE',status:ready?'ready':'unavailable',services:{editor:editorOK,missions:missionsOK}}));
  }
  const isIDE=req.url==='/ide'||req.url.startsWith('/ide/');
  if(isIDE){
   let target;try{target=await authenticatedIDE(req);}catch{res.writeHead(503);return res.end('Your isolated workspace is starting. Refresh shortly.');}
   if(!target)return loginRedirect(req,res);
   if(req.url==='/ide'){res.writeHead(302,{Location:'/ide/'});return res.end();}
   if(req.url.startsWith('/ide/proxy/')){
    // A development server can only be exposed through the authenticated
    // user's IDE worker. code-server validates every preview request itself.
   }
   let forwarded;try{forwarded=await editorHeaders(req,target);}catch{res.writeHead(503);return res.end('Editor session is starting. Refresh shortly.');}
   return forward(req,res,target,forwarded);
  }
  if(req.url==='/ide'){res.writeHead(302,{Location:'/ide/'});return res.end();}
  const target=agentRoute(req.url),forwarded=headers(req);
  if(gate&&agentToken)forwarded.authorization=`Bearer ${agentToken}`;
  return forward(req,res,target,forwarded);
 });
 function forward(req,res,target,forwarded){
  const upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,method:req.method,headers:forwarded},response=>{
   const h={...response.headers};
   if(target.port!==agentPort&&h.location?.startsWith('/')&&!h.location.startsWith('/ide/'))h.location='/ide'+h.location;
   if(ideManager&&target.port!==agentPort)delete h['set-cookie'];
   res.writeHead(response.statusCode,h);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('KARVIN IDE is starting. Refresh shortly.');});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 }
 server.on('upgrade',async(req,socket,head)=>{
  if(gate&&!await gate.allow(req))return socket.destroy();
  if(!req.url.startsWith('/ide/'))return socket.destroy();
  let target;try{target=await authenticatedIDE(req);}catch{return socket.destroy();}if(!target)return socket.destroy();
  let forwarded;try{forwarded=await editorHeaders(req,target);}catch{return socket.destroy();}
  const upstream=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,headers:forwarded});
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);
   const guard=gate?setInterval(async()=>{if(!await gate.verify()){socket.destroy();remote.destroy();}},15000):null;
   const sessionGuard=ideManager&&resolveUser?setInterval(async()=>{try{const current=await resolveUser(req);if(!current||current.id!==target.userId){socket.destroy();remote.destroy();}}catch{socket.destroy();remote.destroy();}},15000):null;
   socket.on('close',()=>{clearInterval(guard);clearInterval(sessionGuard);});socket.pipe(remote).pipe(socket);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
  });
  upstream.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);response.resume();});
  upstream.on('error',()=>socket.destroy());upstream.end();
 });
 return server;
}
