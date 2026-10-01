import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {runAgent} from '../agent.mjs';
let fixture,url;
test.before(async()=>{
 fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><title>Karvin fixture</title><body><label>Product<input id="query"></label><button onclick="document.getElementById('result').textContent='Starter plan: $12 per month for '+document.getElementById('query').value">Search</button><p id="result">Enter a product</p></body></html>`);});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${fixture.address().port}`;
});
test.after(()=>new Promise(resolve=>fixture.close(resolve)));
test('real Chromium: fill, click, observe and extract evidence',async()=>{
 const events=[];let n=0;
 const result=await runAgent({url,goal:'Find Starter pricing',signal:new AbortController().signal,emit:e=>events.push(e),chromium,guard:async()=>{},decide:async({snapshot})=>{
  if(n++===0)return {operation:'fill',target:snapshot.elements.find(e=>e.editable).id,text:'Starter'};
  if(n===2){assert.equal(snapshot.elements.find(e=>e.editable).value,'Starter');return {operation:'click',target:snapshot.elements.find(e=>e.tag==='button').id};}
  assert.match(snapshot.text,/Starter plan: \$12 per month/);return {operation:'done',result:{plan:'Starter',price:12},evidence:['Starter plan: $12 per month']};
 }});
 assert.equal(result.result.price,12);assert.equal(result.steps,2);assert.equal(events.filter(e=>e.type==='observation').length,3);assert.ok(events[0].screenshot.length>100);
});
test('real Chromium: repeated unchanged actions cannot loop indefinitely',async()=>{
 await assert.rejects(runAgent({url,goal:'wait forever',signal:new AbortController().signal,emit:()=>{},chromium,guard:async()=>{},decide:async()=>({operation:'wait'})}),/Repeated/);
});
test('real Chromium: cancellation interrupts a pending model request',async()=>{
 const controller=new AbortController();
 await assert.rejects(runAgent({url,goal:'cancel',signal:controller.signal,emit:()=>{},chromium,guard:async()=>{},decide:async(_,signal)=>{
  setTimeout(()=>controller.abort(new Error('test cancellation')),50);
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }}),/test cancellation/);
});
