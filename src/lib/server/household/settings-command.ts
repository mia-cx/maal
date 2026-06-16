import { createAuthRuntime } from '$lib/server/auth/workos';
import { jsonArrayFromForm, stringFromForm } from '$lib/domain/household/form-parsing';
import {
	defaultLocale,
	defaultTimezone,
	localeFromForm,
	maxHouseholdNameLength
} from '$lib/domain/household/settings-parsing';
import { profileUpdateFromForm } from '$lib/domain/household/profile-settings';
import { getDb } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import {
	upsertFoodDisplayOverride,
	upsertUnitDisplayOverride,
	type IngredientOverrideInput,
	type UnitOverrideInput
} from '$lib/server/taxonomy/display-overrides';

export type HouseholdSettingsUpdateResult =
	| { ok: true; message: string }
	| { ok: false; status: number; message: string };

type HouseholdSettingsDb = ReturnType<typeof getDb>;
type HouseholdSettingsTransaction = Parameters<
	Parameters<HouseholdSettingsDb['transaction']>[0]
>[0];

const isStringRecord = (value: unknown): value is Record<string, string> =>
	Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isUnitOverrideInput = (value: unknown): value is UnitOverrideInput =>
	isStringRecord(value) &&
	typeof value.baseUnit === 'string' &&
	typeof value.preferredUnitAlias === 'string';

const isIngredientOverrideInput = (value: unknown): value is IngredientOverrideInput =>
	isStringRecord(value) &&
	typeof value.baseFood === 'string' &&
	typeof value.preferredFoodAlias === 'string' &&
	typeof value.preferredMeasureUnit === 'string';

