import {env} from 'cloudflare:workers';
import {createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import worker from '../../src/api/index';
import type {Env} from '../../src/api/types';
import {authConfigured} from '../../src/api/auth';
import {verificationReplies,quoteReplies} from './mocks';
const ORIGIN='https://meridian.test';
const allow={limit:async()=>({success:true})};
function bindings(override:Partial<Env>={}):Env{return {...env,PUBLIC_ORIGIN:ORIGIN,AUTH_SECRET:'fixture-only-secret-not-for-real-deployments-12345',TURNSTILE_SITE_KEY:'fixture-site-key',TURNSTILE_SECRET_KEY:'fixture-secret-key',AUTH_LIMITER:allow,READ_LIMITER:allow,WRITE_LIMITER:allow,ASSETS:{fetch:async()=>new Response('static')} as Fetcher,...override} as Env;}
function check(action='register',extra:Record<string,unknown>={}){verificationReplies.push({success:true,hostname:'meridian.test',action,challenge_ts:new Date().toISOString(),...extra});}
async function call(path:string,options:{method?:string;data?:unknown;cookie?:string;headers?:Record<string,string>;raw?:BodyInit;env?:Partial<Env>}={}){
 const context=createExecutionContext();const headers=new Headers({'Origin':ORIGIN,...options.headers});if(options.cookie){headers.set('Cookie',options.cookie);const match=options.cookie.match(/__Host-meridian_csrf=([^;]+)/);if(match&&!headers.has('X-CSRF-Token'))headers.set('X-CSRF-Token',match[1]);}
 if(options.data!==undefined)headers.set('Content-Type','application/json');
 const response=await worker.fetch(new Request(ORIGIN+path,{method:options.method??'GET',headers,body:options.raw??(options.data!==undefined?JSON.stringify(options.data):undefined)}),bindings(options.env),context);await waitOnExecutionContext(context);return response;
}
async function register(email='alice@example.test'){
 check();const response=await call('/api/auth/register',{method:'POST',data:{email,password:'fixture-password-123',displayName:email.split('@')[0],captchaToken:'fixture-token'}});expect(response.status).toBe(201);
 const cookies=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const data=await response.json<any>();return {cookie:cookies,user:data.user,response};
}
async function note(cookie:string,visibility='private',title='Alpha research',content='A private hypothesis about market cycles.'){
 if(visibility==='public')check('publish');const response=await call('/api/posts',{method:'POST',cookie,data:{title,body:content,visibility,captchaToken:'fixture-token'}});expect(response.status).toBe(201);return await response.json<any>();
}
describe('accounts and request protections',()=>{
 it('reports the migrated schema and configured services in release readiness',async()=>{const response=await call('/healthz');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'ok',version:'6.0.0',checks:{database:true,files:true,accounts:true}});expect((await call('/healthz',{env:{TURNSTILE_SECRET_KEY:''}})).status).toBe(503);});
 it('creates a hashed account with secure session cookies and no cached API data',async()=>{
  const account=await register();expect(account.response.headers.get('Cache-Control')).toContain('no-store');const raw=account.response.headers.getSetCookie();expect(raw[0]).toContain('HttpOnly');expect(raw[0]).toContain('Secure');expect(raw[0]).toContain('SameSite=Lax');
  const stored=await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(account.user.id).first<any>();expect(stored.password_hash).toMatch(/^pbkdf2v1\$100000\$/);expect(stored.password_hash).not.toContain('fixture-password');
  expect((await (await call('/api/session',{cookie:account.cookie})).json<any>()).user.id).toBe(account.user.id);
 });
 it('requires login for personal data and never caches error responses',async()=>{for(const path of ['/api/files','/api/posts?scope=mine','/api/watchlist']){const response=await call(path);expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toContain('no-store');}});
 it('rejects a wrong password with the same response as an unknown account',async()=>{
  await register();for(const email of ['alice@example.test','unknown@example.test']){check('login');const response=await call('/api/auth/login',{method:'POST',data:{email,password:'incorrect-password',captchaToken:'token'}});expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'Email or password is incorrect.'});}
 });
 it('logs in and revokes a logged-out session',async()=>{
  await register();check('login');const response=await call('/api/auth/login',{method:'POST',data:{email:'ALICE@example.test',password:'fixture-password-123',captchaToken:'token'}});expect(response.status).toBe(200);const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  expect((await call('/api/auth/logout',{method:'POST',cookie,data:{}})).status).toBe(200);expect((await (await call('/api/session',{cookie})).json<any>()).user).toBeNull();
 });
 it('rejects cross-origin writes and a missing or wrong CSRF token',async()=>{
  const account=await register();const data={displayName:'Changed'};
  expect((await call('/api/account',{method:'PATCH',cookie:account.cookie,data,headers:{Origin:'https://evil.test'}})).status).toBe(403);
  expect((await call('/api/account',{method:'PATCH',cookie:account.cookie,data,headers:{'X-CSRF-Token':'wrong'}})).status).toBe(403);
  const withoutCsrf=account.cookie.split('; ')[0];expect((await call('/api/account',{method:'PATCH',cookie:withoutCsrf,data})).status).toBe(403);
 });
 it('fails closed on invalid Turnstile hostname/action and production test keys',async()=>{
  check('register',{hostname:'evil.test'});expect((await call('/api/auth/register',{method:'POST',data:{email:'x@example.test',password:'fixture-password-123',displayName:'X',captchaToken:'token'}})).status).toBe(400);
  check('login');expect((await call('/api/auth/register',{method:'POST',data:{email:'x@example.test',password:'fixture-password-123',displayName:'X',captchaToken:'token'}})).status).toBe(400);
  expect(authConfigured(bindings({APP_ENV:'production',TURNSTILE_SITE_KEY:'1x00000000000000000000AA'}))).toBe(false);
 });
 it('returns 429 before verification or password work when rate limited',async()=>{const response=await call('/api/auth/login',{method:'POST',data:{email:'x@example.test',password:'fixture-password-123',captchaToken:'token'},env:{AUTH_LIMITER:{limit:async()=>({success:false})}}});expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('60');});
 it('limits all dynamic read routes before database or object-store work',async()=>{for(const path of ['/api/session','/api/config','/api/posts/'+crypto.randomUUID(),'/media/'+crypto.randomUUID(),'/healthz']){const response=await call(path,{env:{READ_LIMITER:{limit:async()=>({success:false})}}});expect(response.status).toBe(429);expect(response.headers.get('Cache-Control')).toContain('no-store');}});
 it('rejects excess fields, invalid JSON, short passwords and oversized bodies',async()=>{
  expect((await call('/api/auth/login',{method:'POST',data:{email:'a@b.test',password:'short',captchaToken:'x'}})).status).toBe(422);
  expect((await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},raw:'{'})).status).toBe(400);
  expect((await call('/api/auth/login',{method:'POST',data:{email:'a@b.test',password:'fixture-password-123',owner_id:'evil'}})).status).toBe(422);
  expect((await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},raw:'x'.repeat(40000)})).status).toBe(413);
 });
 it('changes passwords and invalidates older sessions',async()=>{
  const account=await register();const response=await call('/api/account/password',{method:'POST',cookie:account.cookie,data:{currentPassword:'fixture-password-123',newPassword:'new-fixture-password-123'}});expect(response.status).toBe(200);
  expect((await (await call('/api/session',{cookie:account.cookie})).json<any>()).user).toBeNull();
  check('login');expect((await call('/api/auth/login',{method:'POST',data:{email:'alice@example.test',password:'new-fixture-password-123',captchaToken:'token'}})).status).toBe(200);
 });
});
describe('content privacy and search',()=>{
 it('keeps notes private by default and prevents other accounts reading or changing them',async()=>{
  const alice=await register(),bob=await register('bob@example.test');const saved=await note(alice.cookie);
  expect((await call('/api/posts/'+saved.id)).status).toBe(404);expect((await call('/api/posts/'+saved.id,{cookie:bob.cookie})).status).toBe(404);
  expect((await call('/api/posts/'+saved.id,{method:'PATCH',cookie:bob.cookie,data:{title:'stolen',body:'secret',visibility:'private',version:1}})).status).toBe(404);
  expect((await call('/api/posts/'+saved.id,{method:'DELETE',cookie:bob.cookie,data:{version:1}})).status).toBe(404);
  expect((await (await call('/api/posts?scope=mine',{cookie:bob.cookie})).json<any>()).items).toHaveLength(0);
 });
 it('publishes explicitly and makes unpublishing effective for future reads',async()=>{
  const account=await register();const saved=await note(account.cookie,'public');const response=await call('/api/posts/'+saved.id);expect(response.status).toBe(200);expect(JSON.stringify(await response.json())).not.toContain(account.user.email);
  expect((await call('/api/posts/'+saved.id,{method:'PATCH',cookie:account.cookie,data:{title:'Alpha',body:'Private again',visibility:'private',version:1}})).status).toBe(200);
  expect((await call('/api/posts/'+saved.id)).status).toBe(404);
 });
 it('detects stale edits and stale deletes instead of overwriting another tab',async()=>{
  const account=await register(),saved=await note(account.cookie);const data={title:'Updated',body:'Updated note',visibility:'private',version:1};
  expect((await call('/api/posts/'+saved.id,{method:'PATCH',cookie:account.cookie,data})).status).toBe(200);
  expect((await call('/api/posts/'+saved.id,{method:'PATCH',cookie:account.cookie,data})).status).toBe(409);
  expect((await call('/api/posts/'+saved.id,{method:'DELETE',cookie:account.cookie,data:{version:1}})).status).toBe(409);
 });
 it('filters FTS results by visibility and ownership even for operator-like input',async()=>{
  const alice=await register(),bob=await register('bob@example.test');await note(alice.cookie);await note(bob.cookie,'public','Alpha public','Public research');
  expect((await (await call('/api/search?q=Alpha')).json<any>()).items).toHaveLength(1);
  const own=(await (await call('/api/search?q=Alpha&scope=mine',{cookie:alice.cookie})).json<any>()).items;expect(own).toHaveLength(1);expect(own[0].visibility).toBe('private');
  expect((await call('/api/search?q=%22%20OR%20*&scope=mine',{cookie:alice.cookie})).status).toBe(200);
 });
 it('updates the search index on edits and deletion',async()=>{
  const account=await register(),saved=await note(account.cookie);await call('/api/posts/'+saved.id,{method:'PATCH',cookie:account.cookie,data:{title:'Beta',body:'Different content',visibility:'private',version:1}});
  expect((await (await call('/api/search?q=Alpha&scope=mine',{cookie:account.cookie})).json<any>()).items).toHaveLength(0);
  expect((await (await call('/api/search?q=Beta&scope=mine',{cookie:account.cookie})).json<any>()).items).toHaveLength(1);
  await call('/api/posts/'+saved.id,{method:'DELETE',cookie:account.cookie,data:{version:2}});
  expect((await (await call('/api/search?q=Beta&scope=mine',{cookie:account.cookie})).json<any>()).items).toHaveLength(0);
 });
});
describe('object storage and bounded markets',()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
 async function file(cookie:string,raw:Uint8Array=png,type='image/png'){check('upload');return call('/api/files',{method:'POST',cookie,raw,headers:{'Content-Type':type,'X-Filename':encodeURIComponent('测试.png'),'X-Turnstile-Token':'token'}});}
 it('stores bytes in R2 and metadata in D1, with owner-only downloads',async()=>{
  const alice=await register(),bob=await register('bob@example.test');const response=await file(alice.cookie);expect(response.status).toBe(201);const saved=await response.json<any>();
  const record=await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(saved.id).first<any>();expect(record).not.toHaveProperty('body');expect(await env.FILES.head(record.object_key)).not.toBeNull();
  expect((await call('/media/'+saved.id)).status).toBe(404);expect((await call('/media/'+saved.id,{cookie:bob.cookie})).status).toBe(404);
  const download=await call('/media/'+saved.id,{cookie:alice.cookie});expect(download.status).toBe(200);expect(download.headers.get('Cache-Control')).toContain('no-store');expect(new Uint8Array(await download.arrayBuffer())).toEqual(png);
 });
 it('validates file signatures and actual size before object storage writes',async()=>{
  const account=await register();expect((await file(account.cookie,new TextEncoder().encode('<script>bad</script>'))).status).toBe(415);
  expect((await file(account.cookie,png,'text/html')).status).toBe(415);expect((await file(account.cookie,new Uint8Array(2097153))).status).toBe(413);
  expect((await (await call('/api/files',{cookie:account.cookie})).json<any>()).items).toHaveLength(0);
 });
 it('checks visibility before serving a cached public image',async()=>{
  const account=await register();const saved=await (await file(account.cookie)).json<any>();check('publish');expect((await call('/api/files/'+saved.id,{method:'PATCH',cookie:account.cookie,data:{visibility:'public',captchaToken:'token'}})).status).toBe(200);
  expect((await call('/media/'+saved.id)).headers.get('Cache-Control')).toContain('public');
  await call('/api/files/'+saved.id,{method:'PATCH',cookie:account.cookie,data:{visibility:'private'}});expect((await call('/media/'+saved.id)).status).toBe(404);
 });
 it('keeps watchlists scoped to their owner and caps quote requests',async()=>{
  const alice=await register(),bob=await register('bob@example.test');expect((await call('/api/watchlist',{method:'POST',cookie:alice.cookie,data:{symbol:'600519.SH'}})).status).toBe(200);
  expect((await (await call('/api/watchlist',{cookie:bob.cookie})).json<any>()).items).toHaveLength(0);
  expect((await call('/api/markets/quotes?symbols=600519.SH',{cookie:bob.cookie})).status).toBe(403);
  expect((await call('/api/markets/quotes?symbols='+Array.from({length:21},(_,i)=>i+'.SH').join(','),{cookie:alice.cookie})).status).toBe(422);
  expect((await call('/api/watchlist',{method:'POST',cookie:alice.cookie,data:{symbol:'not-a-security'}})).status).toBe(422);
 });
 it('serves only public quote observations from its shared cache, with uncached API responses',async()=>{
  const alice=await register();await call('/api/watchlist',{method:'POST',cookie:alice.cookie,data:{symbol:'300750.SZ'}});
  const fields=Array(50).fill('0');fields[1]='discard-provider-name';fields[3]='240.5';fields[30]='20261030150000';fields[32]='1.25';quoteReplies.push(new TextEncoder().encode('v_sz300750="'+fields.join('~')+'";'));
  const first=await call('/api/markets/quotes?symbols=300750.SZ',{cookie:alice.cookie});expect(first.status).toBe(200);const firstData=await first.json<any>();expect(firstData.rows[0].name).toBe('宁德时代');expect(firstData.rows[0].price).toBe(240.5);expect(firstData.latency_verified).toBe(false);
  const next=await call('/api/markets/quotes?symbols=300750.SZ',{cookie:alice.cookie});expect((await next.json<any>()).cached).toBe(true);expect(next.headers.get('Cache-Control')).toContain('no-store');
 });
});
