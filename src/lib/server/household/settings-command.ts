import { createAuthRuntime } from '$lib/server/auth/workos';
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

const parseJsonArray = <T>(value: FormDataEntryValue | null): T[] => {
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
};

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
	const updates: Promise<unknown>[] = [];

	if (form.has('name')) {
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { ok: false, status: 400, message: 'Household name is required.' };
		if (name.length > maxHouseholdNameLength) {
			return { ok: false, status: 400, message: 'Household name is too long.' };
		}
		updates.push(
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
		const preferredMassUnit = String(form.get('preferredMassUnit') ?? '').trim();
		const preferredVolumeUnit = String(form.get('preferredVolumeUnit') ?? '').trim();
		const preferredTemperatureUnit = String(form.get('preferredTemperatureUnit') ?? '').trim();
		if (preferredMassUnit) {
			updates.push(
				upsertUnitDisplayOverride({
					database,
					householdId,
					locale,
					baseUnitId: 'grams',
					preferredUnitAlias: preferredMassUnit
				})
			);
		}
		if (preferredVolumeUnit) {
			updates.push(
				upsertUnitDisplayOverride({
					database,
					householdId,
					locale,
					baseUnitId: 'milliliters',
					preferredUnitAlias: preferredVolumeUnit
				})
			);
		}
		if (preferredTemperatureUnit) {
			updates.push(
				upsertUnitDisplayOverride({
					database,
					householdId,
					locale,
					baseUnitId: 'celsius',
					preferredUnitAlias: preferredTemperatureUnit
				})
			);
		}
		for (const row of parseJsonArray<UnitOverrideInput>(form.get('unitOverrides'))) {
			if (!row.baseUnit || !row.preferredUnitAlias) continue;
			updates.push(
				upsertUnitDisplayOverride({
					database,
					householdId,
					locale,
					baseUnitId: row.baseUnit,
					preferredUnitAlias: row.preferredUnitAlias
				})
			);
		}
		for (const row of parseJsonArray<IngredientOverrideInput>(form.get('ingredientOverrides'))) {
			updates.push(upsertFoodDisplayOverride({ database, householdId, locale, row }));
		}
	}

	if (Object.keys(profileUpdate).length > 0) {
		updates.push(
			getDb(database)
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

	if (updates.length === 0) return { ok: true, message: 'No changes.' };
	await Promise.all(updates);
	return { ok: true, message: 'Household saved.' };
};
