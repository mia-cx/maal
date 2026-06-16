import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '$lib/server/db/schema';
import {
	householdMealInstructionEvents,
	householdMealInstructions,
	unitAliases,
	units,
	userRecipeInstructionEvents,
	userRecipeInstructions
} from '$lib/server/db/schema';

type Db = DrizzleD1Database<typeof schema>;
type UnitRow = typeof units.$inferSelect;
type InstructionEvent = {
	kind: 'temperature';
	sourceText: string;
	value: number;
	unitId: string;
	baseValue: number;
	baseUnitId: string;
	confidence: number;
};
type UserInstruction = Pick<typeof userRecipeInstructions.$inferSelect, 'id' | 'text'>;
type MealInstruction = Pick<typeof householdMealInstructions.$inferSelect, 'id' | 'text'>;

const temperatureBaseUnitId = 'celsius';

const normalizedAlias = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[°º]\s*/gu, '')
		.replace(/\s+/gu, ' ')
		.replace(/[.,]+$/g, '');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const aliasPattern = (alias: string): string => {
	const escaped = escapeRegExp(alias.trim()).replace(/°/gu, '[°º]');
	return escaped.replace(/\\ /gu, '\\s+');
};

const sourceToBase = (value: number, unit: UnitRow): number =>
	value * unit.toBaseFactor + unit.toBaseOffset;

const loadTemperatureParser = async (db: Db) => {
	const [unitRows, aliasRows] = await Promise.all([
		db.select().from(units).where(eq(units.baseUnitId, temperatureBaseUnitId)),
		db
			.select()
			.from(unitAliases)
			.where(
				and(eq(unitAliases.baseUnitId, temperatureBaseUnitId), isNull(unitAliases.sourceDomain))
			)
	]);
	const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
	const aliasToUnit = new Map<string, string>();
	for (const alias of aliasRows) {
		aliasToUnit.set(alias.alias, alias.unitId);
		aliasToUnit.set(normalizedAlias(alias.alias), alias.unitId);
	}
	const aliases = [...aliasToUnit.keys()].toSorted((left, right) => right.length - left.length);
	const pattern = aliases.length
		? new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${aliases.map(aliasPattern).join('|')})\\b`, 'giu')
		: null;
	return { unitById, aliasToUnit, pattern };
};

export const parseInstructionEvents = async (db: Db, text: string): Promise<InstructionEvent[]> => {
	const parser = await loadTemperatureParser(db);
	if (!parser.pattern) {
		return [];
	}
	const events: InstructionEvent[] = [];
	for (const match of text.matchAll(parser.pattern)) {
		const sourceText = match[0];
		const value = Number(match[1]);
		const rawUnit = match[2] ?? '';
		const unitId = parser.aliasToUnit.get(normalizedAlias(rawUnit));
		const unit = unitId ? parser.unitById.get(unitId) : undefined;
		if (!unit || !Number.isFinite(value)) {
			continue;
		}
		const event = {
			kind: 'temperature' as const,
			sourceText,
			value,
			unitId: unit.id,
			baseValue: sourceToBase(value, unit),
			baseUnitId: unit.baseUnitId,
			confidence: 0.9
		};
		events.push(event);
	}
	return events;
};

export const insertUserRecipeInstructionEvents = async (
	db: Db,
	instructions: UserInstruction[]
): Promise<void> => {
	for (const instruction of instructions) {
		const events = await parseInstructionEvents(db, instruction.text);
		if (!events.length) {
			continue;
		}
		await db.insert(userRecipeInstructionEvents).values(
			events.map((event) => ({
				userRecipeInstructionId: instruction.id,
				...event
			}))
		);
	}
};

export const insertHouseholdMealInstructionEvents = async (
	db: Db,
	instructions: MealInstruction[]
): Promise<void> => {
	for (const instruction of instructions) {
		const events = await parseInstructionEvents(db, instruction.text);
		if (!events.length) {
			continue;
		}
		await db.insert(householdMealInstructionEvents).values(
			events.map((event) => ({
				householdMealInstructionId: instruction.id,
				...event
			}))
		);
	}
};
