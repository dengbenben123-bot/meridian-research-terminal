import {spawn} from 'node:child_process';
const names=['AUTH_SECRET','TURNSTILE_SECRET_KEY'];for(const name of names)if(!process.env[name])throw Error('Missing '+name);
if(process.env.AUTH_SECRET.trim().length<32||/^(fixture|local-development)/.test(process.env.AUTH_SECRET)||/^[123]x0+/.test(process.env.TURNSTILE_SECRET_KEY))throw Error('Production secrets are required.');
const input=JSON.stringify(Object.fromEntries(names.map(name=>[name,process.env[name]])));
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','wrangler.deploy.json'],{stdio:['pipe','inherit','inherit'],env:process.env});
child.stdin.end(input);child.on('error',()=>{console.error('Could not start secret synchronization.');process.exitCode=1;});child.on('close',code=>{process.exitCode=code||0;});
