import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {prepareAutomaticDeployment,applyAutomaticSecrets,TARGET} from './cloudflare-bootstrap.mjs';

const escape=value=>String(value).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
const mask=value=>{if(process.env.GITHUB_ACTIONS==='true'&&value)process.stdout.write('::add-mask::'+escape(value)+'\n');};
const childEnv={...process.env,CI:'true',PUBLIC_ORIGIN:TARGET.origin};
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{env:childEnv,stdio:'inherit'});child.on('error',()=>reject(Error('Could not start the deployment command.')));child.on('close',code=>code===0?resolve():reject(Error('A deployment command failed. Read the named step above before retrying.')));});}

try{
 const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const plan=await prepareAutomaticDeployment({token:process.env.CLOUDFLARE_API_TOKEN,base,mask,log:message=>console.log(message)});
 childEnv.CLOUDFLARE_ACCOUNT_ID=plan.config.account_id;
 await writeFile('wrangler.deploy.json',JSON.stringify(plan.config,null,2)+'\n');
 const wrangler=['node_modules/wrangler/bin/wrangler.js'];
 await run([...wrangler,'deploy','--dry-run','--config','wrangler.deploy.json','--outdir','dist/worker']);
 await run([...wrangler,'d1','migrations','apply','DB','--remote','--config','wrangler.deploy.json']);
 await applyAutomaticSecrets(plan);
 await run([...wrangler,'deploy','--config','wrangler.deploy.json']);
 await run(['scripts/verify-live.mjs']);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'### Meridian deployed and verified\n\nRelease **6.0.0** was verified at '+TARGET.origin+'.\n\nThe existing Worker and compatibility settings were retained. App secrets remain in Cloudflare; no generated credential was saved to the repository.\n');
}catch(error){console.error('Deployment stopped: '+error.message);process.exitCode=1;}
