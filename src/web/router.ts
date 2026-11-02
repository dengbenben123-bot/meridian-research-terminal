import {createRouter,createWebHistory} from 'vue-router';
import {initialise,state} from './client';
import PublicView from './views/PublicView.vue';
const router=createRouter({history:createWebHistory(),routes:[
 {path:'/',component:PublicView,props:{page:'home'}},{path:'/guide',component:PublicView,props:{page:'guide'}},
 {path:'/research',component:()=>import('./views/ResearchView.vue')},
 {path:'/research/:id',component:()=>import('./views/ArticleView.vue')},
 {path:'/login',component:()=>import('./views/AuthView.vue'),props:{mode:'login'}},
 {path:'/register',component:()=>import('./views/AuthView.vue'),props:{mode:'register'}},
 {path:'/app',redirect:'/app/notes'},
 {path:'/app/:section(notes|files|watchlist|account)',component:()=>import('./views/WorkspaceView.vue'),meta:{private:true}},
 {path:'/:pathMatch(.*)*',component:PublicView,props:{page:'missing'}}
]});
router.beforeEach(async to=>{if(to.meta.private){await initialise();if(!state.user)return {path:'/login',query:{next:to.fullPath}};}});
router.afterEach(to=>{if(typeof document!=='undefined'){document.title=to.meta.private?'Workspace · Meridian':to.path==='/research'?'Public research · Meridian':'Meridian · Research, organised';window.scrollTo?.(0,0);}});
export default router;
