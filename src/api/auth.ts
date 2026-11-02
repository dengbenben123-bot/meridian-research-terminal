import type {Env,User,Session} from './types';
import {Problem,now,limited} from './http';
const encoder=new TextEncoder();const ITERATIONS=100000;const SESSION_SECONDS=7*86400;
const dummy='pbkdf2v1$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export function base64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function from64(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
export function random(){return base64(crypto.getRandomValues(new Uint8Array(32)));}
export async function digest(value:string){return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
function testKeys(env:Env){return /^[123]x0+/.test(env.TURNSTILE_SECRET_KEY||'')||/^[123]x0+/.test(env.TURNSTILE_SITE_KEY||'');}
export function authConfigured(env:Env){
 if(!env.DB||!env.AUTH_SECRET||env.AUTH_SECRET.length<32||!env.TURNSTILE_SITE_KEY||!env.TURNSTILE_SECRET_KEY)return false;
 try{const url=new URL(env.PUBLIC_ORIGIN||'');if(url.origin!==(env.PUBLIC_ORIGIN||'').replace(/\/$/,'')||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!(env.APP_ENV==='development'&&['localhost','127.0.0.1'].includes(url.hostname)))return false;}catch{return false;}
 if(testKeys(env)){try{return env.APP_ENV==='development'&&['localhost','127.0.0.1'].includes(new URL(env.PUBLIC_ORIGIN||'').hostname);}catch{return false;}}
 return true;
}
function configured(env:Env){if(!authConfigured(env))throw new Problem(503,'Account setup is incomplete. Configure the application secret and Turnstile keys.');}
async function derive(password:string,salt:Uint8Array,env:Env){
 const pepper=await crypto.subtle.importKey('raw',encoder.encode(env.AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const input=await crypto.subtle.sign('HMAC',pepper,encoder.encode(password));
 const key=await crypto.subtle.importKey('raw',input,'PBKDF2',false,['deriveBits']);
 return base64(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt as BufferSource,iterations:ITERATIONS,hash:'SHA-256'},key,256)));
}
export async function hashPassword(password:string,env:Env){configured(env);const salt=crypto.getRandomValues(new Uint8Array(16));return `pbkdf2v1$${ITERATIONS}$${base64(salt)}$${await derive(password,salt,env)}`;}
export async function verifyPassword(password:string,stored:string|undefined,env:Env){configured(env);const parts=(stored||dummy).split('$');if(parts.length!==4||parts[0]!=='pbkdf2v1'||Number(parts[1])!==ITERATIONS)return false;try{return equal(await derive(password,from64(parts[2]),env),parts[3])&&!!stored;}catch{return false;}}
export function email(value:unknown){if(typeof value!=='string')throw new Problem(422,'Enter a valid email address.');const result=value.trim().toLowerCase();if(result.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(result))throw new Problem(422,'Enter a valid email address.');return result;}
export function password(value:unknown){if(typeof value!=='string'||value.length<12||value.length>128)throw new Problem(422,'Use a password with 12–128 characters.');return value;}
export async function authLimit(request:Request,env:Env,identity:string){configured(env);const ip=request.headers.get('CF-Connecting-IP')||'unknown';await limited(env.AUTH_LIMITER,'ip:'+await digest(ip+'|'+env.AUTH_SECRET));await limited(env.AUTH_LIMITER,'email:'+await digest(identity));}
export async function captcha(request:Request,env:Env,token:unknown,action:string){
 configured(env);if(typeof token!=='string'||!token||token.length>2048)throw new Problem(400,'Complete the security check.');
 let verification:Record<string,unknown>;
 try{const reply=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:request.headers.get('CF-Connecting-IP')||undefined,idempotency_key:crypto.randomUUID()}),signal:AbortSignal.timeout(8000)});if(!reply.ok)throw Error();verification=await reply.json();}catch{throw new Problem(503,'The security check is temporarily unavailable. Please retry.');}
 const localDummy=env.APP_ENV==='development'&&testKeys(env);
 const stamp=Date.parse(String(verification.challenge_ts));const age=Date.now()-stamp;
 if(verification.success!==true||(!localDummy&&(verification.hostname!==new URL(env.PUBLIC_ORIGIN!).hostname||verification.action!==action||!Number.isFinite(stamp)||age>300000||age< -60000)))throw new Problem(400,'The security check expired or failed. Please try it again.');
}
export function cookies(request:Request){return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2));}
export async function session(request:Request,env:Env,required=true):Promise<Session|null>{
 const token=cookies(request)['__Host-meridian_session'];if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)){if(required)throw new Problem(401,'Please sign in.');return null;}
 const row=await env.DB.prepare('SELECT s.token_hash,s.csrf_hash,u.id,u.email,u.display_name,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),now()).first<{token_hash:string;csrf_hash:string}&User>();
 if(!row){if(required)throw new Problem(401,'Your session expired. Please sign in.');return null;}
 return {token_hash:row.token_hash,csrf_hash:row.csrf_hash,user:{id:row.id,email:row.email,display_name:row.display_name,created_at:row.created_at}};
}
export async function csrf(request:Request,current:Session){const token=request.headers.get('X-CSRF-Token');if(!token||!equal(await digest(token),current.csrf_hash))throw new Problem(403,'Refresh the page and retry this action.');}
export async function issue(env:Env,user:User){
 const token=random(),csrfToken=random(),stamp=now();
 await env.DB.batch([
 env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND (expires_at<=? OR token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9))').bind(user.id,stamp,user.id),
 env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?)').bind(await digest(token),user.id,await digest(csrfToken),stamp,stamp+SESSION_SECONDS)]);
 const headers=new Headers();headers.append('Set-Cookie',`__Host-meridian_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);headers.append('Set-Cookie',`__Host-meridian_csrf=${csrfToken}; Path=/; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
 return {headers,user};
}
export function clearCookies(){const headers=new Headers();for(const name of ['__Host-meridian_session','__Host-meridian_csrf'])headers.append('Set-Cookie',`${name}=; Path=/; Secure; SameSite=Lax; Max-Age=0${name.endsWith('_session')?'; HttpOnly':''}`);return headers;}
