import {createApp} from 'vue';
import {AllCommunityModule,ModuleRegistry} from 'ag-grid-community';
import App from './App.vue';
import './style.css';
ModuleRegistry.registerModules([AllCommunityModule]);
createApp(App).mount('#app');
