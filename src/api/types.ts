export interface Limiter {limit(value:{key:string}):Promise<{success:boolean}>}
export interface Env {
 DB:D1Database; FILES:R2Bucket; ASSETS:Fetcher;
 AUTH_LIMITER:Limiter; WRITE_LIMITER:Limiter; READ_LIMITER:Limiter;
 APP_ENV?:string; AUTH_SECRET?:string; PUBLIC_ORIGIN?:string;
 TURNSTILE_SITE_KEY?:string; TURNSTILE_SECRET_KEY?:string;
}
export interface User {id:string;email:string;display_name:string;created_at:number}
export interface Session {token_hash:string;csrf_hash:string;user:User}
export interface Post {id:string;owner_id:string;title:string;body:string;visibility:'private'|'public';version:number;created_at:number;updated_at:number;author?:string}
export interface StoredFile {id:string;owner_id:string;object_key:string;filename:string;mime:string;bytes:number;visibility:'private'|'public';status:'pending'|'ready';created_at:number}
