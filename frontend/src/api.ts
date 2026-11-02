export type Row = Record<string, unknown>;
export type Envelope = {state:string;rows:Row[];message?:string;received_at?:string;age_seconds?:number|null;total?:number;meta?:{source?:string;frequency?:string;configured_expected?:number;observed?:number;cached_observed?:number};indicators?:Row[];errors?:{provider:string;code:string}[]};
export type Instrument={symbol:string;code:string;name:string;exchange:string;kind:string;industry?:string};
export async function api<T = Envelope>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(path,{...init,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Meridian-Request':'1',...init.headers}});
  const text=await response.text();let body:unknown;
  try{body=JSON.parse(text);}catch{throw new Error(`HTTP ${response.status}：服务返回了非 JSON 响应，请检查后端健康状态。`);}
  if(!response.ok){const detail=(body as {detail?:unknown}).detail;throw new Error(typeof detail==='string'?detail:`HTTP ${response.status}：请求未成功；请检查输入或登录状态。`);}
  return body as T;
}
export const post=<T=Row>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export function display(value:unknown):string{
  if(value===null||value===undefined||value==='')return '—';
  return typeof value==='object'?JSON.stringify(value):String(value);
}
export function numeric(value:unknown,digits=2):string{
  return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
}
export function csvSafe(value:unknown):string|number{
  if(typeof value==='number')return Number.isFinite(value)?value:'';
  const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
  return /^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text;
}
export function safeURL(value:unknown):string|undefined{
  if(typeof value!=='string')return;
  try{const url=new URL(value);if(['https:','http:'].includes(url.protocol))return url.href;}catch{/* source did not provide a usable link */}
}
export function queryString(values:Record<string,unknown>):string{
  const query=new URLSearchParams();for(const [key,value]of Object.entries(values))if(value!==''&&value!==null&&value!==undefined)query.set(key,String(value));return query.toString();
}
export function editable(target:EventTarget|null):boolean{return target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');}

