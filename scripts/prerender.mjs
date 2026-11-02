import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('dist/client/',root);
const pages=JSON.parse(await readFile(new URL('content/pages.json',root),'utf8'));
const shell=await readFile(new URL('index.html',out),'utf8');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const [key,route] of [['home',''],['guide','guide']]){
 const page=pages[key];const content=`<div class="site-shell"><header class="site-header"><a class="brand" href="/"><span class="brand-mark">M</span><strong>MERIDIAN</strong><small>RESEARCH</small></a><nav><a href="/research">Public research</a><a href="/guide">Product guide</a><a href="/login">Sign in ↗</a></nav></header><main class="public-page"><div class="eyebrow">${escape(page.eyebrow)}</div><section class="public-intro"><h1>${escape(page.title)}</h1><div class="intro-copy">${page.paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}<div class="public-actions"><a class="button primary" href="/register">Create your workspace ↗</a><a href="/research">Read public research →</a></div></div></section><section class="feature-index">${page.items.map((item,index)=>`<article><span class="index-number">0${index+1}</span><h2>${escape(item[0])}</h2><p>${escape(item[1])}</p></article>`).join('')}</section></main><footer class="site-footer"><span>Meridian / Research workspace</span><a href="/guide">Data &amp; access</a></footer></div>`;
 const html=shell.replace('<div id="app"></div>','<div id="app">'+content+'</div>').replace('<title>Meridian — Research, organised</title>',`<title>${escape(page.title)} · Meridian</title>`).replace('content="Organise market research, publish selected notes and keep your own data private."',`content="${escape(page.description)}"`);
 const directory=new URL(route?route+'/':'',out);await mkdir(directory,{recursive:true});await writeFile(new URL('index.html',directory),html);
}
console.log('Pre-rendered public home and product guide; private data remains API-only.');
