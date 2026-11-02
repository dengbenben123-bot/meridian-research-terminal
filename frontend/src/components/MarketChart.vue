<script setup lang="ts">
import {computed,ref} from 'vue';
import {numeric,type Row} from '../api';
const props=defineProps<{bars?:Row[];indicators?:Row[];line?:{label:string;value:number}[];title:string}>();
const active=ref(-1);const width=1000;const top=20;const plotHeight=230;const left=65;const right=965;
const bars=computed(()=>props.bars?.slice(-120)??[]);const lines=computed(()=>props.line?.filter(x=>Number.isFinite(x.value)).slice(-120)??[]);
const numbers=computed(()=>bars.value.length?bars.value.flatMap(b=>[Number(b.low),Number(b.high)]):lines.value.map(b=>b.value));
const bounds=computed(()=>{const values=numbers.value;const min=Math.min(...values),max=Math.max(...values);const pad=(max-min||Math.abs(max)*.02||1)*.08;return {min:min-pad,max:max+pad};});
const y=(value:number)=>top+plotHeight-(value-bounds.value.min)/(bounds.value.max-bounds.value.min)*plotHeight;
const step=computed(()=>(right-left)/Math.max(1,bars.value.length||lines.value.length));const x=(i:number)=>left+(i+.5)*step.value;
const path=computed(()=>lines.value.map((point,i)=>`${i?'L':'M'}${x(i)},${y(point.value)}`).join(' '));
const maPath=computed(()=>{const values=props.indicators?.slice(-bars.value.length)??[];return values.map((row,i)=>typeof row.ma20==='number'?`${i&&typeof values[i-1]?.ma20==='number'?'L':'M'}${x(i)},${y(row.ma20)}`:'').join(' ');});
const maxVolume=computed(()=>Math.max(1,...bars.value.map(b=>Number(b.volume)||0)));
const activeBar=computed(()=>bars.value[active.value]);const activeLine=computed(()=>lines.value[active.value]);
function move(e:MouseEvent){const rect=(e.currentTarget as SVGElement).getBoundingClientRect();const px=(e.clientX-rect.left)/rect.width*width;active.value=Math.min((bars.value.length||lines.value.length)-1,Math.max(0,Math.floor((px-left)/step.value)));}
</script>
<template><section class="chart-panel"><div class="chart-caption"><strong>{{title}}</strong><span v-if="activeBar">{{activeBar.date}}　开 {{numeric(activeBar.open)}}　高 {{numeric(activeBar.high)}}　低 {{numeric(activeBar.low)}}　收 {{numeric(activeBar.close)}}　量 {{numeric(activeBar.volume,0)}}</span><span v-else-if="activeLine">{{activeLine.label}}　{{numeric(activeLine.value,4)}}</span><span v-else>{{bars.length?'空心：收涨　实心：收跌　虚线：MA20　未复权':'公开源统计值 / 原始单位'}}</span></div>
 <svg v-if="numbers.length" viewBox="0 0 1000 335" role="img" :aria-label="title" @mousemove="move" @mouseleave="active=-1">
  <g v-for="i in 5" :key="i"><line :x1="left" :x2="right" :y1="top+(i-1)*plotHeight/4" :y2="top+(i-1)*plotHeight/4" stroke="#ddd"/><text x="5" :y="top+(i-1)*plotHeight/4+4">{{numeric(bounds.max-(i-1)*(bounds.max-bounds.min)/4,2)}}</text></g>
  <path v-if="lines.length" :d="path" fill="none" stroke="#333" stroke-width="1.5"/>
  <g v-for="(bar,i) in bars" :key="String(bar.date)"><line :x1="x(i)" :x2="x(i)" :y1="y(Number(bar.high))" :y2="y(Number(bar.low))" stroke="#333"/><rect :x="x(i)-Math.max(1,step*.32)" :y="y(Math.max(Number(bar.open),Number(bar.close)))" :width="Math.max(1,step*.64)" :height="Math.max(1,Math.abs(y(Number(bar.open))-y(Number(bar.close))))" :fill="Number(bar.close)>=Number(bar.open)?'#fff':'#777'" stroke="#333"/><rect :x="x(i)-step*.32" :y="300-(Number(bar.volume)||0)/maxVolume*35" :width="Math.max(1,step*.64)" :height="(Number(bar.volume)||0)/maxVolume*35" fill="#a7a7a7"/></g>
  <path v-if="bars.length" :d="maPath" fill="none" stroke="#6c6c6c" stroke-dasharray="4 2" stroke-width="1.2"/>
  <line v-if="active>=0" :x1="x(active)" :x2="x(active)" y1="15" y2="305" stroke="#777" stroke-dasharray="2 2"/>
  <text :x="left" y="325">{{bars[0]?.date??lines[0]?.label}}</text><text :x="right" y="325" text-anchor="end">{{bars.at(-1)?.date??lines.at(-1)?.label}}</text>
 </svg><p v-else class="empty-message">没有经过校验的图表数据。</p>
</section></template>

