import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const prototypeRef = '74a12ec38f6c297d1a6adbf596234c45212bac11';
const exactPrototypeFiles = [
	'src/lib/interaction/scroll-sdk.ts',
	'src/lib/components/dashboard/schedule-header.svelte',
	'src/lib/components/dashboard/multi-day-schedule.svelte',
	'src/lib/components/dashboard/meal-check-in-dialog.svelte',
	'src/lib/components/dashboard/meal-preview-dialog.svelte',
	'src/lib/components/dashboard/schedule-dnd.ts',
	'src/lib/components/dashboard/schedule-keyboard.ts',
	'src/lib/components/dashboard/schedule-interactions.ts',
	'src/lib/components/dashboard/schedule-meal-pool.svelte',
	'src/lib/components/dashboard/schedule-meal-pool-bar.svelte'
];
const requiredRewriteSurfaces = [
	'src/routes/(app)/plan/+page.svelte',
	'src/routes/(app)/menu/+page.svelte',
	'src/routes/(app)/household/+page.svelte',
	'src/routes/recovery/+page.svelte',
	'src/routes/(app)/subscribe/+page.svelte',
	'src/lib/components/dashboard/continuous-schedule.svelte',
	'src/lib/components/dashboard/month-schedule.svelte',
	'src/lib/components/household/household-settings.svelte',
	'src/lib/components/menu/my-menu-dashboard.svelte',
	'src/lib/components/local-settings-dialog.svelte'
];

const failures = [];
for (const file of exactPrototypeFiles) {
	const prototype = execFileSync('git', ['show', `${prototypeRef}:${file}`]);
	const current = readFileSync(file);
	if (!prototype.equals(current)) failures.push(`${file} differs from the prototype authority`);
}
for (const file of requiredRewriteSurfaces) {
	if (!existsSync(file)) failures.push(`${file} is missing from the rewrite`);
}

if (failures.length) {
	console.error(`Prototype UI proof failed for ${prototypeRef}:`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(
		`Prototype UI proof passed: ${exactPrototypeFiles.length} interaction/UI files match ${prototypeRef} exactly; ${requiredRewriteSurfaces.length} rewrite surfaces are present.`
	);
}
