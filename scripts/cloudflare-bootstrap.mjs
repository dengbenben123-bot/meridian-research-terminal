import {randomBytes} from 'node:crypto';

// This bootstrap is deliberately limited to the user's existing production site.
export const TARGET={worker:'meridian-research-terminal',subdomain:'cooked-jersey',origin:'https://meridian-research-terminal.cooked-jersey.workers.dev',database:'meridian-platform',bucket:'meridian-files',namespace:'meridian-v6-files',widget:'Meridian Research Terminal v6'};
const accountId=/^[a-f0-9]{32}$/i;
const databaseId=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const testKey=value=>/^[123]x0+/.test(value||'');
const own=(settings,name)=>settings.bindings?.find(binding=>binding.name===name);
const publicKey=settings=>own(settings,'TURNSTILE_SITE_KEY')?.text||'';

export class CloudflareError extends Error{
 constructor(status,path,codes=[]){
  const area=path.includes('/r2/')?' Check R2 token permissions and that R2 is enabled in your Cloudflare account.':path.includes('/challenges/')?' Check the token has Turnstile Edit permission.':'';
  super(`Cloudflare API request failed (HTTP ${status}${codes.length?'; codes '+codes.join(', '):''}).${area} Check the token's account scope and permissions. No response body or credential was logged.`);
  this.status=status;this.path=path;
 }
}

export class CloudflareClient{
 constructor(token,{fetchFn=fetch,mask=()=>{}}={}){
  if(typeof token!=='string'||!token.trim()||token.trim()!==token||/\s/.test(token))throw Error('Save a valid CLOUDFLARE_API_TOKEN in GitHub repository Secrets.');
  this.token=token;this.fetchFn=fetchFn;this.mask=mask;mask(token);
 }
 async request(method,path,{body,optional=[]}={}){
  let response;
  try{response=await this.fetchFn('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+this.token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Could not reach Cloudflare. Retry the deployment; no credentials were logged.');}
  let payload;try{payload=await response.json();}catch{throw new CloudflareError(response.status,path);}
  if(optional.includes(response.status))return null;
  if(!response.ok||payload.success!==true)throw new CloudflareError(response.status,path,(payload.errors||[]).map(error=>error.code).filter(Number.isInteger));
  // Turnstile detail/create responses contain a private "secret" field.
  for(const item of Array.isArray(payload.result)?payload.result:[payload.result])if(typeof item?.secret==='string')this.mask(item.secret);
  return payload;
 }
}

async function list(client,path){
 const items=[];
 for(let page=1;page<=20;page++){
  const response=await client.request('GET',path+(path.includes('?')?'&':'?')+'per_page=50&page='+page);
  if(!Array.isArray(response.result))throw Error('Cloudflare returned an unexpected resource list. Nothing was assumed.');
  items.push(...response.result);
  if(response.result.length<50||response.result_info?.total_pages&&page>=response.result_info.total_pages)return items;
 }
 throw Error('Resource discovery exceeded its bounded page limit. Narrow the token to the intended account.');
}

async function findAccount(client){
 const accounts=await list(client,'/accounts');const matches=[];
 for(const account of accounts){
  if(!accountId.test(account.id))throw Error('Cloudflare returned an invalid account identifier.');
  const response=await client.request('GET','/accounts/'+account.id+'/workers/subdomain',{optional:[403,404]});
  if(response?.result?.subdomain===TARGET.subdomain)matches.push(account.id);
 }
 if(matches.length!==1)throw Error('The token must provide access to the account that owns cooked-jersey.workers.dev. The existing Worker was not replaced or recreated.');
 return matches[0];
}

