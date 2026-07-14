import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const buildDirectory = '.svelte-kit/cloudflare/_app/immutable';
const budgets = JSON.parse(await readFile('performance-budgets.json', 'utf8'));

const listJavaScript = async (directory) => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? listJavaScript(path) : path.endsWith('.js') ? [path] : [];
		})
	);

	return files.flat();
};

const files = await listJavaScript(buildDirectory);
const gzipSizes = await Promise.all(
	files.map(async (file) => gzipSync(await readFile(file)).byteLength)
);
const gzipBytes = gzipSizes.reduce((total, size) => total + size, 0);

if (gzipBytes > budgets.initialSpaEntryGzipBytes) {
	throw new Error(
		`Built JavaScript is ${gzipBytes} bytes gzip; budget is ${budgets.initialSpaEntryGzipBytes} bytes.`
	);
}

console.log(`Built JavaScript: ${gzipBytes} / ${budgets.initialSpaEntryGzipBytes} bytes gzip.`);
