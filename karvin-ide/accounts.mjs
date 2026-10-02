import {createHash,createCipheriv,createDecipheriv,randomBytes,scrypt as scryptCallback,timingSafeEqual,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {existsSync,openSync,writeSync,closeSync,readFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';

const scrypt=promisify(scryptCallback);
const SESSION_COOKIE='karvin_session';
const SESSION_TTL=14*24*60*60*1000;
const PASSWORD_MIN=12;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digest(value){return createHash('sha256').update(value).digest('hex');}
function safeEqual(left,right){const a=Buffer.from(left||''),b=Buffer.from(right||'');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);}
function cookieValue(header,name=SESSION_COOKIE){for(const part of (header||'').split(';')){const i=part.indexOf('=');if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return '';}

function loadEncryptionKey(dataDir,provided){
 if(provided){const key=/^[a-f\d]{64}$/i.test(provided)?Buffer.from(provided,'hex'):Buffer.from(provided,'base64');if(key.length!==32)throw new Error('DATA_ENCRYPTION_KEY must encode exactly 32 bytes');return key;}
 const path=resolve(dataDir,'.karvin-key');
 if(existsSync(path)){const key=readFileSync(path);if(key.length!==32)throw new Error('Stored Karvin encryption key is invalid');chmodSync(path,0o600);return key;}
 const key=randomBytes(32);let fd;
 try{fd=openSync(path,'wx',0o600);writeSync(fd,key);closeSync(fd);chmodSync(path,0o600);return key;}
 catch(error){if(fd!==undefined)try{closeSync(fd);}catch{}if(error.code==='EEXIST'){const existing=readFileSync(path);if(existing.length===32)return existing;}throw error;}
}

export class AccountStore {
 constructor(db,{dataDir,encryptionKey=process.env.DATA_ENCRYPTION_KEY,clock=()=>Date.now()}={}){
  this.db=db;this.clock=clock;this.key=loadEncryptionKey(dataDir,encryptionKey);
  db.exec(`
   CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
    uid INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
   CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, sealed TEXT NOT NULL,
    updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
    role TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS invites_email ON invites(email,expires_at);
  `);
 }

 publicUser(user){return user?{id:user.id,email:user.email,name:user.display_name,role:user.role,status:user.status,createdAt:user.created_at}:null;}
 user(id){return this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(id));}
 runtimeUser(id){const user=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);return user?{...this.publicUser(user),uid:user.uid}:null;}
 countUsers(){return this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;}

 async register({email,name,password,inviteToken}){
  email=typeof email==='string'?email.trim().toLowerCase():'';
  name=typeof name==='string'?name.trim():'';
  if(email.length>254||!EMAIL_RE.test(email))throw new Error('Enter a valid email address');
  if(name.length<1||name.length>80)throw new Error('Name must be 1–80 characters');
  if(typeof password!=='string'||password.length<PASSWORD_MIN||password.length>128)throw new Error(`Password must be ${PASSWORD_MIN}–128 characters`);
  const salt=randomBytes(16),derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const id=randomUUID(),createdAt=new Date(this.clock()).toISOString();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(this.db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw Object.assign(new Error('An account with this email already exists'),{status:409});
   const count=this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
   const maxUid=this.db.prepare('SELECT COALESCE(MAX(uid),19999) AS uid FROM users').get().uid;
   const uid=maxUid+1;if(uid>59999)throw new Error('User capacity reached on this single-host installation');
   let invitation=null;
   if(inviteToken){
    invitation=this.db.prepare('SELECT * FROM invites WHERE token_hash=? AND email=? AND accepted_at IS NULL AND expires_at>?').get(digest(inviteToken),email,this.clock());
    if(!invitation)throw Object.assign(new Error('This invitation is invalid, expired, already used, or belongs to another email'),{status:403});
   }
   const role=count===0?'owner':(invitation?.role||'member');
   this.db.prepare('INSERT INTO users(id,email,display_name,password_hash,role,status,uid,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,email,name,`${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`,role,'active',uid,createdAt);
   if(invitation){const used=this.db.prepare('UPDATE invites SET accepted_at=? WHERE id=? AND accepted_at IS NULL AND expires_at>?').run(this.clock(),invitation.id,this.clock());if(used.changes!==1)throw Object.assign(new Error('This invitation has already been used'),{status:409});}
   this.db.exec('COMMIT');
   return this.user(id);
  }catch(error){this.db.exec('ROLLBACK');if(error.code==='SQLITE_CONSTRAINT_UNIQUE')throw Object.assign(new Error('An account with this email already exists'),{status:409});throw error;}
 }

 async verifyPassword(email,password){
  if(typeof email!=='string'||typeof password!=='string')return null;
  const user=this.db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if(!user||user.status!=='active')return null;
  const [saltHex,hashHex]=user.password_hash.split(':');
  const actual=Buffer.from(await scrypt(password,Buffer.from(saltHex,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024}));
  if(!safeEqual(actual,Buffer.from(hashHex,'hex')))return null;
  return this.publicUser(user);
 }

 async changePassword(userId,currentPassword,newPassword){
  if(typeof newPassword!=='string'||newPassword.length<PASSWORD_MIN||newPassword.length>128)throw new Error(`Password must be ${PASSWORD_MIN}–128 characters`);
  const user=this.db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!user)throw new Error('Account not found');
  const [saltHex,hashHex]=user.password_hash.split(':');const actual=Buffer.from(await scrypt(currentPassword||'',Buffer.from(saltHex,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024}));
  if(!safeEqual(actual,Buffer.from(hashHex,'hex')))throw Object.assign(new Error('Current password is incorrect'),{status:401});
  const salt=randomBytes(16),derived=await scrypt(newPassword,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(`${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`,userId);this.revokeUserSessions(userId);
 }

 createSession(userId){
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url'),now=this.clock(),expiresAt=now+SESSION_TTL;
  this.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(digest(token),userId,digest(csrf),csrf,expiresAt,new Date(now).toISOString());
  return {token,csrf,expiresAt,user:this.user(userId)};
 }

 sessionFromRequest(req){
  const token=cookieValue(req.headers.cookie);if(!token)return null;
  const session=this.db.prepare('SELECT s.token_hash AS session_hash,s.csrf_hash,s.csrf_token,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(digest(token));
  if(!session)return null;
  if(session.expires_at<=this.clock()||session.status!=='active'){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));return null;}
  return {token,user:this.publicUser(session),uid:session.uid,csrf:session.csrf_token,csrfHash:session.csrf_hash,expiresAt:session.expires_at};
 }

 verifyCsrf(session,provided){return Boolean(session&&safeEqual(session.csrfHash,digest(provided||'')));}
 revokeRequest(req){const token=cookieValue(req.headers.cookie);if(token)this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));}
 revokeUserSessions(userId){this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);}

 sealSettings(value){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
 }
 openSettings(sealed){
  const box=JSON.parse(sealed);if(box.v!==1)throw new Error('Unsupported encrypted settings version');
  const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(box.iv,'base64'));decipher.setAuthTag(Buffer.from(box.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));
 }
 getSettings(userId){const row=this.db.prepare('SELECT sealed FROM user_settings WHERE user_id=?').get(userId);return row?this.openSettings(row.sealed):{};}
 saveSettings(userId,value){this.db.prepare('INSERT INTO user_settings(user_id,sealed,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at').run(userId,this.sealSettings(value),new Date(this.clock()).toISOString());}

 listUsers(){return this.db.prepare('SELECT * FROM users ORDER BY created_at').all().map(user=>this.publicUser(user));}
 createInvite(actor,{email,role='member'}){
  email=typeof email==='string'?email.trim().toLowerCase():'';
  if(email.length>254||!EMAIL_RE.test(email))throw new Error('Enter a valid email address');
  if(!['member','admin'].includes(role))throw new Error('Invitations can only assign member or admin roles');
  if(actor.role!=='owner'&&role!=='member')throw Object.assign(new Error('Only the owner can invite administrators'),{status:403});
  if(this.db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw Object.assign(new Error('An account with this email already exists'),{status:409});
  if(this.db.prepare('SELECT 1 FROM invites WHERE email=? AND accepted_at IS NULL AND expires_at>?').get(email,this.clock()))throw Object.assign(new Error('An active invitation already exists for this email'),{status:409});
  const id=randomUUID(),token=randomBytes(32).toString('base64url'),now=this.clock(),expiresAt=now+7*24*60*60*1000;
  this.db.prepare('INSERT INTO invites(id,token_hash,email,role,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(id,digest(token),email,role,actor.id,new Date(now).toISOString(),expiresAt);
  return {id,email,role,token,createdAt:new Date(now).toISOString(),expiresAt};
 }
 listInvites(){return this.db.prepare('SELECT id,email,role,created_at,expires_at FROM invites WHERE accepted_at IS NULL AND expires_at>? ORDER BY created_at DESC').all(this.clock()).map(invite=>({id:invite.id,email:invite.email,role:invite.role,createdAt:invite.created_at,expiresAt:invite.expires_at}));}
 revokeInvite(id){return this.db.prepare('DELETE FROM invites WHERE id=? AND accepted_at IS NULL').run(id).changes>0;}
 updateUser(actor,targetId,{role,status}){
  const target=this.db.prepare('SELECT * FROM users WHERE id=?').get(targetId);if(!target)throw Object.assign(new Error('User not found'),{status:404});
  if(actor.role!=='owner'&&role!==undefined)throw Object.assign(new Error('Only the owner can change roles'),{status:403});
  if(role!==undefined&&!['owner','admin','member'].includes(role))throw new Error('Invalid user role');
  if(status!==undefined&&!['active','suspended'].includes(status))throw new Error('Invalid user status');
  if(target.role==='owner'&&(status==='suspended'||(role!==undefined&&role!=='owner')))throw new Error('The owner account cannot be demoted or suspended');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(target.role==='owner'&&role!=='owner'&&role!==undefined)throw new Error('At least one owner must remain');
   this.db.prepare('UPDATE users SET role=COALESCE(?,role),status=COALESCE(?,status) WHERE id=?').run(role??null,status??null,targetId);
   if(status==='suspended')this.revokeUserSessions(targetId);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.user(targetId);
 }

 cookie(token,{secure=false,clear=false}={}){
  return `${SESSION_COOKIE}=${clear?'':encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}${clear?'; Max-Age=0':`; Max-Age=${Math.floor(SESSION_TTL/1000)}`}`;
 }
 static cookieValue(header){return cookieValue(header);}
}
