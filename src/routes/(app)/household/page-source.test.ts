import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pageSource = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');

const formForAction = (action: string) => {
	const match = pageSource.match(new RegExp(`<form[^>]*action="\\?/${action}"[^>]*>`));
	if (!match) throw new Error(`Missing household form for action ${action}`);
	return match[0];
};

describe('household settings page forms', () => {
	it.each(['updateSettings', 'updateAppliances'])(
		'enhances %s saves to avoid page reloads',
		(action) => {
			expect(formForAction(action)).toContain('use:enhance');
		}
	);
});
