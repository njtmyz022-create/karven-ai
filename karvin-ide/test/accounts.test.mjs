import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createKarvinServer} from '../server.mjs';

const root=await mkdtemp(fileURLToPath(new URL('./accounts-data-',import.meta.url)));
const codeModel={async *stream(){yield {type:'tool-call-delta',index:0,toolCallId:'done',toolName:'complete_task',input:{summary:'Task completed in this account.'}};yield {type:'finish',reason:'tool-calls'};}};
let app,base,ownerCookie,bobCookie;
test.before(async()=>{app=createKarvinServer({port:0,dataDir:root,authMode:'accounts',ownerEmail:'alice@example.com',allowSignup:false,internalToken:'internal-test-token-not-user-facing',codingReady:true,codeModel});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;});
test.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});

async function call(path,{method='GET',cookie,csrf,body,headers:extraHeaders={}}={}){
 const headers={'Content-Type':'application/json',...extraHeaders};if(cookie)headers.Cookie=cookie;if(csrf)headers['X-CSRF-Token']=csrf;
 const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const type=response.headers.get('content-type')||'';const data=type.includes('application/json')?await response.json():await response.text();
 const setCookie=response.headers.get('set-cookie');return {response,data,setCookie};
}
const cookieOf=value=>value?.split(';',1)[0];
async function createAccount(body){const result=await call('/api/auth/register',{method:'POST',body});assert.equal(result.response.status,201,JSON.stringify(result.data));return {cookie:cookieOf(result.setCookie),csrf:result.data.csrf,user:result.data.user};}

