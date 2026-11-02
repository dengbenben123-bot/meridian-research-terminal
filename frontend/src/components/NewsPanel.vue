<script setup lang="ts">
import {computed} from 'vue';
import {display,safeURL,type Row,type Envelope} from '../api';
const props=defineProps<{data:Envelope|null;standalone?:boolean}>();
const emit=defineEmits<{select:[row:Row]}>();
const items=computed(()=>props.data?.rows??[]);
const take=(row:Row,...keys:string[])=>{for(const key of keys)if(row[key]!=null&&row[key]!=='')return display(row[key]);return '';};
</script>
<template><section class="news-panel"><div class="panel-title"><strong>资讯 / 公开电报</strong><small>{{data?.meta?.source??'尚未连接'}}　{{data?.received_at?new Date(data.received_at).toLocaleTimeString('zh-CN'):'—'}}</small></div><p v-if="data?.state==='unavailable'||data?.state==='stale'" class="inline-error">{{data.message}}</p><div class="news-list"><button v-for="(row,i) in items" :key="i" class="news-row" @click="emit('select',row)"><time>{{take(row,'发布时间','新闻时间','发布日期','时间')}}</time><span>{{take(row,'标题','新闻标题','title','报告名称')||'未提供标题'}}</span><small>{{take(row,'文章来源','来源','机构','source')}}</small></button><p v-if="!items.length" class="empty-message">暂无可用资讯；等待公开源响应。</p></div></section></template>

