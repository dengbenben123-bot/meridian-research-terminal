import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import App from '../src/App.vue';
import QuickEntry from '../src/components/QuickEntry.vue';
import MarketChart from '../src/components/MarketChart.vue';
import {csvSafe,safeURL} from '../src/api';

const instrument={symbol:'600519.SH',code:'600519',name:'贵州茅台',exchange:'SH',kind:'equity'};
const quote={...instrument,price:10,change_pct:2,volume:1200,pe:20};
const envelope={state:'ok',rows:[quote],received_at:'2026-10-30T07:00:00Z',meta:{source:'Fixture only',frequency:'snapshot'}};
const calls:{path:string;init?:RequestInit}[]=[];
const tableStub={props:['rows','columns'],emits:['open','watch'],template:'<div class="grid-stub"><button v-if="rows.length" @click="$emit(\'open\',rows[0])">打开第一行</button><span v-for="row in rows">{{row.name||row.item}}</span></div>'};
let wrapper:ReturnType<typeof mount>|undefined;
beforeEach(()=>{
 calls.length=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push({path,init});let result:unknown=envelope;
  if(path.startsWith('/api/search'))result={items:[instrument]};
  else if(path==='/api/status')result={version:'5.0.0',configured_instruments:5000,broker_mode:'paper',live_execution:false,snapshot_interval_seconds:10};
  else if(path==='/api/auth/check')result={owner:'fixture-owner'};
  else if(path.startsWith('/api/preferences'))result=init?.method==='POST'?{ok:true}:{items:[]};
  else if(path.startsWith('/api/watchlists'))result=init?.method?{ok:true}:{items:[]};
  else if(path.includes('/industries'))result={items:[]};
  else if(path.includes('/bars'))result={...envelope,rows:[{date:'2026-10-30',open:10,high:11,low:9,close:10,volume:1000}],indicators:[]};
  else if(path.includes('/detail/'))result={...envelope,rows:[{item:'行业',value:'白酒'}]};
  else if(path==='/api/cn/news')result={...envelope,rows:[{'标题':'公开源测试资讯','内容':'<script>not executable</script>','发布时间':'10:00'}]};
  else if(path.includes('/macro/'))result={...envelope,rows:[{'季度':'2025年第1季度','GDP':20},{'季度':'2025年第2季度','GDP':null}]};
  else if(path==='/api/broker/positions')result={cash:1000000,available_cash:1000000,positions:[],orders:[]};
  else if(path==='/api/broker/preview')result={preview_id:'a'.repeat(32),symbol:instrument.symbol,last_price:10,quantity:100,side:'buy',estimated_gross:1000,estimated_fee:.3};
  else if(path==='/api/broker/submit')result={order_id:'fixture-order',state:'filled'};
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 }));
});
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.unstubAllGlobals();vi.restoreAllMocks();});
async function app(){wrapper=mount(App,{global:{stubs:{SourceTable:tableStub}}});await flushPromises();return wrapper;}
async function clickText(text:string){const button=wrapper!.findAll('button').find(b=>b.text().includes(text));expect(button,`button ${text}`).toBeTruthy();await button!.trigger('click');await flushPromises();}

