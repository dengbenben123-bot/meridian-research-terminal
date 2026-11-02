import {appendFile} from 'node:fs/promises';
import {required} from './configure-deploy.mjs';
const missing=[...required,'CLOUDFLARE_API_TOKEN','AUTH_SECRET','TURNSTILE_SECRET_KEY'].filter(key=>!process.env[key]);
const configured=missing.length===0;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`configured=${configured}\n`);
if(!configured){console.log('::warning::Cloudflare deployment setup is incomplete. Missing names: '+missing.join(', ')+'. The existing live Worker was not changed.');if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'### Deployment setup required\n\nThe build and tests ran. Publishing was skipped; the existing live Worker was not changed.\n\nConfigure these names in repository Variables/Secrets: `'+missing.join('`, `')+'`. See DEPLOY.md.\n');}
else if(process.env.AUTH_SECRET.trim().length<32||/^(fixture|local-development)/.test(process.env.AUTH_SECRET)||/^[123]x0+/.test(process.env.TURNSTILE_SECRET_KEY)){throw Error('Use a stable random production AUTH_SECRET and a production Turnstile secret.');}
else console.log('Required deployment settings are present. No values were printed.');