export const updateHouseholdSettingsFromForm = async ({
	platform,
	database,
	householdId,
	form
}: {
	platform: App.Platform;
	database: D1Database;
	householdId: string;
	form: FormData;
}): Promise<HouseholdSettingsUpdateResult> => {
	const parsedProfileUpdate = profileUpdateFromForm(form);
	if (!parsedProfileUpdate.ok)
		return { ok: false, status: 400, message: parsedProfileUpdate.message };
	const profileUpdate = parsedProfileUpdate.update;
	const dbUpdates: Array<(tx: HouseholdSettingsTransaction) => Promise<unknown>> = [];
	const workosUpdates: Array<() => Promise<unknown>> = [];

	if (form.has('name')) {
		const parsedName = stringFromForm(form.get('name'), 'Household name is required.');
		if (!parsedName.ok) return { ok: false, status: 400, message: parsedName.message };
		const name = parsedName.value;
		if (!name) return { ok: false, status: 400, message: 'Household name is required.' };
		if (name.length > maxHouseholdNameLength) {
			return { ok: false, status: 400, message: 'Household name is too long.' };
		}
		workosUpdates.push(() =>
			createAuthRuntime(platform).workos.organizations.updateOrganization({
				organization: householdId,
				name
			})
		);
	}

	if (
		form.has('preferredMassUnit') ||
		form.has('preferredVolumeUnit') ||
		form.has('preferredTemperatureUnit') ||
		form.has('unitOverrides') ||
		form.has('ingredientOverrides')
	) {
		const locale = localeFromForm(form.get('overrideLocale')) ?? defaultLocale;
		const preferredMassUnit = stringFromForm(
			form.get('preferredMassUnit') ?? '',
			'Mass unit must be text.'
		);
		const preferredVolumeUnit = stringFromForm(
			form.get('preferredVolumeUnit') ?? '',
			'Volume unit must be text.'
		);
		const preferredTemperatureUnit = stringFromForm(
			form.get('preferredTemperatureUnit') ?? '',
			'Temperature unit must be text.'
		);
		if (!preferredMassUnit.ok)
			return { ok: false, status: 400, message: preferredMassUnit.message };
		if (!preferredVolumeUnit.ok)
			return { ok: false, status: 400, message: preferredVolumeUnit.message };
		if (!preferredTemperatureUnit.ok)
			return { ok: false, status: 400, message: preferredTemperatureUnit.message };
		if (preferredMassUnit.value) {
			dbUpdates.push((tx) =>
				upsertUnitDisplayOverride({
					database,
					db: tx,
					householdId,
					locale,
					baseUnitId: 'grams',
					preferredUnitAlias: preferredMassUnit.value
				})
			);
		}
		if (preferredVolumeUnit.value) {
			dbUpdates.push((tx) =>
				upsertUnitDisplayOverride({
					database,
					db: tx,
					householdId,
					locale,
					baseUnitId: 'milliliters',
					preferredUnitAlias: preferredVolumeUnit.value
				})
			);
		}
		if (preferredTemperatureUnit.value) {
			dbUpdates.push((tx) =>
				upsertUnitDisplayOverride({
					database,
					db: tx,
					householdId,
					locale,
					baseUnitId: 'celsius',
					preferredUnitAlias: preferredTemperatureUnit.value
				})
			);
		}
		const unitOverrides = jsonArrayFromForm(
			form.get('unitOverrides'),
			'Unit overrides must be valid JSON rows.',
			isUnitOverrideInput
		);
		if (!unitOverrides.ok) return { ok: false, status: 400, message: unitOverrides.message };
		for (const row of unitOverrides.value) {
			const baseUnitId = row.baseUnit.trim();
			const preferredUnitAlias = row.preferredUnitAlias.trim();
			if (!baseUnitId || !preferredUnitAlias) {
				return { ok: false, status: 400, message: 'Unit override rows must include units.' };
			}
			dbUpdates.push((tx) =>
				upsertUnitDisplayOverride({
					database,
					db: tx,
					householdId,
					locale,
					baseUnitId,
					preferredUnitAlias
				})
			);
		}
		const ingredientOverrides = jsonArrayFromForm(
			form.get('ingredientOverrides'),
			'Ingredient overrides must be valid JSON rows.',
			isIngredientOverrideInput
		);
		if (!ingredientOverrides.ok)
			return { ok: false, status: 400, message: ingredientOverrides.message };
		for (const row of ingredientOverrides.value) {
			const trimmedRow = {
				...row,
				baseFood: row.baseFood.trim(),
				preferredFoodAlias: row.preferredFoodAlias.trim(),
				preferredMeasureUnit: row.preferredMeasureUnit.trim()
			};
			if (
				!trimmedRow.baseFood ||
				!trimmedRow.preferredFoodAlias ||
				!trimmedRow.preferredMeasureUnit
			) {
				return { ok: false, status: 400, message: 'Ingredient override rows must be complete.' };
			}
			dbUpdates.push((tx) =>
				upsertFoodDisplayOverride({ database, db: tx, householdId, locale, row: trimmedRow })
			);
		}
	}

	if (Object.keys(profileUpdate).length > 0) {
		dbUpdates.push((tx) =>
			tx
				.insert(households)
				.values({
					householdId,
					defaultPlannedYield: profileUpdate.defaultPlannedYield ?? 1,
					locale: profileUpdate.locale ?? defaultLocale,
					timezone: profileUpdate.timezone ?? defaultTimezone,
					weekStartsOn: profileUpdate.weekStartsOn ?? 1,
					preferredDinnerTime: profileUpdate.preferredDinnerTime ?? null
				})
				.onConflictDoUpdate({
					target: households.householdId,
					set: { ...profileUpdate, updatedAt: new Date().toISOString() }
				})
		);
	}

	if (dbUpdates.length === 0 && workosUpdates.length === 0)
		return { ok: true, message: 'No changes.' };
	if (dbUpdates.length > 0) {
		await getDb(database).transaction(async (tx) => {
			for (const update of dbUpdates) await update(tx);
		});
	}
	for (const update of workosUpdates) await update();
	return { ok: true, message: 'Household saved.' };
};