function validateSettings(settings){
 if(!settings||!Array.isArray(settings.bindings)||!/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date||''))throw Error('Cannot verify the existing Worker settings.');
 const flags=settings.compatibility_flags??[];
 if(!Array.isArray(flags)||flags.some(flag=>typeof flag!=='string')||settings.compatibility_date<'2024-09-23'||flags.some(flag=>['no_nodejs_compat','no_nodejs_compat_v2'].includes(flag)))throw Error('Existing compatibility settings need review and were not changed.');
 const types={DB:'d1',FILES:'r2_bucket',FILE_KV:'kv_namespace',ASSETS:'assets',AUTH_LIMITER:'ratelimit',WRITE_LIMITER:'ratelimit',READ_LIMITER:'ratelimit'};
 for(const binding of settings.bindings){
  if(Object.hasOwn(types,binding.name)&&binding.type!==types[binding.name])throw Error('An existing resource binding has an unexpected type. Review it before migration: '+binding.name);
  if(['AUTH_SECRET','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY'].includes(binding.name)&&!['plain_text','secret_text'].includes(binding.type))throw Error('An application credential binding has an unexpected type.');
  if(binding.type==='kv_namespace'&&!accountId.test(binding.namespace_id||''))throw Error('The existing KV namespace identifier needs review.');
  if(!Object.hasOwn(types,binding.name)&&!['plain_text','secret_text','kv_namespace'].includes(binding.type))throw Error('Preserve and explicitly migrate this additional existing binding before deployment: '+binding.name);
 }
 if(own(settings,'TURNSTILE_SITE_KEY')?.type==='secret_text')throw Error('The Turnstile site key must be a public text variable. The existing secret was preserved.');
 return flags;
}

// Read only. Refuse to run the initial migration against unrelated/older data.
async function inspectDatabase(client,prefix,id){
 const rows=async(sql,params=[])=>{
  const response=await client.request('POST',prefix+'/d1/database/'+id+'/query',{body:{sql,params}});
  if(!Array.isArray(response.result)||response.result.length!==1||response.result[0].success!==true||!Array.isArray(response.result[0].results))throw Error('Cannot verify the existing D1 schema.');
  return response.result[0].results;
 };
 const tables=(await rows("SELECT name FROM sqlite_master WHERE type='table'")).map(row=>row.name);
 const application=tables.filter(name=>!name.startsWith('sqlite_')&&!name.startsWith('_cf_')&&!['_cf_METADATA','d1_migrations'].includes(name));
 if(!application.length)return false;
 const required={users:['id','email','display_name','password_hash','created_at'],sessions:['token_hash','user_id','csrf_hash','created_at','expires_at'],posts:['id','owner_id','title','body','visibility','version','created_at','updated_at'],posts_fts:['title','body'],files:['id','owner_id','object_key','filename','mime','bytes','visibility','status','created_at'],watchlist:['user_id','symbol','created_at']};
 if(!Object.keys(required).every(name=>tables.includes(name))||!tables.includes('d1_migrations'))throw Error('The existing database contains an older or unrelated schema. A data migration is required; no tables were changed or deleted.');
 for(const [table,columns] of Object.entries(required)){
  const found=new Set((await rows(`PRAGMA table_info('${table}')`)).map(row=>row.name));
  if(!columns.every(column=>found.has(column)))throw Error('The existing database needs a reviewed schema migration. No tables were changed.');
 }
 if(!(await rows('SELECT name FROM d1_migrations WHERE name=?',['0001_platform.sql'])).length)throw Error('The existing schema has no matching migration record. Review it before applying the initial migration.');
 return Number((await rows('SELECT COUNT(*) AS count FROM files'))[0]?.count)>0;
}

function widgetFits(widget){const host=new URL(TARGET.origin).hostname;return Array.isArray(widget?.domains)&&widget.domains.some(domain=>typeof domain==='string'&&(host===domain||host.endsWith('.'+domain)));}
function validWidget(widget){return typeof widget?.sitekey==='string'&&/^[a-zA-Z0-9_-]{1,32}$/.test(widget.sitekey)&&!testKey(widget.sitekey)&&typeof widget.secret==='string'&&widget.secret.length>=20&&!testKey(widget.secret)&&widgetFits(widget);}
async function privateBucket(client,prefix,name){
 const managed=(await client.request('GET',prefix+'/r2/buckets/'+name+'/domains/managed')).result;
 const custom=(await client.request('GET',prefix+'/r2/buckets/'+name+'/domains/custom')).result;
 if(typeof managed?.enabled!=='boolean'||!Array.isArray(custom?.domains)||custom.domains.some(domain=>typeof domain.enabled!=='boolean'))throw Error('Cannot verify that the evidence bucket is private.');
 if(managed.enabled||custom.domains.some(domain=>domain.enabled))throw Error('The evidence bucket allows direct public access. Review its r2.dev/custom domains before storing private files. Its public settings were not changed.');
}

