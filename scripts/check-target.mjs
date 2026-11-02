import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.deploy.json','utf8'));
if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('CLOUDFLARE_API_TOKEN is required.');
async function read(path){const response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});let body;try{body=await response.json();}catch{throw Error('Unexpected Cloudflare API response.');}if(!response.ok||body.success!==true)throw Error('Cannot read existing Worker settings. Check account access and token permissions.');return body.result;}
const prefix='/accounts/'+config.account_id+'/workers';
const domain=await read(prefix+'/subdomain');if(domain.subdomain!=='cooked-jersey')throw Error('This account does not own the expected cooked-jersey.workers.dev subdomain.');
const settings=await read(prefix+'/scripts/meridian-research-terminal/settings');
if(!settings.compatibility_date||!Array.isArray(settings.compatibility_flags))throw Error('Cannot verify the existing compatibility settings.');
if(settings.compatibility_date<'2024-09-23'||settings.compatibility_flags.some(flag=>flag==='no_nodejs_compat'||flag==='no_nodejs_compat_v2'))throw Error('Existing compatibility settings require review; they were not changed.');
config.compatibility_date=settings.compatibility_date;config.compatibility_flags=settings.compatibility_flags;
const managed=new Set(['ASSETS','DB','FILES','AUTH_LIMITER','WRITE_LIMITER','READ_LIMITER']);
const existingDb=settings.bindings?.find(b=>b.name==='DB');const existingFiles=settings.bindings?.find(b=>b.name==='FILES');
if(existingDb?.id&&existingDb.id!==config.d1_databases[0].database_id)throw Error('The existing DB binding points elsewhere. Do not switch databases during an update.');
if(existingFiles?.bucket_name&&existingFiles.bucket_name!==config.r2_buckets[0].bucket_name)throw Error('The existing FILES binding points elsewhere. Do not switch buckets during an update.');
const extras=(settings.bindings||[]).filter(b=>!managed.has(b.name)&&!['plain_text','secret_text'].includes(b.type));
if(extras.length)throw Error('Additional existing bindings require explicit migration in wrangler.jsonc: '+extras.map(b=>b.name).join(', ')+'. Nothing was deployed.');
await writeFile('wrangler.deploy.json',JSON.stringify(config,null,2)+'\n');
console.log('Existing Worker confirmed; compatibility settings preserved. Existing variables and secrets are retained.');
