import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry'
	},
	webServer: {
		command: 'pnpm build && pnpm preview',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI
	}
});
