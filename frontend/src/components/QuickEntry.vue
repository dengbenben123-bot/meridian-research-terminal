<script setup lang="ts">
import {ref,watch,nextTick,onBeforeUnmount,computed} from 'vue';
import {api,type Instrument} from '../api';
const props=defineProps<{open:boolean;x:number;y:number}>();
const emit=defineEmits<{close:[];select:[item:Instrument]}>();
const input=ref<HTMLInputElement>();const q=ref('');const items=ref<Instrument[]>([]);const index=ref(0);const error=ref('');const pending=ref(false);
let timer:ReturnType<typeof setTimeout>|undefined;let controller:AbortController|undefined;let loadedQuery='';
const position=computed(()=>({left:Math.max(4,Math.min(props.x,window.innerWidth-290))+'px',top:Math.max(40,Math.min(props.y,window.innerHeight-350))+'px'}));
async function search(){controller?.abort();const current=new AbortController();const query=q.value;controller=current;pending.value=true;error.value='';try{const reply=await api<{items:Instrument[]}>('/api/search?q='+encodeURIComponent(query),{signal:current.signal});if(current!==controller)return;items.value=reply.items;loadedQuery=query;index.value=0;}catch(e){if((e as Error).name!=='AbortError')error.value=(e as Error).message;}finally{if(current===controller)pending.value=false;}}
watch(q,()=>{clearTimeout(timer);timer=setTimeout(search,150);});
watch(()=>props.open,async value=>{if(value){q.value='';items.value=[];await nextTick();input.value?.focus();void search();}else{clearTimeout(timer);controller?.abort();}});
function move(delta:number){if(items.value.length)index.value=(index.value+delta+items.value.length)%items.value.length;}
async function choose(){clearTimeout(timer);if(pending.value||loadedQuery!==q.value||!items.value.length)await search();if(loadedQuery!==q.value||error.value)return;const selected=items.value[index.value];if(selected){emit('select',selected);emit('close');}}
onBeforeUnmount(()=>{clearTimeout(timer);controller?.abort();});
</script>
<template><section v-if="open" class="quick-entry" :style="position" aria-label="键盘精灵" @keydown.esc.stop.prevent="emit('close')">
 <div class="quick-title">键盘精灵 <span>代码 / 中文 / 拼音首字母</span></div>
 <input ref="input" v-model="q" aria-label="证券快速查找" role="combobox" aria-controls="quick-results" aria-expanded="true" autocomplete="off" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="choose">
 <p v-if="error" class="inline-error">{{error}}</p><p v-else-if="pending">正在检索…</p>
 <ul id="quick-results" role="listbox"><li v-for="(item,n) in items" :key="item.symbol" :class="{chosen:index===n}" role="option" :aria-selected="index===n" @mousedown.prevent="emit('select',item);emit('close')"><span>{{item.code}}</span><strong>{{item.name}}</strong><small>{{item.exchange}}</small></li></ul>
 <footer>Enter → F5　↑↓ 选择　Esc 关闭</footer>
</section></template>

