import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/lib/paraglide/server.js';
let source;
try {
	source = readFileSync(path, 'utf8');
} catch (cause) {
	if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
		process.exit(0);
	}
	throw cause;
}

if (source.includes('// @ts-nocheck')) process.exit(0);
writeFileSync(path, source.replace('/* eslint-disable */', '/* eslint-disable */\n// @ts-nocheck'));
