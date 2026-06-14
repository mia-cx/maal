#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { argv, cwd, exit } from 'node:process';

const root = cwd();
const sourceRoot = join(root, 'src');
const importPattern = /(?:import|export)\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
const violations = [];

const sourceFiles = (directory) => {
	const entries = readdirSync(directory);
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) files.push(...sourceFiles(path));
		else if (/\.(ts|svelte)$/.test(entry)) files.push(path);
	}
	return files;
};

const relativePath = (path) => path.slice(root.length + 1);
const isDesignSystemFile = (file) => relativePath(file).startsWith('src/lib/components/ui/');

const checkFile = (file, rules) => {
	const text = readFileSync(file, 'utf8');
	for (const match of text.matchAll(importPattern)) {
		const specifier = match[1];
		for (const rule of rules) {
			if (rule.test(specifier)) {
				violations.push(`${relativePath(file)}: imports ${specifier} (${rule.message})`);
			}
		}
	}
};

for (const file of sourceFiles(sourceRoot)) {
	const relativeFile = relativePath(file);
	if (!isDesignSystemFile(file)) {
		const allowsServerTypes =
			relativeFile === 'src/app.d.ts' || relativeFile === 'src/lib/features/flags.ts';
		checkFile(file, [
			{
				test: (specifier) =>
					specifier.startsWith('$lib/server/') &&
					!allowsServerTypes &&
					!relativeFile.startsWith('src/routes/') &&
					!relativeFile.startsWith('src/lib/server/') &&
					!relativeFile.endsWith('.server.ts'),
				message: 'server-only modules stay behind server routes/services'
			},
			{
				test: (specifier) =>
					specifier.startsWith('$lib/components/menu/') &&
					specifier !== '$lib/components/menu' &&
					!relativeFile.startsWith('src/lib/components/menu/'),
				message: 'cross-feature imports should use the menu public barrel'
			}
		]);
		continue;
	}

	checkFile(file, [
		{
			test: (specifier) =>
				specifier.startsWith('$lib/stores') ||
				specifier.startsWith('$lib/server') ||
				specifier.startsWith('$lib/components/dashboard') ||
				specifier.startsWith('$lib/components/menu') ||
				specifier.startsWith('$lib/components/settings'),
			message: 'design-system primitives must not depend on product domains'
		}
	]);
}

if (violations.length) {
	console.error('Boundary violations found:');
	for (const violation of violations) console.error(`- ${violation}`);
	exit(1);
}

if (argv.includes('--verbose')) console.log('No boundary violations found.');
