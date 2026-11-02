import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({plugins:[vue()],build:{sourcemap:false},test:{environment:'jsdom',include:['tests/**/*.test.ts']}});
