<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import type {ColDef} from 'ag-grid-community';
import SourceTable from './components/SourceTable.vue';
import QuickEntry from './components/QuickEntry.vue';
import MarketChart from './components/MarketChart.vue';
import NewsPanel from './components/NewsPanel.vue';
import {api,post,display,numeric,queryString,editable,safeURL,type Row,type Envelope,type Instrument} from './api';

const nav=[
 {label:'股票',icon:'股',items:[['equity','沪深京 A 股','F5'],['hk','港股行情','HK']]},
 {label:'债券',icon:'债',items:[['bonds','中国债券收益率','BD']]},
 {label:'基金',icon:'基',items:[['fund','ETF 行情与净值','FD']]},
 {label:'商品',icon:'商',items:[['futures','国内期货','FU'],['options','期权合约链','OP']]},
 {label:'外汇',icon:'汇',items:[['forex','外汇报价','FX']]},
 {label:'宏观',icon:'宏',items:[['macro','经济数据库','EDB']]},
 {label:'指数',icon:'指',items:[['index','市场指数','IX']]},
 {label:'新闻',icon:'闻',items:[['news','公开资讯 / 电报','N']]},
 {label:'研究报告',icon:'研',items:[['research','个股研报目录','R']]},
 {label:'我的自选',icon:'选',items:[['watchlist','自选证券','自选'],['paper','模拟账户 / 委托','P']]}
];
const view=ref('equity');const history:string[]=[];const openGroups=ref(new Set(nav.map(n=>n.label)));const sidebarCollapsed=ref(false);
const selected=ref<Instrument>({symbol:'600519.SH',code:'600519',name:'贵州茅台',exchange:'SH',kind:'equity'});
const wizard=ref(false);const anchor=ref({x:260,y:55});let pointer={x:260,y:55};
const globalQuery=ref('');const notice=ref('');const account=ref('');const status=ref<Row>({});
const loading=ref(false);const failure=ref('');const data=ref<Envelope>({state:'not_checked',rows:[]});
const bars=ref<Envelope>({state:'not_checked',rows:[]});const detailTab=ref('overview');const period=ref('daily');
const reportDate=ref(previousQuarter());const publicationDate=ref(chinaDate());const holdingsYear=ref(new Date().getFullYear());
const filters=ref<Record<string,string|number|null>>({q:'',industry:'',pe_min:'',pe_max:'',cap_min:'',cap_max:'',change_min:'',change_max:''});
const industries=ref<string[]>([]);const futureSymbols=ref('RB0,AU0,CU0,IF0');const optionQuery=ref('');const optionOffset=ref(0);
const macroIndicator=ref('gdp');const macroField=ref('');const macroItems=[['gdp','国内生产总值 GDP'],['cpi','居民消费价格 CPI'],['pmi','采购经理指数 PMI'],['money','货币供应量 M0/M1/M2'],['rates','贷款市场报价利率 LPR'],['imports','进口同比'],['exports','出口同比']];
const newsData=ref<Envelope|null>(null);const newsDock=ref<'bottom'|'right'|'hidden'>('bottom');const article=ref<Row|null>(null);
const table=ref<InstanceType<typeof SourceTable>>();const pinned=ref(true);const selectedWorkspace=ref('');const workspaceName=ref('研究工作区');const workspaces=ref<{name:string;content:Row}[]>([]);
const selectedPreset=ref('');const presetName=ref('自定义筛选');const presets=ref<{name:string;content:Row}[]>([]);
const watchlist=ref<{symbol:string;group:string;instrument:Instrument|null}[]>([]);const watchGroup=ref('我的自选');const watchSymbol=ref('');
const positions=ref<Row>({positions:[],orders:[]});const orderSide=ref('buy');const quantity=ref(100);const orderType=ref('market');const limitPrice=ref<number|null>(null);const preview=ref<Row|null>(null);const orderBusy=ref(false);
let controller:AbortController|undefined;let poll:ReturnType<typeof setInterval>|undefined;let newsPoll:ReturnType<typeof setInterval>|undefined;let debounce:ReturnType<typeof setTimeout>|undefined;
const names:Record<string,string>={equity:'沪深京 A 股 · F5 证券浏览器',hk:'港股行情',fund:'ETF 行情',index:'市场指数',bonds:'中国债券收益率',futures:'国内期货快照',options:'期权合约链',forex:'外汇市场',macro:'EDB 经济数据库',news:'公开资讯 / 财联社电报',research:'个股研究报告目录',watchlist:'我的自选证券',detail:'F9 证券深度资料',paper:'模拟账户 / 委托',help:'连接、设置与操作说明'};
const quoteView=computed(()=>['equity','hk','fund','index','watchlist'].includes(view.value));
const isAEquity=computed(()=>selected.value.kind==='equity'&&['SH','SZ','BJ'].includes(selected.value.exchange));
const title=computed(()=>names[view.value]??view.value);
const quoteColumns=computed<ColDef[]>(()=>[
 {field:'code',headerName:'证券代码',width:100},{field:'name',headerName:'证券简称',width:130},
 {field:'price',headerName:'最新价',width:110,valueFormatter:p=>numeric(p.value)},
 {field:'change_pct',headerName:'涨跌幅 %',width:110,valueFormatter:p=>numeric(p.value),cellClass:p=>typeof p.value==='number'?p.value>0?'gain':p.value<0?'loss':'':''},
 {field:'volume',headerName:'成交量(源单位)',width:135,valueFormatter:p=>numeric(p.value,0)},
 {field:'turnover',headerName:'换手率 %',width:110,valueFormatter:p=>numeric(p.value)},
 {field:'pe',headerName:'市盈率(源口径)',width:130,valueFormatter:p=>numeric(p.value)},
 {field:'market_cap',headerName:'总市值(亿本币)',width:140,valueFormatter:p=>typeof p.value==='number'?numeric(p.value/1e8):'—'},
 {field:'industry',headerName:'行业(已补全)',width:140},{field:'source_time',headerName:'源时间',width:180},
 {field:'age_seconds',headerName:'获取距今(秒)',width:120,valueFormatter:p=>numeric(p.value,0)},
 {field:'is_stale',headerName:'行数据状态',width:110,valueFormatter:p=>p.value?'过期观测':'最近获取'},
 {field:'currency',headerName:'币种',width:85}
]);
const macroFields=computed(()=>[...new Set(data.value.rows.slice(0,20).flatMap(Object.keys))].filter(key=>!['序号'].includes(key)&&data.value.rows.some(row=>typeof row[key]==='number')));
const macroLine=computed(()=>{
 const key=macroField.value||macroFields.value[0];if(!key)return [];
 return data.value.rows.filter(row=>typeof row[key]==='number'&&Number.isFinite(row[key])).map((row,i)=>({label:display(row['季度']??row['月份']??row['日期']??row['时间']??row['报告期']??i),value:row[key] as number})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
});
const lastIndicator=computed(()=>bars.value.indicators?.at(-1));
const navLine=computed(()=>data.value.rows.filter(row=>typeof row['单位净值']==='number').map(row=>({label:display(row['净值日期']),value:row['单位净值'] as number})).sort((a,b)=>a.label.localeCompare(b.label)));
const sourceInfo=computed(()=>data.value.meta?.source??(data.value.state==='not_checked'?'尚未连接':'来源尚未返回'));
const sourceTime=computed(()=>data.value.received_at?new Date(data.value.received_at).toLocaleString('zh-CN',{hour12:false}):'未成功获取');
const dataWarning=computed(()=>['stale','unavailable','unsupported'].includes(data.value.state));
function chinaDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function previousQuarter(){const now=new Date();const end=new Date(Date.UTC(now.getFullYear(),Math.floor(now.getMonth()/3)*3,0));return end.toISOString().slice(0,10);}
function navigate(next:string){if(view.value!==next){history.push(view.value);view.value=next;}article.value=null;}
function toggleGroup(label:string){const set=new Set(openGroups.value);set.has(label)?set.delete(label):set.add(label);openGroups.value=set;}
function quick(){anchor.value={...pointer};wizard.value=true;}
function choose(item:Instrument){selected.value=item;filters.value.q=item.code;period.value='daily';navigate(item.kind==='fund'?'fund':item.kind==='index'?'index':item.exchange==='HK'?'hk':'equity');notice.value=`已定位 ${item.symbol} ${item.name}；单击行情行或按 F9 查看资料。`;}
async function command(){if(!globalQuery.value.trim()){quick();return;}try{const result=await api<{items:Instrument[]}>('/api/search?q='+encodeURIComponent(globalQuery.value));if(result.items.length)choose(result.items[0]);else notice.value='目录中没有匹配项。';}catch(e){notice.value=(e as Error).message;}}
function keydown(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();if(wizard.value){wizard.value=false;return;}if(article.value){article.value=null;return;}view.value=history.pop()??'equity';return;}if(event.key==='.'&&!editable(event.target)){event.preventDefault();quick();}if(event.key==='F5'){event.preventDefault();navigate('equity');}if(event.key==='F9'){event.preventDefault();navigate('detail');}}
function move(event:PointerEvent){pointer={x:event.clientX,y:event.clientY};}
function rowInstrument(row:Row):Instrument|null{
 const raw=row.symbol??row['代码'];if(raw===undefined)return null;let symbol=String(raw);let kind=selected.value.kind;
 if(quoteView.value||view.value==='detail'){kind=typeof row.kind==='string'?row.kind:view.value==='fund'?'fund':view.value==='index'?'index':selected.value.kind;}
 else if(view.value==='futures')kind='future';else if(view.value==='options')kind='option';else if(view.value==='forex')kind='forex';else return null;
 const exchange=String(row.exchange??(symbol.includes('.')?symbol.split('.').at(-1):''));
 return {symbol,code:symbol.split('.')[0],name:display(row.name??row['名称']??symbol),kind,exchange};
}
function openRow(row:Row){if(['news','research'].includes(view.value)){article.value=row;return;}const item=rowInstrument(row);if(item){selected.value=item;detailTab.value='overview';period.value='daily';navigate('detail');}}
async function addWatch(row:Row){const item=rowInstrument(row);if(!item){notice.value='请在证券目录行情中选择需要添加的证券。';return;}try{await post('/api/watchlists',{symbol:item.symbol,group:watchGroup.value});await loadWatchlist();notice.value=`已加入 ${watchGroup.value}：${item.symbol}`;}catch(e){notice.value=(e as Error).message;}}
async function addWatchCode(){try{const reply=await api<{items:Instrument[]}>('/api/search?q='+encodeURIComponent(watchSymbol.value));const match=reply.items.find(i=>i.symbol===watchSymbol.value.toUpperCase()||i.code===watchSymbol.value);if(!match){notice.value='请输入目录中完整证券代码。';return;}await post('/api/watchlists',{symbol:match.symbol,group:watchGroup.value});await loadWatchlist();await loadView();watchSymbol.value='';}catch(e){notice.value=(e as Error).message;}}
async function removeWatch(symbol:string){try{await api('/api/watchlists',{method:'DELETE',body:JSON.stringify({symbol,group:watchGroup.value})});await loadWatchlist();await loadView();}catch(e){notice.value=(e as Error).message;}}
async function loadWatchlist(){watchlist.value=(await api<{items:typeof watchlist.value}>('/api/watchlists')).items;}
async function loadNews(){try{newsData.value=await api('/api/cn/news');}catch(e){newsData.value={state:'unavailable',rows:[],message:(e as Error).message};}}
async function preferences(){const [w,p]=await Promise.all([api<{items:typeof workspaces.value}>('/api/preferences?category=workspace'),api<{items:typeof presets.value}>('/api/preferences?category=screen')]);workspaces.value=w.items;presets.value=p.items;}
async function saveWorkspace(){try{await post('/api/preferences',{category:'workspace',name:workspaceName.value,content:{view:view.value,selected_symbol:selected.value.symbol,selected_kind:selected.value.kind,sidebar_collapsed:sidebarCollapsed.value,news_dock:newsDock.value,pinned:pinned.value}});await preferences();selectedWorkspace.value=workspaceName.value;notice.value='工作区已保存到 PostgreSQL。';}catch(e){notice.value=(e as Error).message;}}
function applyWorkspace(){const saved=workspaces.value.find(w=>w.name===selectedWorkspace.value)?.content;if(!saved)return;workspaceName.value=selectedWorkspace.value;sidebarCollapsed.value=Boolean(saved.sidebar_collapsed);newsDock.value=saved.news_dock as typeof newsDock.value;pinned.value=Boolean(saved.pinned);selected.value={...selected.value,symbol:String(saved.selected_symbol),code:String(saved.selected_symbol).split('.')[0],name:String(saved.selected_symbol),kind:String(saved.selected_kind??'equity'),exchange:String(saved.selected_symbol).split('.').at(-1)??''};navigate(String(saved.view));}
async function savePreset(){try{await post('/api/preferences',{category:'screen',name:presetName.value,content:screenParams()});await preferences();selectedPreset.value=presetName.value;notice.value='筛选条件已保存。';}catch(e){notice.value=(e as Error).message;}}
function applyPreset(){const preset=presets.value.find(p=>p.name===selectedPreset.value);if(preset){filters.value={...filters.value,...preset.content} as typeof filters.value;presetName.value=preset.name;}}
function screenParams(){const result:Record<string,unknown>={};for(const [key,value]of Object.entries(filters.value)){result[key]=value===''?null:!['q','industry'].includes(key)?Number(value):value;}result.q=filters.value.q||'';result.industry=filters.value.industry||'';return result;}
function resetFilters(){for(const key of Object.keys(filters.value))filters.value[key]='';}
async function loadView(){
 controller?.abort();const current=new AbortController();controller=current;loading.value=true;failure.value='';
 const get=(url:string)=>api<Envelope>(url,{signal:current.signal});
 try{
  let result:Envelope;
  if(view.value==='watchlist'){
   const wanted=watchlist.value.filter(w=>w.group===watchGroup.value);const groups:Record<string,string[]>={};
   for(const item of wanted){if(!item.instrument)continue;const market=item.instrument.exchange==='HK'?'hk':item.instrument.kind==='fund'?'fund':item.instrument.kind==='index'?'index':'cn';(groups[market]??=[]).push(item.symbol);}
   const requests:Promise<Envelope>[]=[];for(const [market,symbols]of Object.entries(groups))for(let i=0;i<symbols.length;i+=200)requests.push(get('/api/cn/equity/snapshot?'+queryString({market,symbols:symbols.slice(i,i+200).join(',')})));
   const snapshots=await Promise.all(requests);const rows=snapshots.flatMap(s=>s.rows);
   result={...(snapshots[0]??{state:'empty',rows:[],meta:{source:'自选分组尚无证券'}}),rows,total:wanted.length,
    state:!wanted.length?'empty':snapshots.every(s=>s.state==='ok')?'ok':rows.length?'partial':'unavailable'};
  }
  else if(quoteView.value){const market=view.value==='hk'?'hk':view.value==='fund'?'fund':view.value==='index'?'index':'cn';result=await get('/api/cn/equity/snapshot?'+queryString({market,...screenParams()}));}
  else if(view.value==='detail'){
   const common=queryString({symbol:selected.value.symbol,kind:selected.value.kind,period:period.value});
   const historyPromise=get('/api/cn/equity/bars?'+common);
   let section=detailTab.value;
   if(!isAEquity.value&&selected.value.kind==='fund'){section=detailTab.value==='financials'?'nav':detailTab.value==='shareholders'?'fund_holdings':'';}
   else if(!isAEquity.value)section='';
   const detailPromise=section?get('/api/cn/equity/detail/'+section+'?'+queryString({symbol:selected.value.symbol,report_date:reportDate.value,publication_date:publicationDate.value,year:holdingsYear.value})):Promise.resolve<Envelope>({state:'unsupported',rows:[],message:'该资产的公司财务、股东或公告资料未由此接口提供；下方保留实际可用行情图表。'});
   const [historyResult,detailResult]=await Promise.all([historyPromise,detailPromise]);if(current!==controller)return;bars.value=historyResult;result=detailResult;
   if(isAEquity.value&&section==='overview')void api<{items:string[]}>('/api/cn/equity/industries').then(r=>{industries.value=r.items;}).catch(()=>{});
  }
  else if(view.value==='macro'){result=await get('/api/cn/macro/'+macroIndicator.value);if(!result.rows.some(row=>typeof row[macroField.value]==='number'))macroField.value='';}
  else if(view.value==='futures')result=await get('/api/cn/futures/quotes?'+queryString({symbol:futureSymbols.value}));
  else if(view.value==='options')result=await get('/api/cn/options/chain?'+queryString({q:optionQuery.value,offset:optionOffset.value,limit:1000}));
  else if(view.value==='bonds')result=await get('/api/cn/bonds/yield');
  else if(view.value==='forex')result=await get('/api/cn/forex');
  else if(view.value==='news')result=await get('/api/cn/news');
  else if(view.value==='research')result=await get('/api/cn/equity/detail/research?'+queryString({symbol:selected.value.symbol}));
  else if(view.value==='paper'){positions.value=await api<Row>('/api/broker/positions',{signal:current.signal});result={state:'ok',rows:[],meta:{source:'内存模拟账户 · 非实盘'}};}
  else result={state:'ok',rows:[],meta:{source:'系统连接信息'}};
  if(current===controller)data.value=result;
 }catch(e){if((e as Error).name!=='AbortError'&&current===controller){failure.value=(e as Error).message;data.value={state:'unavailable',rows:[],message:failure.value};}}
 finally{if(current===controller)loading.value=false;}
}
watch(()=>[view.value,selected.value.symbol,detailTab.value,period.value,reportDate.value,publicationDate.value,holdingsYear.value,macroIndicator.value,watchGroup.value,optionOffset.value],()=>{preview.value=null;void loadView();});
watch(()=>JSON.stringify(filters.value),()=>{clearTimeout(debounce);debounce=setTimeout(loadView,300);});
watch([orderSide,quantity,orderType,limitPrice],()=>{preview.value=null;});
async function previewOrder(){orderBusy.value=true;preview.value=null;try{preview.value=await post('/api/broker/preview',{symbol:selected.value.symbol,side:orderSide.value,quantity:quantity.value,order_type:orderType.value,limit_price:orderType.value==='limit'?limitPrice.value:null});}catch(e){notice.value=(e as Error).message;}finally{orderBusy.value=false;}}
async function submitOrder(){if(!preview.value)return;orderBusy.value=true;try{const result=await post('/api/broker/submit',{preview_id:preview.value.preview_id});notice.value=`模拟委托 ${result.order_id}：${result.state}`;preview.value=null;await loadView();}catch(e){notice.value=(e as Error).message;}finally{orderBusy.value=false;}}
async function cancelOrder(id:unknown){try{await post('/api/broker/cancel/'+encodeURIComponent(String(id)),{});notice.value='模拟限价单已撤销。';await loadView();}catch(e){notice.value=(e as Error).message;}}
function articleTitle(row:Row){return display(row['标题']??row['新闻标题']??row['报告名称']??'公开资料');}
onMounted(async()=>{
 window.addEventListener('keydown',keydown);window.addEventListener('pointermove',move,{passive:true});
 const jobs=[api<Row>('/api/status').then(s=>{status.value=s;}),api<{owner:string}>('/api/auth/check').then(r=>{account.value=r.owner;}),loadWatchlist(),preferences(),api<{items:string[]}>('/api/cn/equity/industries').then(r=>{industries.value=r.items;})];
 const results=await Promise.allSettled(jobs);const rejected=results.find(r=>r.status==='rejected');if(rejected?.status==='rejected')notice.value=String(rejected.reason);
 await loadView();void loadNews();poll=setInterval(()=>{if(!document.hidden&&!loading.value)void loadView();},Math.max(5,Number(status.value.snapshot_interval_seconds)||10)*1000);newsPoll=setInterval(()=>{if(!document.hidden&&newsDock.value!=='hidden')void loadNews();},60000);
});
onBeforeUnmount(()=>{controller?.abort();clearInterval(poll);clearInterval(newsPoll);clearTimeout(debounce);window.removeEventListener('keydown',keydown);window.removeEventListener('pointermove',move);});
</script>

