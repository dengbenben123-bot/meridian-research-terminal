import type {Env,Limiter} from './types';
export class Problem extends Error {constructor(public status:number,message:string){super(message)}}
export function json(value:unknown,status=200,headers:HeadersInit={}){const h=new Headers(headers);h.set('Content-Type','application/json; charset=utf-8');h.set('Cache-Control','no-store, private');h.set('X-Content-Type-Options','nosniff');return new Response(JSON.stringify(value),{status,headers:h});}
export function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Problem(422,'Unexpected form fields.');return value as Record<string,unknown>;}
export function text(value:unknown,name:string,max:number,min=1){if(typeof value!=='string'||value.length<min||value.length>max||value.includes('\0'))throw new Problem(422,`${name} must contain ${min}–${max} characters.`);return value;}
export function visibility(value:unknown):'private'|'public'{if(value!=='private'&&value!=='public')throw new Problem(422,'Choose private or public visibility.');return value;}
export function id(value:string){if(!/^[a-f0-9-]{36}$/.test(value))throw new Problem(404,'Not found.');return value;}
export async function bytes(request:Request,max:number):Promise<Uint8Array>{
 const declared=Number(request.headers.get('Content-Length'));if(Number.isFinite(declared)&&declared>max)throw new Problem(413,'The request is too large.');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let count=0;
 while(true){const result=await reader.read();if(result.done)break;count+=result.value.length;if(count>max){await reader.cancel();throw new Problem(413,'The request is too large.');}chunks.push(result.value);}
 const all=new Uint8Array(count);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return all;
}
export async function body(request:Request){if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new Problem(415,'Send JSON form data.');const raw=await bytes(request,32768);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(raw)) as unknown;}catch{throw new Problem(400,'The request contains invalid JSON.');}}
export function origin(request:Request,env:Env){
 let expected:string;try{expected=new URL(env.PUBLIC_ORIGIN||request.url).origin;}catch{throw new Problem(503,'The application origin is not configured.');}
 if(request.headers.get('Origin')!==expected||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new Problem(403,'Use the form on this website.');
}
export async function limited(limiter:Limiter|undefined,key:string){if(!limiter)throw new Problem(503,'Request protection is not configured.');if(!(await limiter.limit({key})).success)throw new Problem(429,'Too many requests. Please wait a minute and try again.');}
export function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Problem(422,'Invalid version or count.');return value;}
export const now=()=>Math.floor(Date.now()/1000);
export function security(response:Response){const r=new Response(response.body,response);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','same-origin');r.headers.set('X-Frame-Options','DENY');r.headers.set('X-Meridian-Build','meridian-6.0.0');return r;}
