import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: 'meal-plan-local-first.e2e.ts',
	fullyParallel: true,
	workers: 4,
	retries: 0,
	use: {
		baseURL: 'http://127.0.0.1:4493',
		trace: 'on-first-retry'
	},
	webServer: {
		command: 'pnpm build && pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port 4493',
		url: 'http://127.0.0.1:4493',
		reuseExistingServer: false
	}
});
