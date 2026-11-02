import type {Env,Session,User,Post} from './types';
import {Problem,json,body,object,text,visibility,integer,id,origin,limited,now,security} from './http';
import {authConfigured,authLimit,captcha,email,password,hashPassword,verifyPassword,issue,session,csrf,clearCookies} from './auth';
import {upload,listFiles,fileChange,media} from './files';
import {instrument,quotes} from './markets';
const VERSION='6.0.0';
const POST_SELECT='SELECT p.id,p.owner_id,p.title,p.body,p.visibility,p.version,p.created_at,p.updated_at,u.display_name AS author FROM posts p JOIN users u ON u.id=p.owner_id';
async function write(request:Request,env:Env){origin(request,env);const current=(await session(request,env))!;await csrf(request,current);await limited(env.WRITE_LIMITER,current.user.id);return current;}
function postForm(value:unknown,updating=false){const form=object(value,['title','body','visibility','version','captchaToken']);return {title:text(form.title,'Title',160).trim(),body:text(form.body,'Note',10000),visibility:visibility(form.visibility??'private'),version:updating?integer(form.version,1,1_000_000_000):1,captchaToken:form.captchaToken};}
async function handle(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if((path.startsWith('/api/')||path.startsWith('/media/')||path==='/healthz')&&(method==='GET'||method==='HEAD'))await limited(env.READ_LIMITER,'ip:'+String(request.headers.get('CF-Connecting-IP')||'unknown'));
 if(path==='/healthz'){
  let db=false;try{const schema=await env.DB?.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('users','sessions','posts','posts_fts','files','watchlist')").first<{count:number}>();db=schema?.count===6;}catch{/* no credentials or internal SQL in the health response */}
  const ready=db&&!!env.FILES&&authConfigured(env)&&!!env.AUTH_LIMITER&&!!env.WRITE_LIMITER&&!!env.READ_LIMITER;
  return json({status:ready?'ok':'setup_required',version:VERSION,checks:{database:db,files:!!env.FILES,accounts:authConfigured(env)}},ready?200:503);
 }
 if(path==='/api/config'&&method==='GET')return json({version:VERSION,accountsReady:authConfigured(env),turnstileSiteKey:env.TURNSTILE_SITE_KEY||'',maxFileBytes:2097152,marketPollSeconds:60,configuredInstruments:5000});
 if(!path.startsWith('/api/')&&!path.startsWith('/media/'))return env.ASSETS.fetch(request);
 if(!env.DB)throw new Problem(503,'The database is not configured.');
 if(path==='/api/session'&&method==='GET'){const current=await session(request,env,false);return json({user:current?.user??null});}
 if((path==='/api/auth/register'||path==='/api/auth/login')&&method==='POST'){
  origin(request,env);const form=object(await body(request),path.endsWith('register')?['email','password','displayName','captchaToken']:['email','password','captchaToken']);
  const address=email(form.email),secret=password(form.password);await authLimit(request,env,address);await captcha(request,env,form.captchaToken,path.endsWith('register')?'register':'login');
  let user:User;
  if(path.endsWith('register')){
   const displayName=text(form.displayName,'Display name',80).trim();if(!displayName)throw new Problem(422,'Enter a display name.');
   const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(address).first();if(existing)throw new Problem(409,'An account could not be created with these details. Try signing in.');
   user={id:crypto.randomUUID(),email:address,display_name:displayName,created_at:now()};
   try{await env.DB.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(user.id,address,displayName,await hashPassword(secret,env),user.created_at).run();}catch{throw new Problem(409,'An account could not be created with these details.');}
  }else{
   const found=await env.DB.prepare('SELECT id,email,display_name,password_hash,created_at FROM users WHERE email=?').bind(address).first<User&{password_hash:string}>();
   if(!await verifyPassword(secret,found?.password_hash,env))throw new Problem(401,'Email or password is incorrect.');
   user={id:found!.id,email:found!.email,display_name:found!.display_name,created_at:found!.created_at};
  }
  const result=await issue(env,user);return json({user:result.user},path.endsWith('register')?201:200,result.headers);
 }
 if(path==='/api/auth/logout'&&method==='POST'){const current=await write(request,env);await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(current.token_hash).run();return json({ok:true},200,clearCookies());}
 if(path==='/api/account'&&method==='PATCH'){
  const current=await write(request,env);const form=object(await body(request),['displayName']);const name=text(form.displayName,'Display name',80).trim();if(!name)throw new Problem(422,'Enter a display name.');
  await env.DB.prepare('UPDATE users SET display_name=? WHERE id=?').bind(name,current.user.id).run();return json({user:{...current.user,display_name:name}});
 }
 if(path==='/api/account/password'&&method==='POST'){
  const current=await write(request,env);const form=object(await body(request),['currentPassword','newPassword']);const old=password(form.currentPassword),next=password(form.newPassword);
  const found=await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(current.user.id).first<{password_hash:string}>();
  if(!await verifyPassword(old,found?.password_hash,env))throw new Problem(400,'The current password is incorrect.');
  await env.DB.batch([env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(next,env),current.user.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(current.user.id)]);
  const result=await issue(env,current.user);return json({ok:true},200,result.headers);
 }
 if(path==='/api/posts'&&method==='GET'){
  const mine=url.searchParams.get('scope')==='mine';const current=await session(request,env,mine);await limited(env.READ_LIMITER,current?.user.id||request.headers.get('CF-Connecting-IP')||'public');
  const offset=Math.min(1000,Math.max(0,Number(url.searchParams.get('offset'))||0));
  const result=await env.DB.prepare(POST_SELECT+(mine?' WHERE p.owner_id=?':' WHERE p.visibility=?')+' ORDER BY p.updated_at DESC,p.id LIMIT 25 OFFSET ?').bind(mine?current!.user.id:'public',offset).all<Post>();
  return json({items:result.results.map(p=>({...p,body:p.body.slice(0,240)})),offset});
 }
 if(path==='/api/posts'&&method==='POST'){
  const current=await write(request,env);const form=postForm(await body(request));if(!form.title)throw new Problem(422,'Enter a title.');if(form.visibility==='public')await captcha(request,env,form.captchaToken,'publish');
  const postId=crypto.randomUUID(),stamp=now();const result=await env.DB.prepare('INSERT INTO posts(id,owner_id,title,body,visibility,version,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM posts WHERE owner_id=?)<100').bind(postId,current.user.id,form.title,form.body,form.visibility,stamp,stamp,current.user.id).run();
  if(!result.meta.changes)throw new Problem(409,'Your account has reached its 100-note limit.');return json({id:postId,version:1},201);
 }
 const postMatch=path.match(/^\/api\/posts\/([^/]+)$/);
 if(postMatch){const postId=id(postMatch[1]);
  if(method==='GET'){const current=await session(request,env,false);const found=await env.DB.prepare(POST_SELECT+' WHERE p.id=? AND (p.visibility=\'public\' OR p.owner_id=?)').bind(postId,current?.user.id||'').first<Post>();if(!found)throw new Problem(404,'Note not found.');return json({post:found});}
  if(method==='PATCH'||method==='DELETE'){
   const current=await write(request,env);const found=await env.DB.prepare('SELECT * FROM posts WHERE id=? AND owner_id=?').bind(postId,current.user.id).first<Post>();if(!found)throw new Problem(404,'Note not found.');
   if(method==='DELETE'){const form=object(await body(request),['version']);const result=await env.DB.prepare('DELETE FROM posts WHERE id=? AND owner_id=? AND version=?').bind(postId,current.user.id,integer(form.version,1,1_000_000_000)).run();if(!result.meta.changes)throw new Problem(409,'This note changed. Reload before deleting it.');return json({ok:true});}
   const form=postForm(await body(request),true);if(!form.title)throw new Problem(422,'Enter a title.');if(form.visibility==='public')await captcha(request,env,form.captchaToken,'publish');
   const result=await env.DB.prepare('UPDATE posts SET title=?,body=?,visibility=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?').bind(form.title,form.body,form.visibility,now(),postId,current.user.id,form.version).run();
   if(!result.meta.changes)throw new Problem(409,'This note changed in another tab. Reload before saving.');return json({id:postId,version:form.version+1});
  }
 }
 if(path==='/api/search'&&method==='GET'){
  const q=(url.searchParams.get('q')||'').trim().slice(0,100);const scope=url.searchParams.get('scope')||'public';const current=await session(request,env,scope==='mine');await limited(env.READ_LIMITER,current?.user.id||request.headers.get('CF-Connecting-IP')||'public');
  const tokens=q.match(/[\p{L}\p{N}]+/gu)?.slice(0,5)??[];if(!tokens.length)return json({items:[]});
  const query=tokens.map(t=>'"'+t+'"*').join(' AND ');
  const restriction=scope==='mine'?'p.owner_id=?':"p.visibility='public'";
  const sql=POST_SELECT+' JOIN posts_fts ON posts_fts.rowid=p.rowid WHERE posts_fts MATCH ? AND '+restriction+' ORDER BY p.updated_at DESC LIMIT 50';
  const prepared=env.DB.prepare(sql);const result=await (scope==='mine'?prepared.bind(query,current!.user.id):prepared.bind(query)).all<Post>();return json({items:result.results.map(p=>({...p,body:p.body.slice(0,240)}))});
 }
 if(path==='/api/files'&&method==='GET')return listFiles(env,(await session(request,env))!);
 if(path==='/api/files'&&method==='POST')return upload(request,env,await write(request,env));
 const fileMatch=path.match(/^\/api\/files\/([^/]+)$/);if(fileMatch&&(method==='PATCH'||method==='DELETE'))return fileChange(request,env,await write(request,env),id(fileMatch[1]));
 const mediaMatch=path.match(/^\/media\/([^/]+)$/);if(mediaMatch&&(method==='GET'||method==='HEAD'))return media(request,env,id(mediaMatch[1]),ctx);
 if(path==='/api/watchlist'&&method==='GET'){const current=(await session(request,env))!;const result=await env.DB.prepare('SELECT symbol,created_at FROM watchlist WHERE user_id=? ORDER BY created_at DESC,symbol LIMIT 50').bind(current.user.id).all<{symbol:string;created_at:number}>();return json({items:result.results.map(r=>({...instrument(r.symbol),created_at:r.created_at}))});}
 if(path==='/api/watchlist'&&(method==='POST'||method==='DELETE')){
  const current=await write(request,env);const form=object(await body(request),['symbol']);const row=instrument(text(form.symbol,'Symbol',40).toUpperCase());
  if(method==='DELETE')await env.DB.prepare('DELETE FROM watchlist WHERE user_id=? AND symbol=?').bind(current.user.id,row.symbol).run();
  else {const existing=await env.DB.prepare('SELECT symbol FROM watchlist WHERE user_id=? AND symbol=?').bind(current.user.id,row.symbol).first();if(!existing){const result=await env.DB.prepare('INSERT INTO watchlist(user_id,symbol,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM watchlist WHERE user_id=?)<50').bind(current.user.id,row.symbol,now(),current.user.id).run();if(!result.meta.changes)throw new Problem(409,'Keep at most 50 securities in your watchlist.');}}
  return json({ok:true});
 }
 if(path==='/api/markets/quotes'&&method==='GET'){
  const current=(await session(request,env))!;await limited(env.READ_LIMITER,'quotes:'+current.user.id);
  const symbols=[...new Set((url.searchParams.get('symbols')||'').split(',').filter(Boolean))].sort();if(!symbols.length||symbols.length>20)throw new Problem(422,'Request 1–20 visible watchlist securities.');symbols.forEach(instrument);
  const owned=await env.DB.prepare('SELECT symbol FROM watchlist WHERE user_id=?').bind(current.user.id).all<{symbol:string}>();const wanted=new Set(owned.results.map(r=>r.symbol));if(symbols.some(s=>!wanted.has(s)))throw new Problem(403,'Add a security to your own watchlist first.');
  return json(await quotes(symbols,request,ctx));
 }
 throw new Problem(404,'This endpoint does not exist.');
}
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){try{return security(await handle(request,env,ctx));}catch(error){if(error instanceof Problem)return security(json({error:error.message},error.status,error.status===429?{'Retry-After':'60'}:{}));return security(json({error:'The service could not complete this request. Please retry or check the deployment configuration.'},503));}}} satisfies ExportedHandler<Env>;
