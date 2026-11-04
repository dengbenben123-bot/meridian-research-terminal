import type {Env,Session,StoredFile} from './types';
import {Problem,bytes,json,text,now,object,visibility} from './http';
import {captcha,session} from './auth';
export const FILE_LIMIT=2*1024*1024;const QUOTA=20*1024*1024;
function mimeOf(data:Uint8Array){
 if(data.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b))return 'image/png';
 if(data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
 const prefix=new TextDecoder().decode(data.subarray(0,12));if(prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP')return 'image/webp';
 if(prefix.startsWith('%PDF-'))return 'application/pdf';throw new Problem(415,'Upload a PNG, JPEG, WebP image or PDF.');
}
function publicFile(row:StoredFile){const {object_key,status,...result}=row;return {...result,url:'/media/'+row.id};}
export async function listFiles(env:Env,current:Session){const rows=await env.DB.prepare("SELECT * FROM files WHERE owner_id=? AND status='ready' ORDER BY created_at DESC LIMIT 50").bind(current.user.id).all<StoredFile>();return json({items:rows.results.map(publicFile)});}
export async function upload(request:Request,env:Env,current:Session){
 if(!env.FILES&&!env.FILE_KV)throw new Problem(503,'File storage is not configured.');
 await captcha(request,env,request.headers.get('X-Turnstile-Token'),'upload');
 let filename:string;try{filename=decodeURIComponent(request.headers.get('X-Filename')||'');}catch{throw new Problem(422,'Invalid filename.');}
 filename=text(filename,'Filename',160).replace(/[\r\n\x00-\x1f]/g,'').split(/[/\\]/).at(-1)||'file';
 const data=await bytes(request,FILE_LIMIT);if(!data.length)throw new Problem(422,'Choose a non-empty file.');
 const mime=mimeOf(data);if(request.headers.get('Content-Type')?.split(';')[0]!==mime)throw new Problem(415,'The file signature and content type do not match.');
 const fileId=crypto.randomUUID(),key=current.user.id+'/'+fileId;
 const reserved=await env.DB.prepare("INSERT INTO files(id,owner_id,object_key,filename,mime,bytes,visibility,status,created_at) SELECT ?,?,?,?,?,?,'private','pending',? WHERE (SELECT COALESCE(SUM(bytes),0) FROM files WHERE owner_id=?)+?<=? AND (SELECT COUNT(*) FROM files WHERE owner_id=?)<50").bind(fileId,current.user.id,key,filename,mime,data.length,now(),current.user.id,data.length,QUOTA,current.user.id).run();
 if(!reserved.meta.changes)throw new Problem(409,'Your file quota is full: 20 MiB and 50 files per account.');
 const storage=env.FILES||env.FILE_KV!;
 try{
  if(env.FILES)await env.FILES.put(key,data,{httpMetadata:{contentType:mime}});
  else await env.FILE_KV!.put(key,data.buffer as ArrayBuffer);
  await env.DB.prepare("UPDATE files SET status='ready' WHERE id=? AND owner_id=?").bind(fileId,current.user.id).run();
 }
 catch{await storage.delete(key).catch(()=>{});await env.DB.prepare('DELETE FROM files WHERE id=? AND owner_id=?').bind(fileId,current.user.id).run();throw new Problem(503,'The upload did not complete. Please retry.');}
 return json({id:fileId,filename,mime,bytes:data.length,visibility:'private',url:'/media/'+fileId},201);
}
export async function fileChange(request:Request,env:Env,current:Session,fileId:string){
 const row=await env.DB.prepare("SELECT * FROM files WHERE id=? AND owner_id=? AND status='ready'").bind(fileId,current.user.id).first<StoredFile>();if(!row)throw new Problem(404,'File not found.');
 if(request.method==='DELETE'){
  const storage=env.FILES||env.FILE_KV;if(!storage)throw new Problem(503,'File storage is not configured.');
  // Hide before deletion. If storage deletion fails the object remains inaccessible.
  await env.DB.prepare("UPDATE files SET status='pending' WHERE id=? AND owner_id=?").bind(fileId,current.user.id).run();
  try{await storage.delete(row.object_key);}catch{await env.DB.prepare("UPDATE files SET status='ready' WHERE id=? AND owner_id=?").bind(fileId,current.user.id).run();throw new Problem(503,'File deletion did not complete.');}
  await env.DB.prepare('DELETE FROM files WHERE id=? AND owner_id=?').bind(fileId,current.user.id).run();return json({ok:true});
 }
 const {body}=await import('./http');const change=object(await body(request),['visibility','captchaToken']);const next=visibility(change.visibility);
 if(next==='public')await captcha(request,env,change.captchaToken,'publish');
 await env.DB.prepare('UPDATE files SET visibility=? WHERE id=? AND owner_id=?').bind(next,fileId,current.user.id).run();return json({ok:true,visibility:next});
}
export async function media(request:Request,env:Env,fileId:string,ctx:ExecutionContext){
 const row=await env.DB.prepare("SELECT * FROM files WHERE id=? AND status='ready'").bind(fileId).first<StoredFile>();if(!row)throw new Problem(404,'File not found.');
 if(row.visibility!=='public'){const current=await session(request,env,false);if(current?.user.id!==row.owner_id)throw new Problem(404,'File not found.');}
 const cacheable=row.visibility==='public'&&row.mime.startsWith('image/');const key=new Request(new URL('/__file-cache/'+row.id,request.url));
 // Permission is checked before every cache read, including after unpublishing.
 if(cacheable){const hit=await caches.default.match(key);if(hit)return request.method==='HEAD'?new Response(null,hit):hit;}
 if(!env.FILES&&!env.FILE_KV)throw new Problem(503,'File storage is not configured.');
 const object=env.FILES?await env.FILES.get(row.object_key):await env.FILE_KV!.get(row.object_key,'stream');
 if(!object)throw new Problem(env.FILES?404:503,env.FILES?'File not found.':'File is still becoming available. Please retry shortly.');
 const headers=new Headers({'Content-Type':row.mime,'Content-Length':String(row.bytes),'X-Content-Type-Options':'nosniff',
 'Cache-Control':cacheable?'public, max-age=60':'private, no-store',
 'Content-Disposition':`${row.mime==='application/pdf'?'attachment':'inline'}; filename="${row.filename.replace(/[^a-zA-Z0-9._-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`});
 const fileBody=env.FILES?(object as R2ObjectBody).body:object as ReadableStream;
 const response=new Response(request.method==='HEAD'?null:fileBody,{headers});
 if(cacheable&&request.method==='GET')ctx.waitUntil(caches.default.put(key,response.clone()));return response;
}
