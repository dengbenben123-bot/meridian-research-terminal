import {appendFile} from 'node:fs/promises';
const missing=['CLOUDFLARE_API_TOKEN'].filter(key=>!process.env[key]);
const configured=missing.length===0;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`configured=${configured}\n`);
if(!configured){console.log('::warning::Publishing was skipped. Add the single GitHub repository secret CLOUDFLARE_API_TOKEN. The existing live Worker was not changed.');if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'### One authorization is required\n\nThe build and tests ran. Publishing was skipped; the existing live Worker was not changed.\n\nAdd the repository secret **CLOUDFLARE_API_TOKEN**, then run this workflow again. The deployment prepares the other settings automatically. See [DEPLOY.md](../blob/main/DEPLOY.md).\n');}
else console.log('Cloudflare deployment authorization is present. No credential was printed.');
