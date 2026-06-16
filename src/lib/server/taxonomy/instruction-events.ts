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
import { aliasPattern, normalizedAlias } from './aliases';

type Db = DrizzleD1Database<typeof schema>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type WritableDb = Db | Transaction;
type UnitRow = typeof units.$inferSelect;
export type InstructionEvent = {
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
type TemperatureParser = Awaited<ReturnType<typeof loadTemperatureParser>>;

const temperatureBaseUnitId = 'celsius';

const sourceToBase = (value: number, unit: UnitRow): number =>
	value * unit.toBaseFactor + unit.toBaseOffset;

const loadTemperatureParser = async (db: WritableDb) => {
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

const parseInstructionEventsWithParser = (
	parser: TemperatureParser,
	text: string
): InstructionEvent[] => {
	if (!parser.pattern) return [];
	const events: InstructionEvent[] = [];
	for (const match of text.matchAll(parser.pattern)) {
		const sourceText = match[0];
		const value = Number(match[1]);
		const rawUnit = match[2] ?? '';
		const unitId = parser.aliasToUnit.get(normalizedAlias(rawUnit));
		const unit = unitId ? parser.unitById.get(unitId) : undefined;
		if (!unit || !Number.isFinite(value)) continue;
		events.push({
			kind: 'temperature',
			sourceText,
			value,
			unitId: unit.id,
			baseValue: sourceToBase(value, unit),
			baseUnitId: unit.baseUnitId,
			confidence: 0.9
		});
	}
	return events;
};

export const parseInstructionEvents = async (
	db: WritableDb,
	text: string
): Promise<InstructionEvent[]> =>
	parseInstructionEventsWithParser(await loadTemperatureParser(db), text);

export type ParsedInstructionEvent = InstructionEvent & { instructionId: string };

type InsertInstructionEventsParams<TInstruction> = {
	db: WritableDb;
	instructions: TInstruction[];
	instructionId: (instruction: TInstruction) => string;
	instructionText: (instruction: TInstruction) => string;
	insert: (db: WritableDb, rows: ParsedInstructionEvent[]) => Promise<void>;
};

const hasTransaction = (db: WritableDb): db is Db => 'transaction' in db;

const instructionEventKey = (event: ParsedInstructionEvent): string =>
	[
		event.instructionId,
		event.kind,
		event.sourceText,
		event.value,
		event.unitId,
		event.baseValue,
		event.baseUnitId
	].join('\u001f');

export const uniqueInstructionEvents = (
	events: ParsedInstructionEvent[]
): ParsedInstructionEvent[] => {
	const result = new Map<string, ParsedInstructionEvent>();
	for (const event of events) {
		const key = instructionEventKey(event);
		if (!result.has(key)) result.set(key, event);
	}
	return [...result.values()];
};

const insertInstructionEvents = async <TInstruction>({
	db,
	instructions,
	instructionId,
	instructionText,
	insert
}: InsertInstructionEventsParams<TInstruction>): Promise<void> => {
	const parser = await loadTemperatureParser(db);
	const rows = uniqueInstructionEvents(
		instructions.flatMap((instruction) =>
			parseInstructionEventsWithParser(parser, instructionText(instruction)).map((event) => ({
				instructionId: instructionId(instruction),
				...event
			}))
		)
	);
	if (!rows.length) return;
	const write = (targetDb: WritableDb) => insert(targetDb, rows);
	if (hasTransaction(db)) {
		await db.transaction((tx) => write(tx));
		return;
	}
	await write(db);
};

export const insertUserRecipeInstructionEvents = async (
	db: WritableDb,
	instructions: UserInstruction[]
): Promise<void> => {
	await insertInstructionEvents({
		db,
		instructions,
		instructionId: (instruction) => instruction.id,
		instructionText: (instruction) => instruction.text,
		insert: async (targetDb, rows) => {
			await targetDb.insert(userRecipeInstructionEvents).values(
				rows.map(({ instructionId, ...event }) => ({
					userRecipeInstructionId: String(instructionId),
					...event
				}))
			);
		}
	});
};

export const insertHouseholdMealInstructionEvents = async (
	db: WritableDb,
	instructions: MealInstruction[]
): Promise<void> => {
	await insertInstructionEvents({
		db,
		instructions,
		instructionId: (instruction) => instruction.id,
		instructionText: (instruction) => instruction.text,
		insert: async (targetDb, rows) => {
			await targetDb.insert(householdMealInstructionEvents).values(
				rows.map(({ instructionId, ...event }) => ({
					householdMealInstructionId: String(instructionId),
					...event
				}))
			);
		}
	});
};