function fingerprint(settings){const db=own(settings,'DB'),files=own(settings,'FILES'),kv=own(settings,'FILE_KV');return JSON.stringify({date:settings.compatibility_date,flags:[...(settings.compatibility_flags??[])].sort(),db:db?{type:db.type,id:db.id}:null,files:files?{type:files.type,bucket:files.bucket_name,jurisdiction:files.jurisdiction||'default'}:null,kv:kv?{type:kv.type,id:kv.namespace_id}:null,siteKey:publicKey(settings)});}

export async function prepareAutomaticDeployment({token,base,fetchFn,mask=()=>{},log=()=>{},generateSecret=()=>randomBytes(32).toString('hex')}){
 if(base.name!==TARGET.worker||base.vars?.PUBLIC_ORIGIN!==TARGET.origin)throw Error('Automatic deployment is restricted to the existing Meridian Worker and hostname.');
 const client=new CloudflareClient(token,{fetchFn,mask});const id=await findAccount(client),prefix='/accounts/'+id,workerPath=prefix+'/workers/scripts/'+TARGET.worker;
 const response=await client.request('GET',workerPath+'/settings',{optional:[404]});if(!response)throw Error('The existing meridian-research-terminal Worker was not found. No replacement Worker was created.');
 const settings=response.result;const flags=validateSettings(settings);log('Confirmed the existing Worker and preserved its runtime compatibility settings.');
 const auth=own(settings,'AUTH_SECRET');
 if(auth?.type==='plain_text'){
  mask(auth.text||'');if(typeof auth.text!=='string'||auth.text.trim().length<32||/^(fixture|local-development)/.test(auth.text))throw Error('The existing AUTH_SECRET needs review; it was not replaced because that could break passwords.');
 }
 const dbBinding=own(settings,'DB'),fileBinding=own(settings,'FILES'),kvBinding=own(settings,'FILE_KV');
 if(dbBinding&&!databaseId.test(dbBinding.id||''))throw Error('The existing DB binding is invalid; it was preserved for review.');
 if(fileBinding?.jurisdiction&&fileBinding.jurisdiction!=='default')throw Error('The existing R2 jurisdiction needs an explicit configuration migration.');
 const bucketName=fileBinding?.bucket_name;if(fileBinding&&!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName||''))throw Error('The existing file bucket needs review.');

 // Read the resources before creating anything. Missing permissions fail early.
 if(fileBinding){
  const bucketReply=await client.request('GET',prefix+'/r2/buckets/'+bucketName,{optional:[404]});
  if(!bucketReply)throw Error('The bound R2 bucket is missing. It was not silently replaced.');
  if(bucketReply.result?.name!==undefined&&bucketReply.result.name!==bucketName)throw Error('Unexpected R2 bucket response.');
  await privateBucket(client,prefix,bucketName);
 }
 let database;
 if(dbBinding)database=(await client.request('GET',prefix+'/d1/database/'+dbBinding.id)).result;
 else{const candidates=(await list(client,prefix+'/d1/database?name='+TARGET.database)).filter(item=>item.name===TARGET.database);if(candidates.length>1)throw Error('Multiple matching databases require review.');database=candidates[0];}
 if(database){if(!databaseId.test(database.uuid||'')||dbBinding&&database.uuid!==dbBinding.id)throw Error('The existing database identity could not be verified.');const hasFiles=await inspectDatabase(client,prefix,database.uuid);if(hasFiles&&!fileBinding&&!kvBinding)throw Error('Existing file records have no storage binding. A data migration is required; files were preserved.');}

 let namespaceId=kvBinding?.namespace_id;
 if(!fileBinding){
  const available=await list(client,prefix+'/storage/kv/namespaces');
  if(namespaceId&&!available.some(item=>item.id===namespaceId))throw Error('The bound file namespace is missing or inaccessible. Existing files were preserved.');
  if(!namespaceId){
   const candidates=available.filter(item=>item.title===TARGET.namespace);
   if(candidates.length>1)throw Error('Multiple file namespaces require review.');
   namespaceId=candidates[0]?.id;
   if(namespaceId&&!accountId.test(namespaceId))throw Error('The existing file namespace identifier is invalid.');
  }
 }

 let widget;const siteKey=publicKey(settings);
 if(siteKey){
  if(testKey(siteKey)||!/^[a-zA-Z0-9_-]{1,32}$/.test(siteKey))throw Error('The existing Turnstile site key needs review. It was not silently replaced.');
  widget=(await client.request('GET',prefix+'/challenges/widgets/'+siteKey)).result;
  if(!validWidget(widget)||widget.sitekey!==siteKey)throw Error('The existing Turnstile widget does not match this site or has no usable production keys.');
 }else{
  const candidates=(await list(client,prefix+'/challenges/widgets')).filter(item=>item.name===TARGET.widget);
  if(candidates.length>1)throw Error('Multiple bootstrap widgets require review; no arbitrary widget was selected.');
  if(candidates.length){widget=(await client.request('GET',prefix+'/challenges/widgets/'+candidates[0].sitekey)).result;if(!validWidget(widget))throw Error('The existing bootstrap widget needs review.');}
 }

 if(!database){database=(await client.request('POST',prefix+'/d1/database',{body:{name:TARGET.database}})).result;if(!databaseId.test(database?.uuid||''))throw Error('Cloudflare did not return a valid new database identifier.');log('Created the missing D1 database.');}
 if(!fileBinding&&!namespaceId){const created=(await client.request('POST',prefix+'/storage/kv/namespaces',{body:{title:TARGET.namespace}})).result;namespaceId=created?.id;if(!accountId.test(namespaceId||''))throw Error('Cloudflare did not return a valid file namespace identifier.');log('Created the missing private KV file namespace.');}
 if(!widget){widget=(await client.request('POST',prefix+'/challenges/widgets',{body:{name:TARGET.widget,domains:[new URL(TARGET.origin).hostname],mode:'managed',clearance_level:'no_clearance'}})).result;if(!validWidget(widget))throw Error('Cloudflare did not return usable Turnstile production keys.');log('Created the missing production Turnstile widget.');}
 mask(widget.secret);
 const secrets=[{name:'TURNSTILE_SECRET_KEY',text:widget.secret}];
 if(!auth){const secret=generateSecret();if(typeof secret!=='string'||secret.length<32)throw Error('Application secret generation failed.');mask(secret);secrets.push({name:'AUTH_SECRET',text:secret,onlyIfMissing:true});}
 else if(auth.type==='plain_text')secrets.push({name:'AUTH_SECRET',text:auth.text,previousText:auth.text});
 else log('Preserved the existing encrypted AUTH_SECRET; existing passwords remain verifiable.');

 const config=structuredClone(base);config.account_id=id;config.compatibility_date=settings.compatibility_date;config.compatibility_flags=flags;config.keep_vars=true;
 const namespaces=settings.bindings.filter(binding=>binding.type==='kv_namespace').map(binding=>({binding:binding.name,id:binding.namespace_id}));
 if(!fileBinding&&!kvBinding)namespaces.push({binding:'FILE_KV',id:namespaceId});
 if(namespaces.length)config.kv_namespaces=namespaces;else delete config.kv_namespaces;
 config.d1_databases=[{binding:'DB',database_name:database.name||TARGET.database,database_id:database.uuid,migrations_dir:'migrations'}];
 if(fileBinding)config.r2_buckets=[{binding:'FILES',bucket_name:bucketName}];else delete config.r2_buckets;
 config.vars={...base.vars,APP_ENV:'production',PUBLIC_ORIGIN:TARGET.origin,TURNSTILE_SITE_KEY:widget.sitekey};
 for(const name of ['AUTH_SECRET','TURNSTILE_SECRET_KEY','CLOUDFLARE_API_TOKEN'])delete config.vars[name];
 return {client,config,secrets,workerPath,originalFingerprint:fingerprint(settings)};
}

export async function applyAutomaticSecrets(plan){
 const current=(await plan.client.request('GET',plan.workerPath+'/settings')).result;
 if(fingerprint(current)!==plan.originalFingerprint)throw Error('The Worker settings changed during preparation. Retry after reviewing the new settings. No secret was updated.');
 for(const secret of plan.secrets){
  const existing=own(current,secret.name);
  if(secret.onlyIfMissing&&existing)continue;
  if(secret.previousText!==undefined&&(existing?.type!=='plain_text'||existing.text!==secret.previousText))throw Error('The application secret changed during preparation. It was preserved.');
  await plan.client.request('PUT',plan.workerPath+'/secrets',{body:{name:secret.name,type:'secret_text',text:secret.text}});
 }
}
