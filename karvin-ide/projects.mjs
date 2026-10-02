import {resolve,relative,dirname,sep} from 'node:path';
import {mkdir,readdir,lstat,readFile,writeFile,realpath,unlink,chown,chmod} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const OMIT=new Set(['node_modules','.git','.env','.karvin-runtime','data','.cline']);
export const MAX_FILE_BYTES=100000;
export function safeRelative(path){
 if(typeof path!=='string'||!path||path.length>500||path.includes('\\')||path.includes('\0')||path.startsWith('/')||path.split('/').some(x=>x==='..'||x==='.'||!x||OMIT.has(x)||x.startsWith('.env')))throw new Error('Invalid or protected project path');
 return path;
}
export class ProjectStore {
 constructor(root,{uid,gid=uid}={}){this.root=resolve(root);this.uid=uid;this.gid=gid;}
 async own(path,mode){if(this.uid!==undefined){await chown(path,this.uid,this.gid);if(mode!==undefined)await chmod(path,mode);}}
 directory(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid project ID');return resolve(this.root,id);}
 async create(id){await mkdir(this.directory(id),{recursive:true,mode:0o700});await this.own(this.root,0o700);await this.own(this.directory(id),0o700);}
 async path(id,path,{create=false}={}){
  safeRelative(path);const root=this.directory(id),dest=resolve(root,path);
  if(relative(root,dest).startsWith(`..${sep}`))throw new Error('Path escapes project');
  let current=root;
  for(const part of path.split('/')){
   current=resolve(current,part);
   try{const s=await lstat(current);if(s.isSymbolicLink())throw new Error('Symbolic links are not supported');}
   catch(e){if(e.code!=='ENOENT')throw e;if(!create)throw e;}
  }
  const rootReal=await realpath(root);if(rootReal!==root)throw new Error('Project root cannot be a symbolic link');
  return dest;
 }
 async list(id){const root=this.directory(id),items=[];
  const walk=async(dir,prefix='')=>{for(const item of await readdir(dir,{withFileTypes:true})){if(OMIT.has(item.name)||item.name.startsWith('.env')||item.isSymbolicLink())continue;const path=prefix+item.name;if(item.isDirectory()){if(path.split('/').length<12)await walk(resolve(dir,item.name),`${path}/`);}else if(item.isFile()){const s=await lstat(resolve(dir,item.name));items.push({path,bytes:s.size});}if(items.length>=500)return;}};
  await walk(root);return items.slice(0,500).sort((a,b)=>a.path.localeCompare(b.path));
 }
 async read(id,path){const dest=await this.path(id,path);const stat=await lstat(dest);if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw new Error('Only text files up to 100 KB can be opened');const text=await readFile(dest,'utf8');if(text.includes('\0'))throw new Error('Binary files are not supported');return text;}
 async optionalRead(id,path){try{return await this.read(id,path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async write(id,path,text){if(typeof text!=='string'||Buffer.byteLength(text)>MAX_FILE_BYTES||text.includes('\0'))throw new Error('File must be UTF-8 text up to 100 KB');const dest=await this.path(id,path,{create:true});const parent=dirname(dest);await mkdir(parent,{recursive:true,mode:0o700});await this.own(this.root,0o700);await this.own(this.directory(id),0o700);let current=parent;while(current!==this.directory(id)&&current.startsWith(`${this.directory(id)}${sep}`)){await this.own(current,0o700);current=dirname(current);}await writeFile(dest,text,{flag:'w',mode:0o600});await this.own(dest,0o600);return {path,bytes:Buffer.byteLength(text)};}
 async remove(id,path){await unlink(await this.path(id,path));}
 async manifest(id){return this.list(id);}
}
export function contentHash(text){return createHash('sha256').update(text??'[missing]').digest('hex');}
export function requestId(){return randomUUID();}
