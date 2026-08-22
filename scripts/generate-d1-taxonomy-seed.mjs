import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createServer } from 'vite';

const target = resolve('drizzle/0001_global_taxonomy_seed.sql');
const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });

const sqlValue = (value) => {
	if (value === null) return 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
	throw new TypeError('The global taxonomy seed contains an unsupported SQL value.');
};

const insert = (table, columns, rows) => {
	if (rows.length === 0) return '';
	const values = rows.map((row) => `\t(${row.map(sqlValue).join(', ')})`).join(',\n');
	return `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES\n${values};`;
};

try {
	const {
		GLOBAL_FOOD_ALIAS_SEED,
		GLOBAL_FOOD_SEED,
		GLOBAL_UNIT_ALIAS_SEED,
		GLOBAL_UNIT_SEED,
		validateGlobalTaxonomySeed
	} = await vite.ssrLoadModule('/src/lib/domain/taxonomy/global-seed.ts');
	validateGlobalTaxonomySeed();
	const statements = [
		insert(
			'units',
			['id', 'base_unit_id', 'to_base_factor', 'to_base_offset'],
			GLOBAL_UNIT_SEED.map((unit) => [
				unit.id,
				unit.baseUnitId,
				unit.toBaseFactor,
				unit.toBaseOffset
			])
		),
		insert(
			'unit_aliases',
			[
				'id',
				'unit_id',
				'base_unit_id',
				'alias',
				'plural_alias',
				'locale',
				'source_domain',
				'default_for_locale',
				'created_at',
				'updated_at'
			],
			GLOBAL_UNIT_ALIAS_SEED.map((alias) => [
				alias.id,
				alias.unitId,
				alias.baseUnitId,
				alias.alias,
				alias.pluralAlias,
				alias.locale,
				alias.sourceDomain,
				alias.defaultForLocale,
				alias.createdAt,
				alias.updatedAt
			])
		),
		insert(
			'foods',
			['id', 'default_measure_unit_id', 'default_measure_base_unit_id'],
			GLOBAL_FOOD_SEED.map((food) => [
				food.id,
				food.defaultMeasureUnitId,
				food.defaultMeasureBaseUnitId
			])
		),
		insert(
			'food_aliases',
			[
				'id',
				'food_id',
				'alias',
				'locale',
				'source_domain',
				'default_for_locale',
				'default_measure_unit_id',
				'default_measure_base_unit_id',
				'created_at',
				'updated_at'
			],
			GLOBAL_FOOD_ALIAS_SEED.map((alias) => [
				alias.id,
				alias.foodId,
				alias.alias,
				alias.locale,
				alias.sourceDomain,
				alias.defaultForLocale,
				alias.defaultMeasureUnitId,
				alias.defaultMeasureBaseUnitId,
				alias.createdAt,
				alias.updatedAt
			])
		)
	].filter(Boolean);
	const source = [
		'-- Generated from src/lib/domain/taxonomy/global-seed.ts. Do not edit by hand.',
		statements.join('\n--> statement-breakpoint\n')
	].join('\n');
	const rendered = `${source}\n`;
	if (process.argv.includes('--check')) {
		const current = await readFile(target, 'utf8');
		if (current !== rendered) {
			throw new TypeError(
				'The checked-in D1 taxonomy seed differs from src/lib/domain/taxonomy/global-seed.ts.'
			);
		}
	} else {
		await writeFile(target, rendered, 'utf8');
	}
} finally {
	await vite.close();
}
