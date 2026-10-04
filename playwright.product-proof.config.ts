import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/product-proof',
	testMatch: '**/*.proof.ts',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		['list'],
		['html', { open: 'never', outputFolder: 'playwright-report/product-proof' }]
	],
	use: {
		baseURL: 'http://127.0.0.1:4180',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'firefox',
			testMatch: '**/browser-smoke.proof.ts',
			use: { ...devices['Desktop Firefox'] }
		},
		{
			name: 'webkit',
			testMatch: '**/browser-smoke.proof.ts',
			use: { ...devices['Desktop Safari'] }
		}
	],
	webServer: {
		command: 'pnpm build && wrangler dev .svelte-kit/cloudflare/_worker.js --port 4180',
		url: 'http://127.0.0.1:4180',
		reuseExistingServer: !process.env.CI
	}
});
