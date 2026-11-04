// @vitest-environment node
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it,vi} from 'vitest';
import {CloudflareClient,prepareAutomaticDeployment,applyAutomaticSecrets,TARGET} from '../../scripts/cloudflare-bootstrap.mjs';

const base=JSON.parse(readFileSync(join(process.cwd(),'wrangler.jsonc'),'utf8'));
const account='11111111111111111111111111111111',other='22222222222222222222222222222222';
const dbId='11111111-2222-4333-8444-555555555555';
const token='fixture-api-token-never-persist';
const widget={name:TARGET.widget,sitekey:'0xFixtureProductionSiteKey',secret:'fixture-private-turnstile-key-never-persist',domains:[new URL(TARGET.origin).hostname],mode:'managed'};
const columns={users:['id','email','display_name','password_hash','created_at'],sessions:['token_hash','user_id','csrf_hash','created_at','expires_at'],posts:['id','owner_id','title','body','visibility','version','created_at','updated_at'],posts_fts:['title','body'],files:['id','owner_id','object_key','filename','mime','bytes','visibility','status','created_at'],watchlist:['user_id','symbol','created_at']};

function cloudflare(options:any={}){
 const state={settings:{compatibility_date:'2026-03-01',compatibility_flags:['nodejs_compat'],bindings:[] as any[],...options.settings},database:options.database??null,bucket:options.bucket??null,namespace:options.namespace??null,widget:options.widget??null};
 const calls:{method:string;path:string;body:any}[]=[];const secrets=new Map<string,string>();const masked:string[]=[],messages:string[]=[];
 const ok=(result:any)=>new Response(JSON.stringify({success:true,result,result_info:{total_pages:1}}),{headers:{'Content-Type':'application/json'}});
 const failure=(status=403,code=10000)=>new Response(JSON.stringify({success:false,errors:[{code,message:'upstream must not leak '+token}]}),{status,headers:{'Content-Type':'application/json'}});
 const fetchFn=vi.fn(async(input:string,init:any)=>{
  const url=new URL(input),path=url.pathname.replace('/client/v4','');expect(url.origin).toBe('https://api.cloudflare.com');expect(init.headers.Authorization).toBe('Bearer '+token);expect(init.redirect).toBe('error');const method=init.method,body=init.body===undefined?undefined:JSON.parse(init.body);calls.push({method,path,body});
  if(options.fail?.(method,path,body))return failure();
  if(path==='/accounts')return ok(options.accounts??[{id:account}]);
  if(path.endsWith('/workers/subdomain'))return ok({subdomain:path.includes(other)?'another-site':options.subdomain??TARGET.subdomain});
  if(path.endsWith('/workers/scripts/'+TARGET.worker+'/settings'))return options.workerMissing?failure(404):ok(state.settings);
  if(path.endsWith('/workers/scripts/'+TARGET.worker+'/secrets')&&method==='PUT'){secrets.set(body.name,body.text);const found=state.settings.bindings.find((binding:any)=>binding.name===body.name);if(found){delete found.text;found.type='secret_text';}else state.settings.bindings.push({name:body.name,type:'secret_text'});return ok({name:body.name,type:'secret_text'});}
  if(path.endsWith('/d1/database')&&method==='GET')return ok(state.database?[state.database]:[]);
  if(path.endsWith('/d1/database')&&method==='POST'){state.database={uuid:dbId,name:TARGET.database};return ok(state.database);}
  if(path.endsWith('/d1/database/'+dbId))return state.database?ok(state.database):failure(404);
  if(path.endsWith('/query')){
   let results:any[]=[];
   if(body.sql.includes('sqlite_master'))results=(options.schema??[]).map((name:string)=>({name}));
   else if(body.sql.startsWith('PRAGMA')){const table=body.sql.match(/'([^']+)'/)[1];results=(options.missingColumn===table?[]:columns[table as keyof typeof columns]).map((name:string)=>({name}));}
   else if(body.sql.includes('d1_migrations'))results=options.migrationMissing?[]:[{name:'0001_platform.sql'}];
   else if(body.sql.includes('COUNT(*) AS count FROM files'))results=[{count:options.fileCount??0}];
   else throw Error('Unexpected SQL in the mock API');
   return ok([{success:true,results}]);
  }
  if(path.endsWith('/r2/buckets')&&method==='POST'){state.bucket={name:body.name,storage_class:body.storage_class};return ok(state.bucket);}
  if(path.endsWith('/storage/kv/namespaces')&&method==='GET')return ok(state.namespace?[state.namespace]:[]);
  if(path.endsWith('/storage/kv/namespaces')&&method==='POST'){state.namespace={id:other,title:body.title};return ok(state.namespace);}
  if(path.endsWith('/domains/managed'))return ok({enabled:options.publicManaged??false,domain:'fixture.r2.dev'});
  if(path.endsWith('/domains/custom'))return ok({domains:options.publicCustom?[{enabled:true,domain:'public.example'}]:[]});
  if(path.includes('/r2/buckets/'))return state.bucket?ok(state.bucket):failure(404);
  if(path.endsWith('/challenges/widgets')&&method==='GET')return ok(state.widget?[state.widget]:[]);
  if(path.endsWith('/challenges/widgets')&&method==='POST'){state.widget={...widget,...body};return ok(state.widget);}
  if(path.includes('/challenges/widgets/'))return state.widget?ok(state.widget):failure(404);
  throw Error('Unexpected Cloudflare API request in test');
 });
 const prepare=()=>prepareAutomaticDeployment({token,base,fetchFn,mask:(value:string)=>masked.push(value),log:(message:string)=>messages.push(message),generateSecret:()=> 'fixture-generated-application-secret-never-persist-1234'});
 return {state,calls,secrets,masked,messages,fetchFn,prepare};
}
const resources=(calls:any[])=>calls.filter(call=>call.method!=='GET'&&!call.path.endsWith('/query'));

