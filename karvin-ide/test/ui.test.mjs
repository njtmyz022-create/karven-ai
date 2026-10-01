import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createKarvinServer} from '../server.mjs';
import {unzipSync,strFromU8} from 'fflate';
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check){for(let n=0;n<300;n++){if(check())return;await pause();}assert.fail('UI state did not arrive');}
test('dashboard interaction: create project, Cline approval, results, source, follow-up and ZIP',async()=>{
 const dir=await mkdtemp(fileURLToPath(new URL('./ui-data-',import.meta.url)));
 const model={async *stream(request){const count=request.messages.flatMap(m=>m.content).filter(p=>p.type==='tool-result').length;yield {type:'tool-call-delta',index:0,toolCallId:`ui-${count}`,toolName:count?'complete_task':'write_file',input:count?{summary:'Created Karvin greeting. Tests not run.'}:{path:'hello.txt',content:'Hello from Karvin'}};yield {type:'finish',reason:'tool-calls'};}};
 const app=createKarvinServer({port:0,dataDir:dir,codingReady:true,codeModel:model});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:base,runScripts:'outside-only'}),window=dom.window,$=id=>window.document.getElementById(id);
 const runtimeErrors=[];window.addEventListener('error',event=>runtimeErrors.push(event.error));window.fetch=(url,options)=>fetch(new URL(url,base),options);
 const connections=[];
 window.EventSource=class{constructor(url){this.controller=new AbortController();connections.push(this);void(async()=>{try{const response=await fetch(new URL(url,base),{signal:this.controller.signal});let buffer='';const decoder=new TextDecoder();for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});const items=buffer.split('\n\n');buffer=items.pop();for(const item of items){const line=item.split('\n').find(x=>x.startsWith('data: '));if(line)this.onmessage?.({data:line.slice(6)});}}}catch(error){if(!this.controller.signal.aborted)this.onerror?.(error);}})();}close(){this.controller.abort();}};
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 try{
  window.eval(`(function(){${script}\n})()`);await until(()=>$('config').textContent.includes('not configured'));
  $('project-name').value='Karvin UI project';$('create-project').click();await until(()=>$('project').value&&$('coding-fields').hidden===false);assert.equal($('url').required,false);assert.equal($('run').disabled,false);
  $('mode').value='act';$('goal').value='Create hello.txt';$('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>$('approval-panel').hidden===false);
  assert.match($('approval-content').textContent,/Hello from Karvin/);assert.match($('approval-content').textContent,/New file/);
  const projectId=$('project').value;assert.equal((await fetch(`${base}/api/projects/${projectId}/file?path=hello.txt`)).status,404);
  $('approve').click();await until(()=>$('status').textContent==='COMPLETED');await until(()=>$('files').textContent.includes('hello.txt'));
  assert.equal($('approval-panel').hidden,true);assert.match($('result').textContent,/Created Karvin greeting/);assert.equal($('followup').hidden,false);
  $('files').querySelector('button').click();await until(()=>$('file-content').value==='Hello from Karvin');
  const archiveResponse=await fetch(`${base}/api/projects/${projectId}/export`);assert.equal(archiveResponse.status,200);const zip=unzipSync(new Uint8Array(await archiveResponse.arrayBuffer()));assert.equal(strFromU8(zip['hello.txt']),'Hello from Karvin');
  $('followup').click();assert.equal($('followup-notice').hidden,false);assert.equal($('mode').value,'act');$('clear-followup').click();assert.equal($('followup-notice').hidden,true);
  assert.deepEqual(runtimeErrors,[]);
 }catch(error){console.error('UI verification failed:',error.message);throw error;}finally{for(const connection of connections)connection.close();await pause();await pause();dom.window.close();await app.close();await rm(dir,{recursive:true,force:true});}
});
