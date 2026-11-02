import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {defineComponent} from 'vue';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import {createRouter,createMemoryHistory,RouterView} from 'vue-router';
import AuthView from '../../src/web/views/AuthView.vue';
import WorkspaceView from '../../src/web/views/WorkspaceView.vue';
import ArticleView from '../../src/web/views/ArticleView.vue';
import {api,send,state,safeNext,type Note} from '../../src/web/client';

vi.mock('../../src/web/client',async original=>({...await original<typeof import('../../src/web/client')>(),api:vi.fn(),send:vi.fn()}));
vi.mock('../../src/web/components/Challenge.vue',async()=>{
 const {defineComponent}=await import('vue');
 return {default:defineComponent({props:['action'],emits:['update:token'],setup(_,{emit,expose}){expose({reset:()=>emit('update:token','')});},template:'<button type="button" data-test="captcha" @click="$emit(\'update:token\',\'solved-token\')">Security check</button>'})};
});
const user={id:'11111111-1111-4111-8111-111111111111',email:'reader@example.com',display_name:'Researcher'};
const note:Note={id:'22222222-2222-4222-8222-222222222222',owner_id:user.id,title:'Original question',body:'Original evidence',visibility:'private',version:3,created_at:100,updated_at:100};
const wrappers:VueWrapper[]=[];
const mockedApi=vi.mocked(api),mockedSend=vi.mocked(send);
beforeEach(()=>{vi.clearAllMocks();state.user={...user};state.ready=true;state.config={accountsReady:true,turnstileSiteKey:'site-key',version:'6.0.0'};mockedApi.mockResolvedValue({items:[]});vi.spyOn(window,'confirm').mockReturnValue(true);});
afterEach(()=>{for(const wrapper of wrappers.splice(0))wrapper.unmount();vi.restoreAllMocks();});
async function screen(path:string){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/login',component:AuthView,props:{mode:'login'}},{path:'/register',component:AuthView,props:{mode:'register'}},{path:'/app/:section',component:WorkspaceView},{path:'/research/:id',component:ArticleView},{path:'/research',component:defineComponent({template:'<div>Public research</div>'})}]});
 await router.push(path);await router.isReady();const wrapper=mount(RouterView,{global:{plugins:[router]}});wrappers.push(wrapper);await flushPromises();return {wrapper,router};
}
describe('account interface',()=>{
 it('requires the security check and keeps the redirect inside the workspace',async()=>{
  state.user=null;mockedSend.mockResolvedValue({user});const {wrapper,router}=await screen('/login?next=https://example.org/elsewhere');
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  await wrapper.get('input[name="email"]').setValue(user.email);await wrapper.get('input[name="password"]').setValue('a-long-test-password');await wrapper.get('[data-test="captcha"]').trigger('click');await wrapper.get('form').trigger('submit');await flushPromises();
  expect(mockedSend).toHaveBeenCalledWith('/api/auth/login',{email:user.email,password:'a-long-test-password',captchaToken:'solved-token'});expect(router.currentRoute.value.path).toBe('/app/notes');expect(state.user?.email).toBe(user.email);
  for(const input of ['//other.example','/app/notes?next=elsewhere','/app/../login',null])expect(safeNext(input)).toBe('/app/notes');
 });
 it('clears the password and solved challenge when changing account forms',async()=>{
  const {wrapper,router}=await screen('/login');await wrapper.get('input[name="password"]').setValue('a-long-test-password');await wrapper.get('[data-test="captcha"]').trigger('click');await router.push('/register');await flushPromises();
  expect((wrapper.get('input[name="password"]').element as HTMLInputElement).value).toBe('');expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();expect(wrapper.get('input[name="name"]').exists()).toBe(true);
 });
});
describe('owned research workspace',()=>{
 it('starts empty and creates a private note without invented content',async()=>{
  mockedSend.mockResolvedValue({id:note.id,version:1});const {wrapper}=await screen('/app/notes');expect(wrapper.text()).toContain('No matching notes.');expect(mockedApi).toHaveBeenCalledWith('/api/posts?scope=mine',expect.objectContaining({signal:expect.any(AbortSignal)}));
  await wrapper.get('.workspace-toolbar .primary').trigger('click');await wrapper.get('.note-editor input').setValue('My actual question');await wrapper.get('.note-editor textarea').setValue('My own evidence');await wrapper.get('.note-editor').trigger('submit');await flushPromises();
  expect(mockedSend).toHaveBeenCalledWith('/api/posts',{title:'My actual question',body:'My own evidence',visibility:'private',captchaToken:''},'POST');expect(wrapper.text()).toContain('Private note saved.');expect(wrapper.find('.unsaved').exists()).toBe(false);
 });
 it('requires an explicit public choice and a publishing challenge',async()=>{
  mockedSend.mockResolvedValue({id:note.id,version:1});const {wrapper}=await screen('/app/notes');await wrapper.get('.workspace-toolbar .primary').trigger('click');await wrapper.get('.note-editor input').setValue('Public question');await wrapper.get('textarea').setValue('Evidence');await wrapper.get('select').setValue('public');expect(wrapper.get('.editor-actions .primary').attributes('disabled')).toBeDefined();
  await wrapper.get('[data-test="captcha"]').trigger('click');await wrapper.get('.note-editor').trigger('submit');await flushPromises();expect(mockedSend).toHaveBeenCalledWith('/api/posts',expect.objectContaining({visibility:'public',captchaToken:'solved-token'}),'POST');expect(wrapper.text()).toContain('Public note saved. Anyone can read it.');
 });
 it('keeps edited content after a server version conflict',async()=>{
  mockedApi.mockImplementation(async path=>path.startsWith('/api/posts/')?{post:note}:{items:[note]} as any);mockedSend.mockRejectedValue(Error('This note changed in another tab. Reload before saving.'));
  const {wrapper}=await screen('/app/notes');await wrapper.get('.note-index button').trigger('click');await flushPromises();await wrapper.get('textarea').setValue('Unsaved evidence that must survive');await wrapper.get('.note-editor').trigger('submit');await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain('another tab');expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Unsaved evidence that must survive');expect(wrapper.find('.unsaved').exists()).toBe(true);expect(mockedSend).toHaveBeenCalledWith('/api/posts/'+note.id,expect.objectContaining({version:3}),'PATCH');
 });
 it('lets an account reach notes beyond the first page',async()=>{
  mockedApi.mockResolvedValue({items:Array.from({length:25},(_,i)=>({...note,id:String(i),title:'Question '+i}))});const {wrapper}=await screen('/app/notes');await wrapper.get('.note-index .pager button:last-child').trigger('click');await flushPromises();expect(mockedApi).toHaveBeenCalledWith('/api/posts?scope=mine&offset=25',expect.objectContaining({signal:expect.any(AbortSignal)}));
 });
 it('does not let a late read replace a newly started note',async()=>{
  let resolve!:(value:any)=>void;mockedApi.mockImplementation(async path=>path.startsWith('/api/posts/')?new Promise(r=>{resolve=r;}):{items:[note]} as any);
  const {wrapper}=await screen('/app/notes');await wrapper.get('.note-index button').trigger('click');await wrapper.get('.workspace-toolbar .primary').trigger('click');await wrapper.get('.note-editor input').setValue('New working question');resolve({post:note});await flushPromises();expect((wrapper.get('.note-editor input').element as HTMLInputElement).value).toBe('New working question');
 });
 it('does not publish a file when opening the confirmation form',async()=>{
  mockedApi.mockResolvedValue({items:[{id:note.id,filename:'evidence.pdf',mime:'application/pdf',bytes:10,visibility:'private',url:'/media/'+note.id}]});mockedSend.mockResolvedValue({ok:true});const {wrapper}=await screen('/app/files');await wrapper.get('.data-table tbody button').trigger('click');expect(mockedSend).not.toHaveBeenCalled();expect(wrapper.get('.publish-file .primary').attributes('disabled')).toBeDefined();await wrapper.get('.publish-file [data-test="captcha"]').trigger('click');await wrapper.get('.publish-file').trigger('submit');await flushPromises();expect(mockedSend).toHaveBeenCalledWith('/api/files/'+note.id,{visibility:'public',captchaToken:'solved-token'},'PATCH');
 });
 it('fetches watchlist quotes only after the user requests them',async()=>{
  mockedApi.mockImplementation(async path=>path.startsWith('/api/markets/')?{rows:[],state:'partial',cached:false,received_at:'2026-10-30T00:00:00Z'}:{items:[{symbol:'600519.SH',name:'贵州茅台',currency:'CNY'}]} as any);
  const {wrapper}=await screen('/app/watchlist');expect(mockedApi.mock.calls.some(([path])=>path.startsWith('/api/markets/'))).toBe(false);expect((wrapper.get('.poll-toggle input').element as HTMLInputElement).checked).toBe(false);await wrapper.get('.workspace-toolbar .primary').trigger('click');await flushPromises();expect(mockedApi).toHaveBeenCalledWith('/api/markets/quotes?symbols=600519.SH');expect(wrapper.text()).toContain('Partial source response');
 });
});
it('renders member research as plain text rather than active HTML',async()=>{
 mockedApi.mockResolvedValue({post:{...note,visibility:'public',title:'<script>bad()</script>',body:'<img src=x onerror=bad()>'}});const {wrapper}=await screen('/research/'+note.id);expect(wrapper.get('h1').text()).toBe('<script>bad()</script>');expect(wrapper.get('.article-body').text()).toContain('<img');expect(wrapper.find('script').exists()).toBe(false);expect(wrapper.find('img').exists()).toBe(false);
});
