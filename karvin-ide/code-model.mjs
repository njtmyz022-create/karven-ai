// Bridges an OpenAI-compatible chat/completions provider to Cline's AgentModel.
export function toChatMessages(request){
 const messages=request.systemPrompt?[{role:'system',content:request.systemPrompt}]:[];
 for(const message of request.messages){
  const text=message.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  if(message.role==='assistant'){
   const calls=message.content.filter(p=>p.type==='tool-call').map(p=>({id:p.toolCallId,type:'function',function:{name:p.toolName,arguments:JSON.stringify(p.input)}}));
   messages.push({role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{})});
  }else{
   if(text)messages.push({role:message.role==='system'?'system':'user',content:text});
   for(const part of message.content.filter(p=>p.type==='tool-result'))messages.push({role:'tool',tool_call_id:part.toolCallId,content:JSON.stringify(part.output)});
  }
 }
 return messages;
}
export function createCodeModel({apiKey=process.env.CODE_API_KEY||process.env.LLM_API_KEY,model=process.env.CODE_MODEL||process.env.LLM_MODEL,baseUrl=process.env.CODE_BASE_URL||process.env.LLM_BASE_URL||'https://api.openai.com/v1'}={}){
 return {async *stream(request){
  const signal=request.signal?AbortSignal.any([request.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  const response=await fetch(`${baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,stream:true,stream_options:{include_usage:true},messages:toChatMessages(request),...(request.tools.length?{tools:request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}))}:{})})});
  if(!response.ok){yield {type:'finish',reason:'error',error:`Coding model returned HTTP ${response.status}`,errorClass:[401,403].includes(response.status)?'auth':'unknown',errorRetryable:response.status===429||response.status>=500};return;}
  let buffer='',finish='stop',sawFinish=false;const decoder=new TextDecoder();
  const consume=data=>{
   if(!data||data==='[DONE]')return [];
   const chunk=JSON.parse(data),events=[],choice=chunk.choices?.[0],delta=choice?.delta||{};
   if(delta.content)events.push({type:'text-delta',text:delta.content});
   for(const call of delta.tool_calls||[])events.push({type:'tool-call-delta',index:call.index,toolCallId:call.id,toolName:call.function?.name,inputText:call.function?.arguments});
   if(chunk.usage)events.push({type:'usage',usage:{inputTokens:chunk.usage.prompt_tokens||0,outputTokens:chunk.usage.completion_tokens||0}});
   if(choice?.finish_reason){sawFinish=true;finish=({'tool_calls':'tool-calls','length':'max-tokens','content_filter':'content-filter'})[choice.finish_reason]||'stop';}
   return events;
  };
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.startsWith('data:'))for(const event of consume(line.slice(5).trim()))yield event;}}
  if(buffer.startsWith('data:'))for(const event of consume(buffer.slice(5).trim()))yield event;
  yield sawFinish?{type:'finish',reason:finish}:{type:'finish',reason:'error',error:'Provider stream ended without a finish reason',errorRetryable:true};
 }};
}
