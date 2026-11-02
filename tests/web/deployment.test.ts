// @vitest-environment node
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {configure} from '../../scripts/configure-deploy.mjs';
const base=JSON.parse(readFileSync(join(process.cwd(),'wrangler.jsonc'),'utf8'));
const env={CLOUDFLARE_ACCOUNT_ID:'1234567890abcdef1234567890abcdef',CLOUDFLARE_D1_DATABASE_ID:'11111111-2222-4333-8444-555555555555',CLOUDFLARE_R2_BUCKET:'meridian-files',PUBLIC_ORIGIN:'https://meridian-research-terminal.cooked-jersey.workers.dev',TURNSTILE_SITE_KEY:'production-public-site-key'};
it('keeps the existing Worker name, variables policy and compatibility settings',()=>{const config=configure(env,base);expect(config.name).toBe('meridian-research-terminal');expect(config.keep_vars).toBe(true);expect(config.compatibility_date).toBe(base.compatibility_date);expect(config.compatibility_flags).toEqual(base.compatibility_flags);expect(config.account_id).toBe(env.CLOUDFLARE_ACCOUNT_ID);expect(base.d1_databases[0].database_id).toMatch(/^0000/);});
it('does not copy authentication secrets into the deployment file',()=>{const config=configure({...env,AUTH_SECRET:'test-must-not-persist',CLOUDFLARE_API_TOKEN:'token-must-not-persist',TURNSTILE_SECRET_KEY:'secret-must-not-persist'},base);expect(JSON.stringify(config)).not.toContain('must-not-persist');});
it.each([{CLOUDFLARE_D1_DATABASE_ID:'00000000-0000-0000-0000-000000000000'},{PUBLIC_ORIGIN:env.PUBLIC_ORIGIN+'/'},{PUBLIC_ORIGIN:'http://example.com'},{TURNSTILE_SITE_KEY:'1x00000000000000000000AA'},{CLOUDFLARE_R2_BUCKET:'Bad Bucket'},{CLOUDFLARE_ACCOUNT_ID:''}])('rejects incomplete or unsafe deployment values %j',changes=>{expect(()=>configure({...env,...changes},base)).toThrow();});
it('reports a skipped deployment when CI credentials are missing, without leaking values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'meridian-preflight-'));try{const result=spawnSync(process.execPath,['scripts/deploy-preflight.mjs'],{cwd:process.cwd(),encoding:'utf8',env:{PATH:process.env.PATH!,AUTH_SECRET:'private-test-value',GITHUB_OUTPUT:join(dir,'output'),GITHUB_STEP_SUMMARY:join(dir,'summary')}});expect(result.status).toBe(0);expect(readFileSync(join(dir,'output'),'utf8')).toBe('configured=false\n');expect(readFileSync(join(dir,'summary'),'utf8')).toContain('Publishing was skipped');expect(result.stdout).not.toContain('private-test-value');}finally{rmSync(dir,{recursive:true,force:true});}
});
