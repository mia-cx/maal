import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

describe('Cloudflare deployment resource names', () => {
	test('migrates each long-lived D1 database in place', async () => {
		const packageJson = await readJson('package.json');

		expect({
			local: packageJson.scripts?.['db:migrate:local'],
			staging: packageJson.scripts?.['db:migrate:staging'],
			production: packageJson.scripts?.['db:migrate:production']
		}).toEqual({
			local: 'wrangler d1 migrations apply maal-local --local',
			staging: 'wrangler d1 migrations apply maal-staging --remote --env staging',
			production: 'wrangler d1 migrations apply maal-prod --remote --env production'
		});
	});

	test('binds every environment to its long-lived Worker and D1 database', async () => {
		const config = await readJson('wrangler.jsonc');

		expect({ worker: config.name, database: config.d1_databases?.[0] }).toEqual({
			worker: 'maal-local',
			database: {
				binding: 'DB',
				database_name: 'maal-local',
				database_id: 'local',
				migrations_dir: 'drizzle'
			}
		});
		expect({
			worker: config.env?.staging?.name,
			database: config.env?.staging?.d1_databases?.[0]
		}).toEqual({
			worker: 'maal-staging',
			database: {
				binding: 'DB',
				database_name: 'maal-staging',
				database_id: 'c843aee2-d94c-4f9f-b26c-02deea38b86a',
				migrations_dir: 'drizzle'
			}
		});
		expect({
			worker: config.env?.production?.name,
			database: config.env?.production?.d1_databases?.[0]
		}).toEqual({
			worker: 'maal',
			database: {
				binding: 'DB',
				database_name: 'maal-prod',
				database_id: 'd498dfad-9b1f-4f35-9327-441f85a97741',
				migrations_dir: 'drizzle'
			}
		});
	});

	test('keeps the rewrite runtime settings while changing resource identity', async () => {
		const config = await readJson('wrangler.jsonc');

		expect(config.main).toBe('src/worker.ts');
		expect(config.assets).toEqual({
			binding: 'ASSETS',
			directory: '.svelte-kit/cloudflare'
		});
		expect(config.triggers).toEqual({ crons: ['17 3 * * *'] });
		expect(config.observability).toEqual({
			enabled: true,
			logs: { head_sampling_rate: 1 },
			traces: { enabled: true, head_sampling_rate: 0.01 }
		});
		expect(config.ratelimits).toEqual([
			{
				name: 'RECIPE_URL_RATE_LIMIT',
				namespace_id: '1001',
				simple: { limit: 10, period: 60 }
			}
		]);
		expect(config.env.staging).toMatchObject({
			vars: { MAAL_PROOF_TELEMETRY: 'staging-only' },
			triggers: { crons: ['17 3 * * *'] },
			ratelimits: [
				{
					name: 'RECIPE_URL_RATE_LIMIT',
					namespace_id: '1002',
					simple: { limit: 10, period: 60 }
				}
			]
		});
		expect(config.env.production).toMatchObject({
			triggers: { crons: ['17 3 * * *'] },
			ratelimits: [
				{
					name: 'RECIPE_URL_RATE_LIMIT',
					namespace_id: '1003',
					simple: { limit: 10, period: 60 }
				}
			]
		});
	});

	test('uses the local Worker identity for the SvelteKit build adapter', async () => {
		const config = await readJson('wrangler.sveltekit.jsonc');

		expect(config).toMatchObject({
			name: 'maal-local',
			main: '.svelte-kit/cloudflare/_worker.js',
			assets: { binding: 'ASSETS', directory: '.svelte-kit/cloudflare' }
		});
	});
});