describe('one-token Cloudflare deployment',()=>{
 it('discovers the existing account and prepares a complete deployment from only one token',async()=>{
  const mock=cloudflare({accounts:[{id:other},{id:account}]});const plan=await mock.prepare();expect(plan.config.account_id).toBe(account);expect(plan.config.name).toBe(TARGET.worker);expect(plan.config.vars.PUBLIC_ORIGIN).toBe(TARGET.origin);expect(plan.config.d1_databases[0].database_id).toBe(dbId);expect(plan.config.kv_namespaces).toContainEqual({binding:'FILE_KV',id:other});expect(plan.config.r2_buckets).toBeUndefined();expect(plan.config.vars.TURNSTILE_SITE_KEY).toBe(widget.sitekey);expect(plan.config.compatibility_date).toBe('2026-03-01');expect(plan.config.keep_vars).toBe(true);
  expect(resources(mock.calls).map(call=>call.path)).toEqual(['/accounts/'+account+'/d1/database','/accounts/'+account+'/storage/kv/namespaces','/accounts/'+account+'/challenges/widgets']);expect(mock.calls.some(call=>call.path.includes('/r2/'))).toBe(false);expect(mock.calls.every(call=>!call.path.includes('/workers/scripts/')||call.method==='GET')).toBe(true);
 });
 it('never puts generated app secrets or the deployment token in the config or progress messages',async()=>{
  const mock=cloudflare();const plan=await mock.prepare();const visible=JSON.stringify(plan.config)+mock.messages.join('\n');for(const value of [token,widget.secret,'fixture-generated-application-secret-never-persist-1234']){expect(visible).not.toContain(value);expect(mock.masked).toContain(value);}expect(plan.secrets).toHaveLength(2);
 });
 it('uploads app secrets to Cloudflare and leaves the deployment token out of runtime bindings',async()=>{
  const mock=cloudflare();const plan=await mock.prepare();await applyAutomaticSecrets(plan);expect(mock.secrets.get('AUTH_SECRET')).toBe('fixture-generated-application-secret-never-persist-1234');expect(mock.secrets.get('TURNSTILE_SECRET_KEY')).toBe(widget.secret);expect(mock.secrets.has('CLOUDFLARE_API_TOKEN')).toBe(false);expect([...mock.secrets.keys()].sort()).toEqual(['AUTH_SECRET','TURNSTILE_SECRET_KEY']);
 });
 it('reuses resources and preserves an existing opaque password secret across redeployments',async()=>{
  const bindings=[{name:'DB',type:'d1',id:dbId},{name:'FILES',type:'r2_bucket',bucket_name:TARGET.bucket},{name:'AUTH_SECRET',type:'secret_text'},{name:'TURNSTILE_SECRET_KEY',type:'secret_text'},{name:'TURNSTILE_SITE_KEY',type:'plain_text',text:widget.sitekey},{name:'OLD_API_SETTING',type:'plain_text',text:'keep-me'}];
  const mock=cloudflare({settings:{bindings},database:{uuid:dbId,name:TARGET.database},bucket:{name:TARGET.bucket},widget,schema:[...Object.keys(columns),'d1_migrations']});const plan=await mock.prepare();expect(resources(mock.calls)).toHaveLength(0);expect(plan.secrets.some((secret:any)=>secret.name==='AUTH_SECRET')).toBe(false);await applyAutomaticSecrets(plan);expect(mock.secrets.has('AUTH_SECRET')).toBe(false);expect(mock.state.settings.bindings.find((binding:any)=>binding.name==='OLD_API_SETTING')?.text).toBe('keep-me');
 });
 it('resumes setup by reusing an empty database, existing namespace and matching bootstrap widget',async()=>{
  const mock=cloudflare({database:{uuid:dbId,name:TARGET.database},namespace:{id:other,title:TARGET.namespace},widget});await mock.prepare();expect(resources(mock.calls)).toHaveLength(0);
 });
 it('converts a pre-existing plaintext app secret to an encrypted binding without changing its value',async()=>{
  const original='existing-password-pepper-must-stay-identical-12345';const mock=cloudflare({settings:{bindings:[{name:'AUTH_SECRET',type:'plain_text',text:original}]}});const plan=await mock.prepare();expect(JSON.stringify(plan.config)).not.toContain(original);await applyAutomaticSecrets(plan);expect(mock.secrets.get('AUTH_SECRET')).toBe(original);expect(mock.masked).toContain(original);
 });
 it('does not replace an AUTH_SECRET added by another deploy while preparation was running',async()=>{
  const mock=cloudflare();const plan=await mock.prepare();mock.state.settings.bindings.push({name:'AUTH_SECRET',type:'secret_text'});await applyAutomaticSecrets(plan);expect(mock.secrets.has('AUTH_SECRET')).toBe(false);
 });
 it('stops before changing any secret when bindings change concurrently',async()=>{
  const mock=cloudflare();const plan=await mock.prepare();mock.state.settings.bindings.push({name:'DB',type:'d1',id:dbId});await expect(applyAutomaticSecrets(plan)).rejects.toThrow('settings changed');expect(mock.secrets.size).toBe(0);
 });
 it('accepts an older compatibility date and absent optional flags without inventing new flags',async()=>{
  const mock=cloudflare({settings:{compatibility_date:'2025-01-01',compatibility_flags:undefined}});const plan=await mock.prepare();expect(plan.config.compatibility_date).toBe('2025-01-01');expect(plan.config.compatibility_flags).toEqual([]);
 });
 it.each([{subdomain:'wrong-account'},{workerMissing:true},{settings:{compatibility_date:'2023-01-01'}},{settings:{bindings:[{name:'DB',type:'kv_namespace',namespace_id:'old'}]}},{settings:{bindings:[{name:'OTHER_QUEUE',type:'queue',queue_name:'legacy'}]}}])('rejects a wrong target or unhandled legacy settings before creating resources: %j',async options=>{
  const mock=cloudflare(options);await expect(mock.prepare()).rejects.toThrow();expect(resources(mock.calls)).toHaveLength(0);
 });
 it('stops for an incompatible existing database instead of replacing or deleting data',async()=>{
  const mock=cloudflare({settings:{bindings:[{name:'DB',type:'d1',id:dbId}]},database:{uuid:dbId,name:'old-platform'},schema:['users','legacy_portfolio']});await expect(mock.prepare()).rejects.toThrow('migration');expect(resources(mock.calls)).toHaveLength(0);expect(mock.calls.filter(call=>call.path.endsWith('/query')).every(call=>!/(DROP|DELETE|UPDATE|INSERT|CREATE)/i.test(call.body.sql))).toBe(true);
 });
 it('retains an existing legacy KV namespace with its original name and identifier',async()=>{
  const mock=cloudflare({settings:{bindings:[{name:'OLD_CACHE',type:'kv_namespace',namespace_id:other}]}});const plan=await mock.prepare();expect(plan.config.kv_namespaces).toContainEqual({binding:'OLD_CACHE',id:other});expect(plan.config.kv_namespaces).toContainEqual({binding:'FILE_KV',id:other});
 });
 it.each([{missingColumn:'files'},{migrationMissing:true}])('rejects a superficially matching schema with missing columns or migration history %j',async options=>{
  const mock=cloudflare({...options,database:{uuid:dbId,name:TARGET.database},schema:[...Object.keys(columns),'d1_migrations']});await expect(mock.prepare()).rejects.toThrow('migration');expect(resources(mock.calls)).toHaveLength(0);
 });
 it('preserves a missing existing file binding for review rather than creating a replacement bucket',async()=>{
  const mock=cloudflare({settings:{bindings:[{name:'FILES',type:'r2_bucket',bucket_name:'old-evidence'}]}});await expect(mock.prepare()).rejects.toThrow('not silently replaced');expect(resources(mock.calls)).toHaveLength(0);
 });
 it.each([{publicManaged:true},{publicCustom:true}])('refuses a publicly exposed bucket without disabling its existing public service %j',async options=>{
  const mock=cloudflare({...options,settings:{bindings:[{name:'FILES',type:'r2_bucket',bucket_name:TARGET.bucket}]},bucket:{name:TARGET.bucket}});await expect(mock.prepare()).rejects.toThrow('direct public access');expect(resources(mock.calls)).toHaveLength(0);
 });
 it('rejects a widget for another hostname without changing its security configuration',async()=>{
  const mock=cloudflare({widget:{...widget,domains:['elsewhere.example']}});await expect(mock.prepare()).rejects.toThrow('widget');expect(resources(mock.calls)).toHaveLength(0);
 });
 it('fails with a useful R2 authorization/activation message without logging an upstream credential',async()=>{
  const mock=cloudflare({settings:{bindings:[{name:'FILES',type:'r2_bucket',bucket_name:TARGET.bucket}]},fail:(_method:string,path:string)=>path.includes('/r2/')});let message='';try{await mock.prepare();}catch(error){message=(error as Error).message;}expect(message).toContain('R2');expect(message).not.toContain(token);expect(resources(mock.calls)).toHaveLength(0);
 });
 it('does not select a new storage backend for existing file records without a binding',async()=>{
  const mock=cloudflare({database:{uuid:dbId,name:TARGET.database},schema:[...Object.keys(columns),'d1_migrations'],fileCount:1});await expect(mock.prepare()).rejects.toThrow('no storage binding');expect(resources(mock.calls)).toHaveLength(0);
 });
 it('refuses redirect responses and malformed API responses without including response bodies',async()=>{
  const client=new CloudflareClient(token,{fetchFn:async()=>new Response('private-'+token,{status:302,headers:{Location:'https://elsewhere.example'}})});await expect(client.request('GET','/accounts')).rejects.toThrow('HTTP 302');
 });
});
