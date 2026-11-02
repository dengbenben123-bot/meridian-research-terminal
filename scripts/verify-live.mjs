const origin=process.env.PUBLIC_ORIGIN;if(!origin||new URL(origin).protocol!=='https:')throw Error('Set PUBLIC_ORIGIN to your HTTPS site.');
async function read(path){return fetch(origin+path,{redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});}
let healthy=false;for(let i=0;i<8;i++){try{const response=await read('/healthz');const data=await response.json();if(response.ok&&data.status==='ok'&&data.version==='6.0.0'){healthy=true;break;}}catch{}if(i<7)await new Promise(r=>setTimeout(r,2000));}
if(!healthy)throw Error('The expected live release was not verified. Check Cloudflare deployment logs before retrying.');
for(const path of ['/','/guide']){const response=await read(path);if(!response.ok||!(await response.text()).includes('MERIDIAN'))throw Error('Public page check failed: '+path);}
const privateResponse=await read('/api/watchlist');if(privateResponse.status!==401||!privateResponse.headers.get('Cache-Control')?.includes('no-store'))throw Error('Private route or API cache policy check failed.');
const session=await read('/api/session');if((await session.json()).user!==null||!session.headers.get('Cache-Control')?.includes('no-store'))throw Error('Anonymous session check failed.');
console.log('Verified public pages, live release 6.0.0, anonymous session and private API gate: '+origin);
console.log('A real account/Captcha interaction still requires a browser check. No test account was created in production.');
