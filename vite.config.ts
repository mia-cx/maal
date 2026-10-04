import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

// Miniflare starts workerd processes. Keep these suites out of the parallel
// unit/browser pool so runner contention cannot consume their assertion budget.
const d1TestFiles = [
	'tests/unit/*-d1.spec.ts',
	'tests/unit/d1-schema-baseline.spec.ts',
	'tests/unit/billing-live-membership.spec.ts',
	'tests/unit/billing-trial-maintenance.spec.ts',
	'tests/unit/billing-deletion-reconciliation.spec.ts',
	'tests/unit/household-retention.spec.ts',
	'tests/unit/meal-check-in-recovery.spec.ts',
	'tests/unit/scheduled-retention.spec.ts',
	'tests/unit/mcp-key-routes.spec.ts',
	'tests/unit/mcp-authorization.spec.ts',
	'tests/unit/recipe-url-import.spec.ts'
];

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ config: 'wrangler.sveltekit.jsonc' }),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['url']
		})
	],
	optimizeDeps: {
		include: [
			'@lucide/svelte/icons/chevron-down',
			'@lucide/svelte/icons/chevron-up',
			'@lucide/svelte/icons/grip-vertical',
			'@lucide/svelte/icons/message-square-text',
			'@lucide/svelte/icons/minus',
			'@lucide/svelte/icons/plus',
			'@lucide/svelte/icons/repeat',
			'@lucide/svelte/icons/star',
			'@lucide/svelte/icons/timer',
			'@solar-icons/svelte/Outline'
		]
	},
	test: {
		expect: { requireAssertions: true },
		maxWorkers: 4,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'json-summary'],
			reportsDirectory: './coverage',
			include: ['src/lib/**/*.{ts,svelte}', 'src/routes/**/*.{ts,svelte}'],
			exclude: ['src/**/*.d.ts', 'src/lib/paraglide/**']
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', ...d1TestFiles]
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'd1',
					environment: 'node',
					include: d1TestFiles,
					fileParallelism: false,
					sequence: { groupOrder: 1 },
					// These are integration checks, not five-second performance budgets.
					testTimeout: 30_000,
					hookTimeout: 30_000
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'browser',
					include: ['tests/browser/**/*.{test,spec}.{js,ts}'],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
