import {defineConfig} from 'vitest/config';
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-plugin';
export default defineConfig(async()=>({plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{bindings:{TEST_MIGRATIONS:await readD1Migrations('./migrations')}}})],test:{include:['tests/api/**/*.test.ts'],setupFiles:['tests/api/setup.ts'],testTimeout:30000}}));
