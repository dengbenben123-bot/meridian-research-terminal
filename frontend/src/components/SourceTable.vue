<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount} from 'vue';
import {AgGridVue} from 'ag-grid-vue3';
import type {ColDef,GridApi,GridReadyEvent} from 'ag-grid-community';
import {display,csvSafe,type Row} from '../api';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-balham.css';
const props=withDefaults(defineProps<{rows:Row[];columns?:ColDef[];pinned?:boolean;loading?:boolean;securityActions?:boolean}>(),{pinned:true,loading:false,securityActions:false});
const emit=defineEmits<{open:[row:Row];watch:[row:Row]}>();
const api=ref<GridApi>();const menu=ref<{x:number;y:number;row:Row}|null>(null);const copyMessage=ref('');
const defs=computed<ColDef[]>(()=>{
 const keys=[...new Set(props.rows.slice(0,25).flatMap(Object.keys))];
 const source:ColDef[]=props.columns??keys.map(field=>({field,headerName:field,width:field.length>12?180:140}));
 return source.map((column,index)=>({...column,pinned:props.pinned&&index<2?'left':undefined,valueFormatter:column.valueFormatter??(p=>display(p.value))}));
});
function ready(event:GridReadyEvent){api.value=event.api;}
function context(mouse:MouseEvent){const element=(mouse.target as HTMLElement).closest('.ag-row');const index=element?.getAttribute('row-index');if(index==null)return;const row=api.value?.getDisplayedRowAtIndex(Number(index))?.data;if(!row)return;menu.value={x:Math.max(0,Math.min(mouse.clientX,window.innerWidth-190)),y:Math.max(0,Math.min(mouse.clientY,window.innerHeight-180)),row};}
function exportCSV(){api.value?.exportDataAsCsv({fileName:'meridian-public-data.csv',prependContent:[[{data:{value:'公开源数据；时间与单位请查看来源说明。'}}]],processCellCallback:p=>String(csvSafe(p.value))});menu.value=null;}
async function copy(){if(!menu.value)return;try{await navigator.clipboard.writeText(Object.values(menu.value.row).map(display).join('\t'));copyMessage.value='已复制当前行';}catch{copyMessage.value='浏览器未授予剪贴板权限，请使用 CSV 导出。';}menu.value=null;}
function escape(event:KeyboardEvent){if(event.key==='Escape'&&menu.value){event.preventDefault();event.stopImmediatePropagation();menu.value=null;}}
onMounted(()=>window.addEventListener('keydown',escape,true));onBeforeUnmount(()=>window.removeEventListener('keydown',escape,true));
defineExpose({exportCSV});
</script>
<template><div class="table-host" @contextmenu.capture.prevent="context">
 <AgGridVue class="ag-theme-balham source-grid" theme="legacy" :row-data="rows" :column-defs="defs" :default-col-def="{sortable:true,resizable:true,minWidth:90}" :row-height="25" :header-height="28" :animate-rows="false" :suppress-column-move-animation="true" :suppress-context-menu="true" :loading="loading" :tooltip-show-delay="300" overlay-no-rows-template="<span>没有可展示的源数据；请查看数据状态或调整筛选条件。</span>" @grid-ready="ready" @row-clicked="emit('open',$event.data)" />
 <div v-if="copyMessage" class="copy-note" role="status" @click="copyMessage=''">{{copyMessage}}</div>
 <div v-if="menu" class="menu-dismiss" @click="menu=null" @contextmenu.prevent="menu=null"></div>
 <div v-if="menu" class="context-menu" :style="{left:menu.x+'px',top:menu.y+'px'}" role="menu" @keydown.esc="menu=null">
  <button role="menuitem" @click="exportCSV">导出当前表 CSV</button><button role="menuitem" @click="copy">复制当前行</button><button v-if="securityActions" role="menuitem" @click="emit('watch',menu.row);menu=null">加入我的自选</button><button v-if="securityActions" role="menuitem" @click="emit('open',menu.row);menu=null">打开 F9 深度资料</button>
 </div>
</div></template>