describe('desktop terminal workflows',()=>{
 it('opens the keyboard wizard with period and navigates to F5 on Enter',async()=>{
  const root=await app();window.dispatchEvent(new KeyboardEvent('keydown',{key:'.',cancelable:true}));await flushPromises();
  const quick=root.find('input[aria-label="证券快速查找"]');expect(quick.exists()).toBe(true);
  await quick.setValue('gzmt');await quick.trigger('keydown',{key:'Enter'});await flushPromises();
  expect(root.find('.quick-entry').exists()).toBe(false);expect(root.text()).toContain('已定位 600519.SH');
  expect(calls.some(c=>c.path.includes('/api/search?q=gzmt'))).toBe(true);
 });
 it('does not intercept a decimal point typed in a filter field',async()=>{
  const root=await app();await root.find('.filter-row input').trigger('keydown',{key:'.'});expect(root.find('.quick-entry').exists()).toBe(false);
 });
 it('uses F9 and Esc without triggering browser reload',async()=>{
  const root=await app();const event=new KeyboardEvent('keydown',{key:'F9',cancelable:true});window.dispatchEvent(event);await flushPromises();
  expect(event.defaultPrevented).toBe(true);expect(root.findAll('.rect-tabs button')).toHaveLength(5);
  expect(calls.some(c=>c.path.includes('/api/cn/equity/bars?'))).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await flushPromises();expect(root.find('.rect-tabs').exists()).toBe(false);
 });
 it('saves workspace and filters through the authenticated API',async()=>{
  await app();await clickText('保存工作区');await clickText('保存条件');
  const writes=calls.filter(c=>c.path==='/api/preferences'&&c.init?.method==='POST').map(c=>JSON.parse(String(c.init!.body)));
  expect(writes.map(w=>w.category)).toEqual(['workspace','screen']);expect(writes[0].content.news_dock).toBe('bottom');
 });
 it('adds the selected stock to a watchlist from F9',async()=>{
  await app();window.dispatchEvent(new KeyboardEvent('keydown',{key:'F9',cancelable:true}));await flushPromises();await clickText('加入自选');
  const request=calls.find(c=>c.path==='/api/watchlists'&&c.init?.method==='POST');expect(request).toBeTruthy();expect(JSON.parse(String(request!.init!.body)).symbol).toBe('600519.SH');
 });
 it('requires explicit preview then submit for paper trading',async()=>{
  const root=await app();await clickText('模拟账户 / 委托');expect(root.text()).toContain('No real orders will be placed');
  expect(calls.some(c=>c.path==='/api/broker/submit')).toBe(false);
  await root.find('.paper-content form').trigger('submit');await flushPromises();expect(root.find('.preview-order').exists()).toBe(true);
  expect(calls.some(c=>c.path==='/api/broker/submit')).toBe(false);
  await clickText('确认提交模拟委托');expect(calls.filter(c=>c.path==='/api/broker/submit')).toHaveLength(1);
 });
 it('keeps missing macro values out of the line chart',async()=>{
  const root=await app();await clickText('EDB 经济数据库');
  const chart=root.findComponent(MarketChart);expect(chart.props('line')).toHaveLength(1);expect(chart.props('line')?.[0]?.value).toBe(20);
 });
 it('shows a source failure instead of fabricated quote rows',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'unavailable',rows:[],message:'Source down'}))));
  const root=await app();expect(root.text()).toContain('Source down');expect(root.findComponent({name:'SourceTable'}).exists()).toBe(false);
  expect(root.find('.grid-stub').text()).not.toContain('贵州茅台');
 });
});

describe('quick-entry asynchronous correctness',()=>{
 it('does not choose stale results when Enter precedes the debounce',async()=>{
  wrapper=mount(QuickEntry,{props:{open:false,x:100,y:60}});await wrapper.setProps({open:true});await flushPromises();
  await wrapper.find('input').setValue('600519');await wrapper.find('input').trigger('keydown',{key:'Enter'});await flushPromises();
  expect(calls.some(c=>c.path==='/api/search?q=600519')).toBe(true);expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject(instrument);
 });
 it('does not select a previous result after a new search fails',async()=>{
  wrapper=mount(QuickEntry,{props:{open:false,x:100,y:60}});await wrapper.setProps({open:true});await flushPromises();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"detail":"Source unavailable"}',{status:503})));
  await wrapper.find('input').setValue('new-query');await wrapper.find('input').trigger('keydown',{key:'Enter'});await flushPromises();
  expect(wrapper.emitted('select')).toBeUndefined();expect(wrapper.text()).toContain('Source unavailable');
 });
});

describe('export and source content handling',()=>{
 it('guards formula-like strings without changing negative numeric values',()=>{expect(String(csvSafe('=HYPERLINK("bad")')).startsWith("'")).toBe(true);expect(String(csvSafe(' \t+1')).startsWith("'")).toBe(true);expect(csvSafe(-2)).toBe(-2);});
 it('permits only HTTP links for public article navigation',()=>{expect(safeURL('javascript:alert(1)')).toBeUndefined();expect(safeURL('data:text/html,bad')).toBeUndefined();expect(safeURL('https://example.com/report')).toBe('https://example.com/report');});
});
