<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';import {useRoute} from 'vue-router';import {api,formatDate,type Note} from '../client';
const route=useRoute(),note=ref<Note|null>(null),error=ref('');let controller:AbortController|undefined;
watch(()=>route.params.id,async value=>{controller?.abort();controller=new AbortController();note.value=null;error.value='';try{note.value=(await api<{post:Note}>('/api/posts/'+encodeURIComponent(String(value)),{signal:controller.signal})).post;document.title=note.value.title+' · Meridian';}catch(e){if((e as Error).name!=='AbortError')error.value=(e as Error).message;}},{immediate:true});onBeforeUnmount(()=>controller?.abort());
</script>
<template><main class="public-page article-page"><RouterLink to="/research">← Public research</RouterLink><p v-if="error" class="error" role="alert">{{error}}</p><article v-if="note"><div class="eyebrow">{{note.visibility==='public'?'PUBLIC RESEARCH':'PRIVATE NOTE'}}</div><h1>{{note.title}}</h1><p class="article-meta">{{note.author}} · Updated {{formatDate(note.updated_at)}}</p><div class="article-body">{{note.body}}</div></article></main></template>
