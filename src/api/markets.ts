import catalogue from './catalogue.json';
import {Problem} from './http';
const directory:Record<string,{name:string;code:string;currency:string}>=catalogue;
export function instrument(symbol:string){if(!Object.hasOwn(directory,symbol))throw new Problem(422,'Choose a configured security.');return {symbol,...directory[symbol]};}
function number(value:string){if(value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
export function parseQuotes(source:string,symbols:string[]){
 const known=new Map(symbols.map(symbol=>[instrument(symbol).code,symbol]));const rows=[];
 for(const match of source.matchAll(/v_([a-z0-9]+)="([^"\r\n]*)";/g)){
  const symbol=known.get(match[1]);if(!symbol)continue;const fields=match[2].split('~');if(fields.length<35)continue;
  const price=number(fields[3]);const date=fields[30].replace(/[/: ]/g,'');if(price===null||price<=0||!/^\d{14}$/.test(date))continue;
  const stamp=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8),+date.slice(8,10),+date.slice(10,12),+date.slice(12,14));
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,19).replace(/[-:T]/g,'')!==date)continue;
  rows.push({symbol,name:directory[symbol].name,currency:directory[symbol].currency,price,change_pct:number(fields[32]),
   source_time:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+'T'+date.slice(8,10)+':'+date.slice(10,12)+':'+date.slice(12,14)+'+08:00'});
 }
 return rows;
}
export async function quotes(symbols:string[],request:Request,ctx:ExecutionContext){
 const key=new Request(new URL('/__public-quote-cache/'+symbols.join(','),request.url));const cache=caches.default;
 const cached=await cache.match(key);if(cached){const value=await cached.json<Record<string,unknown>>();return {...value,cached:true};}
 let response:Response;
 try{response=await fetch('https://qt.gtimg.cn/q='+symbols.map(s=>instrument(s).code).join(','),{signal:AbortSignal.timeout(8000)});}catch{throw new Problem(503,'The public quote source is unavailable. Try again later.');}
 if(!response.ok)throw new Problem(503,'The public quote source is unavailable.');
 const data=await response.arrayBuffer();if(data.byteLength>250000)throw new Problem(503,'Unexpected quote source response.');
 // Numeric fields and delimiters are ASCII. Provider names are discarded;
 // Chinese names come from the bundled UTF-8 directory, avoiding a legacy codec.
 const rows=parseQuotes(new TextDecoder().decode(data),symbols);
 if(!rows.length)throw new Problem(503,'No valid quote observations were returned.');
 const value={state:rows.length===symbols.length?'ok':'partial',rows,requested:symbols.length,observed:rows.length,
  received_at:new Date().toISOString(),source:'Tencent public web quotes',poll_seconds:60,latency_verified:false,cached:false};
 ctx.waitUntil(cache.put(key,new Response(JSON.stringify(value),{headers:{'Cache-Control':'public, max-age=60','Content-Type':'application/json'}})));
 return value;
}
