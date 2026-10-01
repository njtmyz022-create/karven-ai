import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {checkURL,validateAction,runAgent,modelDecision,privateIP} from '../agent.mjs';
const snapshot={text:'Basic plan costs $12 per month.',elements:[{id:1,tag:'input',editable:true,disabled:false},{id:2,tag:'button',editable:false,disabled:false}]};
test('reject stale, noneditable, disabled targets and fabricated evidence',()=>{
 assert.throws(()=>validateAction({operation:'click',target:9},snapshot),/observed/);
 assert.throws(()=>validateAction({operation:'fill',target:2,text:'hello'},snapshot),/editable/);
 assert.throws(()=>validateAction({operation:'done',evidence:['Costs $99']},snapshot),/evidence/);
 assert.throws(()=>validateAction({operation:'press',key:'Meta+R'},snapshot),/Unsupported/);
 assert.equal(validateAction({operation:'done',evidence:['$12 per month']},snapshot).operation,'done');
});
test('URL guard blocks loopback, private DNS, credentials, unsupported protocols',async()=>{
 for(const url of ['http://127.0.0.1','http://[::1]','http://10.0.0.1','file:///etc/passwd','https://user:pass@example.com'])await assert.rejects(checkURL(url));
 await assert.rejects(checkURL('https://example.com',async()=>[{address:'192.168.1.1'}]),/Private/);
 assert.equal(await checkURL('https://example.com',async()=>[{address:'93.184.216.34'}]),'https://example.com/');
 assert.equal(privateIP('::ffff:127.0.0.1'),true);
});
test('OpenAI-compatible provider adapter sends observations and parses JSON',async()=>{
 const previous={base:process.env.LLM_BASE_URL,key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL};
 const provider=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer fixture-key');assert.equal(payload.model,'fixture-model');assert.match(payload.messages[1].content,/Starter/);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({operation:'done',evidence:['Starter'],result:{ok:true}})}}]}));});
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 process.env.LLM_BASE_URL=`http://127.0.0.1:${provider.address().port}/v1`;process.env.LLM_API_KEY='fixture-key';process.env.LLM_MODEL='fixture-model';
 try{const decision=await modelDecision({goal:'Starter'},new AbortController().signal);assert.equal(decision.result.ok,true);}finally{await new Promise(resolve=>provider.close(resolve));for(const [name,value] of Object.entries({LLM_BASE_URL:previous.base,LLM_API_KEY:previous.key,LLM_MODEL:previous.model})){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
