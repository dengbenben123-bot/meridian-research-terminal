import {reactive} from 'vue';
export interface User{id:string;email:string;display_name:string}
export interface Note{id:string;owner_id:string;title:string;body:string;visibility:'private'|'public';version:number;created_at:number;updated_at:number;author?:string}
export interface FileInfo{id:string;filename:string;mime:string;bytes:number;visibility:'private'|'public';url:string}
export interface WatchItem{symbol:string;name:string;currency:string}
export interface Quote extends WatchItem{price:number;change_pct:number|null;source_time:string}
export const state=reactive<{user:User|null;ready:boolean;config:{accountsReady:boolean;turnstileSiteKey:string;version:string}}>( {user:null,ready:false,config:{accountsReady:false,turnstileSiteKey:'',version:'6.0.0'}});
export function csrfToken(){return document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-meridian_csrf='))?.split('=')[1]||'';}
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers);if(init.body&&typeof init.body==='string')headers.set('Content-Type','application/json');if(init.method&&init.method!=='GET')headers.set('X-CSRF-Token',csrfToken());
 const response=await fetch(path,{...init,headers,credentials:'same-origin',cache:'no-store'});
 let data:any;try{data=await response.json();}catch{throw new Error('The service returned an unexpected response. Please retry.');}
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'The request could not be completed.');return data;
}
export const send=<T>(path:string,body:unknown,method='POST')=>api<T>(path,{method,body:JSON.stringify(body)});
let bootstrap:Promise<void>|null=null;
export function initialise(){if(!bootstrap)bootstrap=Promise.allSettled([api<typeof state.config>('/api/config').then(c=>{state.config=c;}),api<{user:User|null}>('/api/session').then(r=>{state.user=r.user;})]).then(()=>{state.ready=true;});return bootstrap;}
export async function signOut(){await send('/api/auth/logout',{});state.user=null;}
export function formatDate(value:number){return new Date(value*1000).toLocaleString();}
export function number(value:unknown){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:3}):'—';}
export function safeNext(value:unknown){return typeof value==='string'&&/^\/app(?:\/(?:notes|files|watchlist|account))?$/.test(value)?value:'/app/notes';}
