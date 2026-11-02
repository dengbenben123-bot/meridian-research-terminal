<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount,watch} from 'vue';
import {state} from '../client';
declare global{interface Window{turnstile?:{render:(container:HTMLElement,options:Record<string,unknown>)=>string;reset:(id:string)=>void;remove:(id:string)=>void}}}
const props=defineProps<{action:string}>();const emit=defineEmits<{'update:token':[token:string]}>();
const root=ref<HTMLElement>();const error=ref('');let widget:string|undefined;let stopped=false;
let scriptPromise:Promise<void>|null=null;
async function load(){
 if(window.turnstile)return;if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{const existing=document.getElementById('meridian-turnstile');if(existing){const poll=setInterval(()=>{if(window.turnstile){clearInterval(poll);clearTimeout(timeout);resolve();}},50);const timeout=setTimeout(()=>{clearInterval(poll);reject(Error('Security check could not load.'));},12000);return;}
 const script=document.createElement('script');script.id='meridian-turnstile';script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.onload=()=>resolve();script.onerror=()=>{script.remove();scriptPromise=null;reject(Error('Security check could not load. Please retry.'));};document.head.append(script);});await scriptPromise;
}
async function render(){if(!state.config.turnstileSiteKey)return;try{await load();if(stopped||!root.value||!window.turnstile)return;if(widget)window.turnstile.remove(widget);emit('update:token','');widget=window.turnstile.render(root.value,{sitekey:state.config.turnstileSiteKey,action:props.action,theme:'light',callback:(token:string)=>emit('update:token',token),'expired-callback':()=>emit('update:token',''),'error-callback':()=>{emit('update:token','');error.value='Please retry the security check.';}});}catch(e){error.value=(e as Error).message;}}
function reset(){emit('update:token','');if(widget&&window.turnstile)window.turnstile.reset(widget);}
onMounted(render);watch(()=>[props.action,state.config.turnstileSiteKey],render);onBeforeUnmount(()=>{stopped=true;if(widget&&window.turnstile)window.turnstile.remove(widget);});defineExpose({reset});
</script>
<template><div class="challenge"><div ref="root"/><p v-if="error" class="error" role="alert">{{error}} <button type="button" @click="error='';render()">Retry</button></p></div></template>
