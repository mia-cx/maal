import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/lib/paraglide/server.js';
const source = readFileSync(path, 'utf8');
if (source.includes('// @ts-nocheck')) process.exit(0);
writeFileSync(path, source.replace('/* eslint-disable */', '/* eslint-disable */\n// @ts-nocheck'));
