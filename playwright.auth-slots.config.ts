import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AUTH_SLOT_PROOF_BASE_URL ?? 'https://missing-auth-slot-proof.invalid';

export default defineConfig({
	testDir: './tests/proofs',
	testMatch: 'auth-slots.workos.proof.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
		{ name: 'ios-webkit-emulation', use: { ...devices['iPhone 15'] } },
		{ name: 'android-chromium-emulation', use: { ...devices['Pixel 7'] } }
	]
});
