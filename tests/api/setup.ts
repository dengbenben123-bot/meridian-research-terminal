import {env} from 'cloudflare:workers';
import {beforeEach,afterEach,vi,expect} from 'vitest';
import {applyD1Migrations} from 'cloudflare:test';
import {verificationReplies,quoteReplies} from './mocks';
beforeEach(async()=>{
 await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);
 for(const table of ['sessions','watchlist','files','posts','users'])await env.DB.prepare('DELETE FROM '+table).run();
 const objects=await env.FILES.list();if(objects.objects.length)await env.FILES.delete(objects.objects.map(o=>o.key));
 verificationReplies.length=0;
 quoteReplies.length=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
   const reply=verificationReplies.shift();if(!reply)throw Error('Unexpected validation request');
   return new Response(JSON.stringify(reply),{headers:{'Content-Type':'application/json'}});
  }
  if(url.startsWith('https://qt.gtimg.cn/q=')){const reply=quoteReplies.shift();if(!reply)throw Error('Unexpected quote request');return new Response(reply);}
  throw Error('External network is disabled in these tests');
 });
});
afterEach(()=>{expect(verificationReplies).toHaveLength(0);expect(quoteReplies).toHaveLength(0);vi.restoreAllMocks();});