test('accounts get isolated sessions, projects, tasks and encrypted provider settings',async()=>{
 const status=await call('/api/auth/status');assert.deepEqual(status.data,{enabled:true,registrationOpen:true,ownerSetupReady:true,hasOwner:false});
 assert.equal((await call('/api/auth/register',{method:'POST',body:{name:'Wrong Owner',email:'wrong@example.com',password:'safe-password-for-wrong'}})).response.status,403);
 const alice=await createAccount({name:'Alice Owner',email:'ALICE@example.com',password:'safe-password-for-alice'});
 assert.equal(alice.user.role,'owner');assert.equal((await fetch(`${base}/workspace`,{redirect:'manual'})).status,404);
 ownerCookie=alice.cookie;assert.match(ownerCookie,/karvin_session=/);assert.equal((await call('/api/auth/me',{cookie:ownerCookie})).response.status,200);
 const secureSignup=await call('/api/auth/login',{method:'POST',body:{email:'alice@example.com',password:'safe-password-for-alice'},headers:{'x-forwarded-proto':'https'}});
 assert.equal(secureSignup.response.status,200);
 const secureCookie=secureSignup.setCookie;assert.match(secureCookie,/HttpOnly/);assert.match(secureCookie,/SameSite=Lax/);assert.match(secureCookie,/Secure/);

 assert.equal((await call('/api/auth/register',{method:'POST',body:{name:'Bob Member',email:'bob@example.com',password:'safe-password-for-bob-123'}})).response.status,403);
 const inviteResult=await call('/api/admin/invites',{method:'POST',cookie:ownerCookie,csrf:alice.csrf,body:{email:'bob@example.com',role:'member'}});assert.equal(inviteResult.response.status,201);assert.match(inviteResult.data.invite.path,/invite=/);
 const inviteToken=new URL(inviteResult.data.invite.path,'http://karvin.local').searchParams.get('invite');
 const bob=await createAccount({name:'Bob Member',email:'bob@example.com',password:'safe-password-for-bob-123',inviteToken});bobCookie=bob.cookie;assert.equal(bob.user.role,'member');
 assert.equal((await call('/api/admin/users',{cookie:bob.cookie})).response.status,403);
 assert.equal((await call('/api/admin/invites',{method:'POST',cookie:bob.cookie,csrf:bob.csrf,body:{email:'mallory@example.com',role:'member'}})).response.status,403);
 assert.equal((await call('/api/projects',{method:'POST',cookie:bob.cookie,body:{name:'No CSRF'}})).response.status,403);

 const created=await call('/api/projects',{method:'POST',cookie:ownerCookie,csrf:alice.csrf,body:{name:'Alice private project'}});assert.equal(created.response.status,201);const projectId=created.data.id;
 const write=await call(`/api/projects/${projectId}/file`,{method:'PUT',cookie:ownerCookie,csrf:alice.csrf,body:{path:'src/private.js',content:'export const owner = "Alice";'}});assert.equal(write.response.status,200);
 const aliceList=await call('/api/projects',{cookie:ownerCookie}),bobList=await call('/api/projects',{cookie:bobCookie});assert.equal(aliceList.data.length,1);assert.deepEqual(bobList.data,[]);
 assert.equal((await call(`/api/projects/${projectId}/file?path=src/private.js`,{cookie:bobCookie})).response.status,404);

 const task=await call('/api/tasks',{method:'POST',cookie:ownerCookie,csrf:alice.csrf,body:{kind:'coding',projectId,mode:'plan',goal:'Inspect this private project'}});assert.equal(task.response.status,202);
 for(let i=0;i<100;i++){const detail=await call(`/api/tasks/${task.data.id}`,{cookie:ownerCookie});if(detail.data.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal((await call(`/api/tasks/${task.data.id}`,{cookie:bobCookie})).response.status,404);
 assert.deepEqual((await call('/api/tasks',{cookie:bobCookie})).data,[]);

 const key='alice-only-provider-secret-8391';const saved=await call('/api/settings',{method:'POST',cookie:ownerCookie,csrf:alice.csrf,body:{LLM_API_KEY:key,LLM_MODEL:'fixture-model'}});assert.equal(saved.response.status,200);
 const aliceSettings=await call('/api/settings',{cookie:ownerCookie}),bobSettings=await call('/api/settings',{cookie:bobCookie});assert.equal(aliceSettings.data.LLM_API_KEY_CONFIGURED,true);assert.equal(aliceSettings.data.LLM_API_KEY,undefined);assert.equal(bobSettings.data.LLM_API_KEY_CONFIGURED,false);
 assert.equal((await call('/api/billing/status',{cookie:ownerCookie})).data.enabled,false);
 const admin=await call('/api/admin/users',{cookie:ownerCookie});assert.equal(admin.response.status,200);assert.equal(admin.data.total,2);
});

test('passwords and session identifiers are not stored as plaintext',async()=>{
 const db=new DatabaseSync(`${root}/tasks.sqlite`);const users=db.prepare('SELECT email,password_hash FROM users ORDER BY email').all();
 assert.equal(users[0].password_hash.includes('safe-password'),false);
 const sessions=db.prepare('SELECT token_hash FROM sessions').all();assert.ok(sessions.length>=3);assert.equal(sessions.some(s=>s.token_hash.includes('karvin_session=')),false);
 const settings=db.prepare('SELECT sealed FROM user_settings').get();assert.ok(settings);assert.equal(settings.sealed.includes('alice-only-provider-secret-8391'),false);const invite=db.prepare('SELECT token_hash,accepted_at FROM invites').get();assert.ok(invite.token_hash);assert.ok(invite.accepted_at);assert.equal((await stat(`${root}/tasks.sqlite`)).mode&0o777,0o600);db.close();
 const keyStat=await stat(`${root}/.karvin-key`);assert.equal(keyStat.mode&0o777,0o600);
});

test('suspending a user revokes sessions and account routes remain private',async()=>{
 const list=await call('/api/admin/users',{cookie:ownerCookie});assert.equal(list.response.status,200);
 const bob=list.data.users.find(user=>user.email==='bob@example.com');
 const ownerSession=await call('/api/auth/me',{cookie:ownerCookie});let ownerCsrf=ownerSession.data.csrf;
 const oldOwnerCookie=ownerCookie,changedPassword=await call('/api/auth/password',{method:'POST',cookie:ownerCookie,csrf:ownerCsrf,body:{currentPassword:'safe-password-for-alice',newPassword:'updated-password-for-alice-2026'}});assert.equal(changedPassword.response.status,200);ownerCookie=cookieOf(changedPassword.setCookie);ownerCsrf=changedPassword.data.csrf;assert.equal((await call('/api/auth/me',{cookie:oldOwnerCookie})).response.status,401);assert.equal((await call('/api/auth/login',{method:'POST',body:{email:'alice@example.com',password:'safe-password-for-alice'}})).response.status,401);assert.equal((await call('/api/auth/login',{method:'POST',body:{email:'alice@example.com',password:'updated-password-for-alice-2026'}})).response.status,200);
 const changed=await call(`/api/admin/users/${bob.id}`,{method:'PATCH',cookie:ownerCookie,csrf:ownerCsrf,body:{status:'suspended'}});assert.equal(changed.response.status,200);assert.equal(changed.data.user.status,'suspended');
 assert.equal((await call('/api/projects',{cookie:bobCookie})).response.status,401);
});

test('private Codespaces bootstrap lets the first account become owner without owner-email configuration',async()=>{
 const bootstrap=createKarvinServer({port:0,dataDir:`${root}/codespaces-bootstrap`,authMode:'accounts',ownerEmail:'',allowSignup:false,allowOwnerBootstrap:true,internalToken:'internal-bootstrap-test-key-only'});
 await new Promise(resolve=>bootstrap.server.listen(0,'127.0.0.1',resolve));const address=`http://127.0.0.1:${bootstrap.server.address().port}`;
 try{
  const status=await fetch(`${address}/api/auth/status`);assert.equal((await status.json()).registrationOpen,true);
  const response=await fetch(`${address}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Private Workspace Owner',email:'owner@example.com',password:'private-owner-password-2026'})});assert.equal(response.status,201);assert.equal((await response.json()).user.role,'owner');
 }finally{await bootstrap.close();}
});
