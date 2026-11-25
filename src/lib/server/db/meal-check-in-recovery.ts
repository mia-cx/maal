export interface RecoverableMealCheckIn {
	readonly id: string;
	readonly householdId: string | null;
	readonly reporterUserId: string;
	readonly mealId: string | null;
	readonly cookTimeMinutes: number | null;
	readonly verdict: string;
	readonly reason: string | null;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly deletedAt: string | null;
	readonly recoveryReason: 'household_unresolved';
	readonly preservedAt: string;
}

interface RecoveryRow {
	id: string;
	household_id: string | null;
	reporter_user_id: string;
	meal_id: string | null;
	cook_time_minutes: number | null;
	verdict: string;
	reason: string | null;
	schema_version: number;
	revision: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	recovery_reason: 'household_unresolved';
	preserved_at: string;
}

const recordFromRow = (row: RecoveryRow): RecoverableMealCheckIn => ({
	id: row.id,
	householdId: row.household_id,
	reporterUserId: row.reporter_user_id,
	mealId: row.meal_id,
	cookTimeMinutes: row.cook_time_minutes,
	verdict: row.verdict,
	reason: row.reason,
	schemaVersion: row.schema_version,
	revision: row.revision,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	deletedAt: row.deleted_at,
	recoveryReason: row.recovery_reason,
	preservedAt: row.preserved_at
});

export const exportRecoverableMealCheckIns = async (
	database: D1Database,
	options: { readonly afterId?: string | null; readonly limit?: number } = {}
): Promise<{
	readonly schemaVersion: 1;
	readonly records: readonly RecoverableMealCheckIn[];
	readonly nextId: string | null;
}> => {
	const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
	const result = await database
		.prepare('SELECT * FROM meal_check_in_recovery WHERE id > ? ORDER BY id LIMIT ?')
		.bind(options.afterId ?? '', limit)
		.all<RecoveryRow>();
	const records = result.results.map(recordFromRow);
	return { schemaVersion: 1, records, nextId: records.at(-1)?.id ?? null };
};

export const restoreRecoverableMealCheckIn = async (
	database: D1Database,
	id: string,
	householdId: string
): Promise<boolean> => {
	const row = await database
		.prepare('SELECT * FROM meal_check_in_recovery WHERE id = ?')
		.bind(id)
		.first<RecoveryRow>();
	if (!row) return false;
	const household = await database
		.prepare('SELECT 1 AS present FROM households WHERE household_id = ?')
		.bind(householdId)
		.first<{ present: number }>();
	if (!household) throw new TypeError('The recovery household does not exist.');
	if (row.meal_id !== null) {
		const meal = await database
			.prepare('SELECT household_id FROM meals WHERE id = ?')
			.bind(row.meal_id)
			.first<{ household_id: string }>();
		if (!meal || meal.household_id !== householdId) {
			throw new TypeError('The recovery meal does not belong to that household.');
		}
	}
	await database.batch([
		database
			.prepare(
				`INSERT INTO meal_check_ins
				 (id, household_id, reporter_user_id, meal_id, cook_time_minutes, verdict, reason,
				  schema_version, revision, created_at, updated_at, deleted_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				row.id,
				householdId,
				row.reporter_user_id,
				row.meal_id,
				row.cook_time_minutes,
				row.verdict,
				row.reason,
				row.schema_version,
				row.revision,
				row.created_at,
				row.updated_at,
				row.deleted_at
			),
		database.prepare('DELETE FROM meal_check_in_recovery WHERE id = ?').bind(id)
	]);
	return true;
};
