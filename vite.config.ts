import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({plugins:[vue()],css:{postcss:{plugins:[]}},build:{outDir:'dist/client',emptyOutDir:true,sourcemap:false}});
