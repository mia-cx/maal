#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Lightweight review aid, not a compiler. It reports repeated normalized windows
// outside generated/vendor-like UI primitives so reviewers can inspect semantic duplication.
const roots = ['src/lib', 'src/routes'];
const windowSize = Number(process.argv[2] ?? 8);

const sourceFiles = (dir) => {
	const entries = readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : [path];
	});
	return entries.filter((path) => path.endsWith('.ts') || path.endsWith('.svelte'));
};

const semanticLines = (source) => {
	const lines = [];
	let inImport = false;
	for (const rawLine of source.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('//')) continue;
		if (inImport) {
			if (line.includes(' from ')) inImport = false;
			continue;
		}
		if (line.startsWith('import ')) {
			if (!line.includes(' from ')) inImport = true;
			continue;
		}
		lines.push(line);
	}
	return lines;
};

const windows = new Map();

for (const file of roots.flatMap(sourceFiles)) {
	if (file.includes('/components/ui/')) continue;
	const lines = semanticLines(readFileSync(file, 'utf8'));

	for (let index = 0; index <= lines.length - windowSize; index += 1) {
		const key = lines.slice(index, index + windowSize).join('\n');
		const entries = windows.get(key) ?? [];
		entries.push(`${relative(process.cwd(), file)}:${index + 1}`);
		windows.set(key, entries);
	}
}

for (const [key, entries] of windows) {
	const distinctFiles = new Set(entries.map((entry) => entry.split(':')[0]));
	if (distinctFiles.size < 3) continue;
	console.log(`\n--- ${entries.length} instances across ${distinctFiles.size} files ---`);
	console.log(entries.slice(0, 8).join('\n'));
	console.log(key);
}
