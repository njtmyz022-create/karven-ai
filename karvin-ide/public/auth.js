const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const inviteToken=params.get('invite')||'';
let mode='login';
const requested=params.get('next')||'/';
const destination=requested.startsWith('/')&&!requested.startsWith('//')?requested:'/';
function setMode(next){
 mode=next;const signup=mode==='register';
 $('signin-tab').setAttribute('aria-selected',String(!signup));$('signup-tab').setAttribute('aria-selected',String(signup));
 $('heading').textContent=signup?'Create your account':'Welcome back';$('subheading').textContent=signup?'Set up your private Karvin workspace.':'Sign in to open your projects and tools.';
 $('name').hidden=!signup;$('name-label').hidden=!signup;$('confirm-password').hidden=!signup;$('confirm-label').hidden=!signup;
 $('name').required=signup;$('confirm-password').required=signup;
 $('password').autocomplete=signup?'new-password':'current-password';$('password').minLength=signup?12:1;
 $('submit').firstChild.textContent=signup?'Create account ':'Sign in ';
 $('message').textContent='';
}
async function checkSession(){try{const response=await fetch('/api/auth/me',{cache:'no-store',credentials:'same-origin'});if(response.ok){const data=await response.json();sessionStorage.setItem('karvin-csrf',data.csrf);location.replace(destination);}}catch{}}
$('signin-tab').onclick=()=>setMode('login');$('signup-tab').onclick=()=>setMode('register');
if(inviteToken){$('email').value=(params.get('email')||'').trim();$('email').readOnly=true;$('signin-tab').hidden=true;$('signup-tab').hidden=true;setMode('register');history.replaceState(null,'',`/login?next=${encodeURIComponent(destination)}`);}
fetch('/api/auth/status',{cache:'no-store'}).then(r=>r.json()).then(status=>{if(status.registrationOpen===false&&!inviteToken){$('signup-tab').disabled=true;$('signup-tab').title=status.ownerSetupReady===false?'Platform owner setup is required':'Ask an administrator for an invitation';if(status.ownerSetupReady===false)$('message').textContent='The platform owner must configure the first account before registration opens.';else $('message').textContent='New accounts require an administrator invitation.';}if(!status.enabled)$('message').textContent='Account sign-in is not enabled on this server.';}).catch(()=>{$('message').textContent='Unable to reach the Karvin service.';});
void checkSession();
$('auth-form').addEventListener('submit',async event=>{
 event.preventDefault();$('message').textContent='';const button=$('submit');button.disabled=true;
 const payload={email:$('email').value.trim(),password:$('password').value};
 if(mode==='register'){payload.name=$('name').value.trim();if(inviteToken)payload.inviteToken=inviteToken;if(payload.password!==$('confirm-password').value){$('message').textContent='The passwords do not match.';button.disabled=false;return;}}
 try{
  const response=await fetch(`/api/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Sign in failed');
  sessionStorage.setItem('karvin-csrf',data.csrf);location.replace(destination);
 }catch(error){$('message').textContent=error.message;}finally{button.disabled=false;}
});
