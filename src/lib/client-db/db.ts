import { browser } from '$app/environment';
import Dexie, { type EntityTable } from 'dexie';
import {
	clientDbName,
	clientDbSchemaVersion,
	clientDbStores,
	type CachedBillingEntitlement,
	type CachedFoodProfile,
	type CachedHousehold,
	type CachedHouseholdMember,
	type CachedMealCheckIn,
	type CachedMenuRoute,
	type CachedPlanRoute,
	type CachedPlannedMeal,
	type CachedRecipe,
	type ClientUser,
	type SyncCursor,
	type SyncOutboxEntry
} from './schema';

export class MaalClientDb extends Dexie {
	users!: EntityTable<ClientUser, 'id'>;
	households!: EntityTable<CachedHousehold, 'key'>;
	householdMembers!: EntityTable<CachedHouseholdMember, 'key'>;
	planRoutes!: EntityTable<CachedPlanRoute, 'key'>;
	menuRoutes!: EntityTable<CachedMenuRoute, 'key'>;
	recipes!: EntityTable<CachedRecipe, 'key'>;
	plannedMeals!: EntityTable<CachedPlannedMeal, 'key'>;
	mealCheckIns!: EntityTable<CachedMealCheckIn, 'key'>;
	foodProfiles!: EntityTable<CachedFoodProfile, 'key'>;
	billingEntitlements!: EntityTable<CachedBillingEntitlement, 'key'>;
	syncCursors!: EntityTable<SyncCursor, 'key'>;
	syncOutbox!: EntityTable<SyncOutboxEntry, 'id'>;

	constructor() {
		super(clientDbName);
		this.version(clientDbSchemaVersion).stores(clientDbStores);
	}
}

let db: MaalClientDb | null = null;

export const getClientDb = (): MaalClientDb | null => {
	if (!browser) return null;
	db ??= new MaalClientDb();
	return db;
};
