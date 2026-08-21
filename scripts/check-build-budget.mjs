import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const clientDirectory = '.svelte-kit/output/client';
const clientManifestPath = join(clientDirectory, '.vite/manifest.json');
const serverManifestPath = '.svelte-kit/output/server/manifest-full.js';

export const findPageNodeIds = (routes, pathname) => {
	const route = routes.find((candidate) => candidate.page && candidate.pattern.test(pathname));
	if (!route?.page) throw new Error(`No built page route matches ${pathname}.`);

	return [...route.page.layouts, route.page.leaf].filter(Number.isInteger);
};

export const collectStaticJavaScriptFiles = (manifest, entryNames) => {
	const keysByName = new Map(
		Object.entries(manifest).map(([key, descriptor]) => [descriptor.name, key])
	);
	const files = new Set();
	const visited = new Set();

	const visit = (key) => {
		if (visited.has(key)) return;
		visited.add(key);

		const descriptor = manifest[key];
		if (!descriptor) throw new Error(`Built client manifest is missing ${key}.`);
		if (descriptor.file?.endsWith('.js')) files.add(descriptor.file);
		for (const importedKey of descriptor.imports ?? []) visit(importedKey);
	};

	for (const entryName of entryNames) {
		const key = keysByName.get(entryName);
		if (!key) throw new Error(`Built client manifest is missing entry ${entryName}.`);
		visit(key);
	}

	return files;
};

const run = async () => {
	const budgets = JSON.parse(await readFile('performance-budgets.json', 'utf8'));
	const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8'));
	const { manifest: serverManifest } = await import(pathToFileURL(serverManifestPath).href);
	const initialPath = budgets.initialSpaPath ?? '/';
	const pageNodeIds = findPageNodeIds(serverManifest._.routes, initialPath);
	const entryNames = ['entry/start', 'entry/app', ...pageNodeIds.map((id) => `nodes/${id}`)];
	const files = collectStaticJavaScriptFiles(clientManifest, entryNames);
	const gzipSizes = await Promise.all(
		[...files].map(async (file) => gzipSync(await readFile(join(clientDirectory, file))).byteLength)
	);
	const gzipBytes = gzipSizes.reduce((total, size) => total + size, 0);

	if (gzipBytes > budgets.initialSpaEntryGzipBytes) {
		throw new Error(
			`Initial SPA entry for ${initialPath} is ${gzipBytes} bytes gzip; budget is ${budgets.initialSpaEntryGzipBytes} bytes.`
		);
	}

	console.log(
		`Initial SPA entry for ${initialPath}: ${gzipBytes} / ${budgets.initialSpaEntryGzipBytes} bytes gzip across ${files.size} files.`
	);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
