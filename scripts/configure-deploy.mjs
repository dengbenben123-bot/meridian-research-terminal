import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const required=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_D1_DATABASE_ID','CLOUDFLARE_R2_BUCKET','PUBLIC_ORIGIN','TURNSTILE_SITE_KEY'];
export function configure(environment,base){
 const absent=required.filter(name=>!environment[name]);if(absent.length)throw Error('Configure these repository variables: '+absent.join(', '));
 if(!/^[a-f0-9]{32}$/i.test(environment.CLOUDFLARE_ACCOUNT_ID))throw Error('Invalid Cloudflare account ID.');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(environment.CLOUDFLARE_D1_DATABASE_ID)||/^0+-0+-0+-0+-0+$/.test(environment.CLOUDFLARE_D1_DATABASE_ID))throw Error('Use the real D1 database ID.');
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(environment.CLOUDFLARE_R2_BUCKET))throw Error('Invalid R2 bucket name.');
 const origin=new URL(environment.PUBLIC_ORIGIN);if(origin.origin!==environment.PUBLIC_ORIGIN||origin.protocol!=='https:')throw Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
 if(/^[123]x0+/.test(environment.TURNSTILE_SITE_KEY))throw Error('Use a production Turnstile site key.');
 if(base.name!=='meridian-research-terminal')throw Error('Unexpected Worker target.');
 const config=structuredClone(base);config.account_id=environment.CLOUDFLARE_ACCOUNT_ID;config.d1_databases[0].database_id=environment.CLOUDFLARE_D1_DATABASE_ID;config.r2_buckets[0].bucket_name=environment.CLOUDFLARE_R2_BUCKET;
 config.vars={...config.vars,APP_ENV:'production',PUBLIC_ORIGIN:origin.origin,TURNSTILE_SITE_KEY:environment.TURNSTILE_SITE_KEY};return config;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const config=configure(process.env,JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')));await writeFile(new URL('../wrangler.deploy.json',import.meta.url),JSON.stringify(config,null,2)+'\n');console.log('Prepared deployment configuration for the existing meridian-research-terminal Worker.');}catch(error){console.error(error.message);process.exitCode=1;}
}
