import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

test('KARVIN sign-in returns to the integrated workspace and accepts only local next paths',async()=>{
 const html=await readFile(new URL('../public/auth.html',import.meta.url),'utf8');
 const script=await readFile(new URL('../public/auth.js',import.meta.url),'utf8');
 assert.match(html,/<title>Sign in · KARVIN<\/title>/);
 assert.match(html,/id="auth-form"/);
 assert.match(script,/params\.get\('next'\)\|\|'\/'/);
 assert.match(script,/requested\.startsWith\('\/'\)&&!requested\.startsWith\('\/\/'\)\?requested:'\/'/);
 assert.doesNotMatch(`${html}\n${script}`,/Cline|code-server/i);
});
