import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const sourceRoots = ['src/lib/components', 'src/lib/stores'];
const sourceExtensions = new Set(['.ts', '.svelte']);
const allowedFetchFiles = new Set([
	'src/lib/components/household/household-onboarding.svelte',
	'src/lib/components/dashboard/schedule-check-ins.ts',
	'src/lib/components/dashboard/schedule-meal-client.ts'
]);
const forbiddenRemoteImports = [
	'$lib/menu/menu-client',
	'./schedule-meal-client',
	'./schedule-check-ins',
	'$lib/client-db/menu-sync',
	'$lib/client-db/schedule-sync',
	'$lib/client-db/check-in-sync',
	'$lib/client-db/taxonomy-sync'
];

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) return walk(path);
		if (path.includes('.test.')) return [];
		return [...sourceExtensions].some((extension) => path.endsWith(extension)) ? [path] : [];
	});

const relative = (path: string) => path.slice(repoRoot.length + 1);

describe('local-first client boundary', () => {
	it('keeps UI components and nanostores off remote meal/menu clients', () => {
		const violations = sourceRoots
			.flatMap((root) => walk(join(repoRoot, root)))
			.flatMap((path) => {
				const rel = relative(path);
				if (rel.endsWith('.test.ts')) return [];
				const source = readFileSync(path, 'utf8');
				const remoteImportViolations = forbiddenRemoteImports
					.filter((specifier) => source.includes(specifier))
					.map((specifier) => `${rel}: imports ${specifier}`);
				const fetchViolation =
					source.includes('fetch(') && !allowedFetchFiles.has(rel) ? [`${rel}: calls fetch()`] : [];
				return [...remoteImportViolations, ...fetchViolation];
			});

		expect(violations).toEqual([]);
	});
});
