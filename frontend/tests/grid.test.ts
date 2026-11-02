import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {AllCommunityModule,ModuleRegistry} from 'ag-grid-community';
import SourceTable from '../src/components/SourceTable.vue';
ModuleRegistry.registerModules([AllCommunityModule]);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('renders the real Community grid and opens the custom context menu without Enterprise',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:1000,height:400,top:0,left:0,right:1000,bottom:400,toJSON(){return {};}});
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1000);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
 const root=mount(SourceTable,{props:{rows:[{symbol:'600519.SH',name:'贵州茅台',price:10}],securityActions:true},attachTo:document.body});
 try{
  await flushPromises();await new Promise(resolve=>setTimeout(resolve,50));await flushPromises();
  expect(root.find('.ag-root').exists()).toBe(true);expect(root.findAll('.ag-cell').length).toBeGreaterThan(0);
  await root.find('.ag-cell').trigger('contextmenu',{clientX:100,clientY:100});
  expect(root.find('.context-menu').text()).toContain('加入我的自选');
  const add=root.findAll('.context-menu button').find(b=>b.text().includes('加入我的自选'))!;await add.trigger('click');
  expect(root.emitted('watch')?.[0]?.[0]).toMatchObject({symbol:'600519.SH'});
 }finally{root.unmount();}
});