<template><div class="terminal">
 <header class="toolbar"><div class="brand"><b>M</b><span>MERIDIAN <small>研究终端</small></span></div><form class="global-command" @submit.prevent="command"><input v-model="globalQuery" placeholder="输入代码、中文名称或拼音首字母　· 键盘精灵" aria-label="全局证券搜索"><button type="submit" class="action-blue">查询</button></form><div class="toolbar-actions"><button title="资讯通知" aria-label="资讯通知" @click="navigate('news')">▤</button><button title="连接与设置" aria-label="连接与设置" @click="navigate('help')">⚙</button><button title="账户信息" @click="navigate('help')">用户 {{account||'—'}}</button></div></header>
 <div class="command-row"><button class="action-blue" @click="navigate('equity')">F5 证券浏览</button><button class="action-green" @click="navigate('detail')">F9 深度资料</button><button class="action-orange" @click="navigate('macro')">EDB 经济数据库</button><button @click="quick">键盘精灵 .</button><span class="separator"></span><label>工作区 <select v-model="selectedWorkspace" @change="applyWorkspace"><option value="">选择已保存工作区</option><option v-for="w in workspaces" :key="w.name">{{w.name}}</option></select></label><input v-model="workspaceName" class="short-input" aria-label="工作区名称"><button @click="saveWorkspace">保存工作区</button><label class="dock-select">资讯停靠 <select v-model="newsDock"><option value="bottom">底部</option><option value="right">右侧</option><option value="hidden">隐藏</option></select></label></div>
 <div v-if="notice" class="notice" role="status"><span>{{notice}}</span><button aria-label="关闭提示" @click="notice=''">×</button></div>
 <div class="workspace" :class="{'nav-collapsed':sidebarCollapsed}"><aside class="navigation"><div class="nav-title"><strong v-if="!sidebarCollapsed">功能导航</strong><button :aria-label="sidebarCollapsed?'展开导航':'收起导航'" @click="sidebarCollapsed=!sidebarCollapsed">{{sidebarCollapsed?'»':'«'}}</button></div><nav v-if="!sidebarCollapsed"><section v-for="group in nav" :key="group.label" class="tree-group"><button class="tree-heading" :aria-expanded="openGroups.has(group.label)" @click="toggleGroup(group.label)"><span>{{openGroups.has(group.label)?'▾':'▸'}}</span><i>{{group.icon}}</i>{{group.label}}</button><div v-if="openGroups.has(group.label)"><button v-for="item in group.items" :key="item[0]" class="tree-leaf" :class="{selected:view===item[0]}" @click="navigate(item[0])"><span>{{item[1]}}</span><kbd>{{item[2]}}</kbd></button></div></section></nav><button v-if="sidebarCollapsed" class="vertical-command" @click="quick">证券查找</button><footer v-if="!sidebarCollapsed">5000 配置证券 · 公开数据<br>AkShare / 可选 Tushare<br>模拟交易 · 实盘接口未实现</footer></aside>
 <div class="content-layout" :class="{'dock-right':newsDock==='right','dock-bottom':newsDock==='bottom','dock-hidden':newsDock==='hidden'}"><main class="main-panel">
  <div class="view-title"><strong>{{title}}</strong><span>{{selected.symbol}} {{selected.name}}</span><button @click="loadView">{{loading?'获取中…':'刷新'}}</button><button :disabled="!table" @click="pinned=!pinned">{{pinned?'取消固定前两列':'固定前两列'}}</button><button :disabled="!table" @click="table?.exportCSV()">导出 CSV</button></div>
  <form v-if="quoteView" class="filter-row" @submit.prevent="loadView"><label>代码/名称 <input v-model="filters.q" placeholder="600519 / 贵州茅台"></label><label>行业 <select v-model="filters.industry"><option value="">全部 / 未补全</option><option v-for="industry in industries" :key="industry">{{industry}}</option></select></label><label>市盈率 <input v-model="filters.pe_min" type="number" step="any" placeholder="下限" class="range-input">—<input v-model="filters.pe_max" type="number" step="any" placeholder="上限" class="range-input"></label><label>总市值(本币元) <input v-model="filters.cap_min" type="number" min="0" placeholder="下限" class="cap-input">—<input v-model="filters.cap_max" type="number" min="0" placeholder="上限" class="cap-input"></label><label>涨跌幅 % <input v-model="filters.change_min" type="number" step="any" placeholder="下限" class="range-input">—<input v-model="filters.change_max" type="number" step="any" placeholder="上限" class="range-input"></label><button type="submit">筛选</button><button type="button" @click="resetFilters">清空</button></form>
  <div v-if="quoteView&&view!=='watchlist'" class="preset-row"><label>筛选方案 <select v-model="selectedPreset" @change="applyPreset"><option value="">选择已保存方案</option><option v-for="preset in presets" :key="preset.name">{{preset.name}}</option></select></label><input v-model="presetName" class="short-input" aria-label="筛选方案名称"><button @click="savePreset">保存条件</button><span>行业仅使用已补全的源资料；F9 公司概况获取成功后补全，不推测。</span></div>
  <div v-if="view==='watchlist'" class="filter-row"><label>分组 <input v-model="watchGroup" class="short-input"></label><input v-model="watchSymbol" placeholder="输入完整证券代码" aria-label="添加自选代码"><button @click="addWatchCode">添加证券</button><span v-for="item in watchlist.filter(w=>w.group===watchGroup)" :key="item.symbol" class="watch-chip">{{item.symbol}}<button :aria-label="'移除 '+item.symbol" @click="removeWatch(item.symbol)">×</button></span></div>
  <form v-if="view==='futures'" class="filter-row" @submit.prevent="loadView"><label>合约代码 <input v-model="futureSymbols" class="wide-input" placeholder="RB0,AU0,CU0,IF0"></label><button type="submit">读取合约</button><span>0 结尾为连续合约；不作为可执行合约。原始字段/单位由数据源提供。</span></form>
  <form v-if="view==='options'" class="filter-row" @submit.prevent="optionOffset=0;loadView()"><label>合约/标的名称 <input v-model="optionQuery" placeholder="50ETF / 沪深300 / cu"></label><button type="submit">查询合约链</button><button type="button" :disabled="optionOffset===0" @click="optionOffset=Math.max(0,optionOffset-1000)">上一页</button><button type="button" :disabled="optionOffset+1000>=(data.total??0)" @click="optionOffset+=1000">下一页</button><span>第 {{optionOffset+1}}—{{optionOffset+data.rows.length}} 条 / {{data.total??0}}</span></form>
  <div v-if="view==='research'" class="filter-row"><span>当前证券 {{selected.symbol}}。通过顶部搜索选择 A 股后读取公开研报目录；正文与 PDF 以来源权限为准。</span><button @click="quick">更换证券</button></div>
  <div v-if="view==='detail'" class="detail-toolbar"><strong>{{selected.symbol}}　{{selected.name}}</strong><label>K 线周期 <select v-model="period"><option value="daily">日线 / 未复权</option><option v-if="isAEquity" value="5">5 分钟 / 未复权</option></select></label><button @click="addWatch({...selected})">加入自选</button><button :disabled="!isAEquity" @click="navigate('paper')">模拟委托</button></div>
  <div v-if="view==='detail'" class="rect-tabs"><button v-for="tab in [['overview','公司概况 / 行情'],['financials',selected.kind==='fund'?'基金净值':'财务数据'],['announcements','公告'],['shareholders',selected.kind==='fund'?'披露持仓':'股东结构'],['news','新闻']]" :key="tab[0]" :class="{active:detailTab===tab[0]}" @click="detailTab=tab[0]">{{tab[1]}}</button></div>
  <div v-if="view==='detail'&&detailTab==='shareholders'" class="filter-row"><label v-if="selected.kind==='fund'">披露年份 <input v-model.number="holdingsYear" type="number" min="2000" max="2100"></label><label v-else>报告期 <input v-model="reportDate" type="date"></label><span>请按已披露日期查询；季度结束不代表数据已披露。</span></div>
  <div v-if="view==='detail'&&detailTab==='announcements'" class="filter-row"><label>公告发布日期 <input v-model="publicationDate" type="date"></label><span>仅显示所选日期对应证券的公开公告。</span></div>
  <div v-if="view==='macro'" class="filter-row"><span>公布频率为月/季等；获取时间不是指标发布时间。原始单位保留在列名与来源中。</span><label>绘图指标 <select v-model="macroField"><option value="">自动选择数值列</option><option v-for="key in macroFields" :key="key">{{key}}</option></select></label></div>
  <div v-if="view!=='paper'&&view!=='help'" class="source-line" :class="{'source-error':dataWarning}"><strong>{{data.state==='stale'?'过期缓存':data.state==='partial'?'部分行情 / 滚动更新':data.state==='ok'?'数据已获取':data.state==='empty'?'源返回空结果':data.state==='unsupported'?'能力未覆盖':'等待 / 不可用'}}</strong><span>{{sourceInfo}}</span><span>获取 {{sourceTime}}</span><span v-if="data.meta?.frequency">{{data.meta.frequency}}</span><span>{{data.rows.length}} 条已返回 / {{data.meta?.configured_expected??data.total??data.rows.length}} 条范围</span></div>
  <p v-if="failure||dataWarning" class="inline-error">{{failure||data.message}} <span v-for="(error,i) in data.errors" :key="i">{{error.provider}}: {{error.code}}　</span></p>
  <section v-if="view==='help'" class="help-content"><h2>Meridian 中国市场研究终端 · {{status.version}}</h2><p>独立的公开数据研究软件。采用桌面式操作结构；未使用 Wind 的专有代码、商标或授权数据。</p><dl><dt>终端账户</dt><dd>{{account}}</dd><dt>已配置目录</dt><dd>{{status.configured_instruments}} 只证券</dd><dt>主数据源</dt><dd>{{status.primary}}</dd><dt>回退链</dt><dd>{{status.fallback}}（Tushare {{status.tushare_configured?'已配置，权限依账户':'未配置'}}）</dd><dt>前台轮询</dt><dd>{{status.snapshot_interval_seconds}} 秒；上游时效不保证，后台刷新完成后再等待间隔。</dd><dt>实盘交易</dt><dd>未实现。QMT / PTrade 仅为显式抛出未实现错误的扩展接口。</dd><dt>REALTIME_PROVIDER</dt><dd>{{status.realtime_provider_configured?'有配置，适配器未实现，未激活':'未配置 / 未激活'}}</dd></dl><p><kbd>.</kbd> 证券快速搜索　<kbd>F5</kbd> 证券浏览　<kbd>F9</kbd> 当前证券资料　<kbd>Esc</kbd> 关闭精灵/正文或返回上一视图。</p><p>单击行情行打开资料；右击表格可复制、导出及加入自选。列头支持排序及拖动宽度；固定前两列按钮控制冻结。</p><p>工作区、筛选方案和自选保存在 PostgreSQL。模拟账户保存在后端内存，重启后清空，不模拟涨跌停、T+1、盘口深度与真实成交保证。</p><p>前两列冻结、资讯停靠、导航折叠可作为工作区保存。行业字段需先从 F9 真实公司资料补全。日收盘回退数据会明确标识，不能用于模拟实时撮合。</p><a href="/api/docs" target="_blank" rel="noopener">查看 REST API 文档</a></section>
  <section v-else-if="view==='paper'" class="paper-content"><div class="paper-banner">Paper Trading — No real orders will be placed. 模拟交易，不会发送真实订单。</div><p>仅支持目录中 A 股、100 股整数手。使用成功获取的最新快照模拟撮合；非真实订单簿，未模拟 T+1 和价格限制。账户重启清空。</p><div class="account-strip">初始资金 ¥1,000,000　现金 {{numeric(positions.cash)}}　可用 {{numeric(positions.available_cash)}}　费用：模拟成交额的 0.03%</div><form class="filter-row" @submit.prevent="previewOrder"><strong>{{selected.symbol}} {{selected.name}}</strong><button type="button" @click="quick">更换证券</button><label>方向 <select v-model="orderSide"><option value="buy">买入</option><option value="sell">卖出</option></select></label><label>数量 <input v-model.number="quantity" type="number" min="100" step="100" max="1000000" class="short-input"></label><label>类型 <select v-model="orderType"><option value="market">市价模拟</option><option value="limit">限价模拟</option></select></label><label v-if="orderType==='limit'">限价 <input v-model.number="limitPrice" type="number" min="0.01" step="0.01" class="short-input"></label><button class="action-blue" type="submit" :disabled="orderBusy||status.broker_mode!=='paper'">预览模拟委托</button></form><div v-if="preview" class="preview-order"><p>{{preview.symbol}}　{{preview.side}}　{{preview.quantity}} 股　观察价 {{numeric(preview.last_price)}}　预估金额 {{numeric(preview.estimated_gross)}}　模拟费用 {{numeric(preview.estimated_fee)}}（预览30秒内有效）</p><button class="action-orange" :disabled="orderBusy" @click="submitOrder">确认提交模拟委托</button></div><h3>模拟持仓</h3><table class="plain-table"><thead><tr><th>证券</th><th>股数</th><th>累计成本(元)</th></tr></thead><tbody><tr v-for="(row,i) in (positions.positions as Row[]??[])" :key="i"><td>{{row.symbol}}</td><td>{{row.quantity}}</td><td>{{numeric(row.cost)}}</td></tr></tbody></table><h3>模拟委托</h3><table class="plain-table"><thead><tr><th>证券 / 方向</th><th>数量</th><th>类型 / 限价</th><th>状态</th><th>成交价 / 费用</th><th>操作</th></tr></thead><tbody><tr v-for="(row,i) in (positions.orders as Row[]??[])" :key="i"><td>{{row.symbol}} / {{row.side}}</td><td>{{row.quantity}}</td><td>{{row.order_type}} / {{numeric(row.limit_price)}}</td><td>{{row.state}}</td><td>{{numeric(row.fill_price)}} / {{numeric(row.fee)}}</td><td><button v-if="row.state==='pending'" @click="cancelOrder(row.order_id)">撤销模拟单</button></td></tr></tbody></table></section>
  <section v-else-if="article" class="article-content"><button @click="article=null">关闭正文 Esc</button><h2>{{articleTitle(article)}}</h2><dl><template v-for="(value,key) in article" :key="key"><dt>{{key}}</dt><dd><a v-if="safeURL(value)" :href="safeURL(value)" target="_blank" rel="noopener noreferrer">打开来源原文</a><span v-else>{{display(value)}}</span></dd></template></dl></section>
  <div v-else-if="view==='macro'" class="macro-workspace"><aside class="indicator-tree"><strong>中国宏观数据库</strong><button v-for="indicator in macroItems" :key="indicator[0]" :class="{selected:macroIndicator===indicator[0]}" @click="macroIndicator=indicator[0]">{{indicator[1]}}</button></aside><div class="macro-data"><SourceTable ref="table" :rows="data.rows" :pinned="pinned" :loading="loading"/><MarketChart :line="macroLine" :title="(macroItems.find(i=>i[0]===macroIndicator)?.[1]??'EDB')+' · '+(macroField||macroFields[0]||'')"/></div></div>
  <div v-else-if="view==='detail'" class="detail-content"><p v-if="bars.state==='stale'||bars.state==='unavailable'" class="inline-error">K线：{{bars.message}}</p><MarketChart v-if="detailTab==='overview'" :bars="bars.rows" :indicators="bars.indicators" :title="selected.symbol+'　'+(period==='daily'?'日K线 / 未复权':'5分钟K线 / 末根可能未完成')"/><MarketChart v-if="selected.kind==='fund'&&detailTab==='financials'" :line="navLine" :title="selected.symbol+' 单位净值 / 非交易价格'"/><div v-if="lastIndicator" class="indicator-strip"><span v-for="key in ['ma5','ma20','ma60','rsi14','atr14','macd','signal','histogram','boll_upper','boll_lower']" :key="key">{{key.toUpperCase()}} {{numeric(lastIndicator[key],3)}}</span></div><SourceTable ref="table" :rows="data.rows" :pinned="pinned" :loading="loading" @open="article=$event"/><p class="footnote">技术指标基于公开历史价格，不含分红、不代表未来收益。财报为最新可得版本，不构成历史时点数据库。</p></div>
  <NewsPanel v-else-if="view==='news'" :data="data" standalone @select="article=$event"/>
  <SourceTable v-else ref="table" :rows="data.rows" :columns="quoteView?quoteColumns:undefined" :pinned="pinned" :loading="loading" :security-actions="quoteView||['futures','options','forex'].includes(view)" @open="openRow" @watch="addWatch"/>
 </main><NewsPanel v-if="newsDock!=='hidden'" class="docked-news" :data="newsData" @select="article=$event;navigate('news');article=$event"/></div></div>
 <footer class="status-bar"><span class="connection-dot" :class="{connected:data.state==='ok'}"></span><strong>{{loading?'连接 / 获取中':data.state==='partial'?'部分行情已获取':data.state==='ok'?'快照已连接':data.state==='stale'?'数据过期':'等待 / 不可用'}}</strong><span>SNAPSHOT @ {{data.received_at?new Date(data.received_at).toLocaleTimeString('zh-CN'):'—'}}（获取时间）</span><span>{{sourceInfo}}</span><span class="status-spacer"></span><button @click="quick">按 . 快速输入证券</button><span>F5 浏览　F9 资料　Esc 返回</span><span>v5.0.0 · {{status.broker_mode??'paper'}}</span></footer>
 <QuickEntry :open="wizard" :x="anchor.x" :y="anchor.y" @close="wizard=false" @select="choose"/>
</div></template>
