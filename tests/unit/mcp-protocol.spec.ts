import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Server } from '@modelcontextprotocol/server';
import { describe, expect, test } from 'vitest';

import type { MealAggregate, MealCheckIn } from '$lib/domain/meals/schema.js';
import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
import type { UserFoodPreference } from '$lib/domain/taxonomy/schema.js';
import type {
	RemoteDomainPort,
	RemoteFoodProfile,
	RemoteHouseholdSummary
} from '$lib/server/domain/remote-port.js';
import { MAAL_API_SCOPES, createMaalMcpHandler, tools } from '$lib/server/mcp/index.js';

const householdId = 'org_family';
const privateArgument = 'https://private.example/recipe?token=do-not-echo';

class ProtocolDomain implements RemoteDomainPort {
	readonly meals: MealAggregate[] = [];

	async listHouseholds(): Promise<readonly RemoteHouseholdSummary[]> {
		return [{ id: householdId, name: 'Family', locale: 'en-US', timezone: 'Europe/Amsterdam' }];
	}
	async listUserRecipes(): Promise<readonly RecipeAggregate[]> {
		return [];
	}
	async getUserRecipe(): Promise<RecipeAggregate | null> {
		return null;
	}
	async writeUserRecipe(input: { aggregate: RecipeAggregate }): Promise<RecipeAggregate> {
		return input.aggregate;
	}
	async listHouseholdMeals(): Promise<readonly MealAggregate[]> {
		return this.meals;
	}
	async getHouseholdMeal(_householdId: string, mealId: string): Promise<MealAggregate | null> {
		return this.meals.find(({ id }) => id === mealId) ?? null;
	}
	async writeHouseholdMeal(input: { aggregate: MealAggregate }): Promise<MealAggregate> {
		this.meals.push(input.aggregate);
		return input.aggregate;
	}
	async getMealCheckIn(): Promise<MealCheckIn | null> {
		return null;
	}
	async writeMealCheckIn(input: { aggregate: MealCheckIn }): Promise<MealCheckIn> {
		return input.aggregate;
	}
	async listMealCheckIns(): Promise<readonly MealCheckIn[]> {
		return [];
	}
	async getUserFoodProfile(): Promise<RemoteFoodProfile> {
		return {
			foodUserAliases: [],
			foodUserEntries: [],
			unitUserAliases: [],
			unitUserEntries: [],
			userFoodPreferences: [],
			userFoodDisplayPreferences: [],
			userUnitDisplayPreferences: []
		};
	}
	async writeUserFoodPreference(input: {
		aggregate: UserFoodPreference;
	}): Promise<UserFoodPreference> {
		return input.aggregate;
	}
}

const principal = {
	keyId: 'key_test',
	ownerUserId: 'user_alice',
	scopes: MAAL_API_SCOPES,
	effectiveHouseholds: [
		{
			householdId,
			householdName: 'Family',
			membershipId: 'membership_alice',
			roleSlug: 'admin',
			permissions: MAAL_API_SCOPES
		}
	],
	authenticatedAt: '2026-08-22T12:00:00.000Z'
} as const;

const runClient = async (mode: 'modern' | 'legacy') => {
	const domain = new ProtocolDomain();
	const servers: Server[] = [];
	const requests: Request[] = [];
	const sessionHeaders: Array<string | null> = [];
	const eras: Array<'modern' | 'legacy'> = [];
	const handler = createMaalMcpHandler({
		principal,
		domain,
		limiter: { limit: async () => ({ success: true }) },
		administration: {
			createInvite: async () => ({ code: 'INVITECODE12', invite: {} as never }),
			revokeInvite: async () => ({}) as never,
			updateMemberRole: async () => ({}) as never,
			removeMember: async () => undefined
		},
		onServerCreated: (server, era) => {
			servers.push(server);
			eras.push(era);
		}
	});
	const transport = new StreamableHTTPClientTransport(new URL('https://maal.test/mcp'), {
		fetch: async (input, init) => {
			const incoming =
				input instanceof Request ? new Request(input, init) : new Request(input, init);
			const headers = new Headers(incoming.headers);
			headers.set('host', new URL(incoming.url).host);
			const request = new Request(incoming, { headers });
			requests.push(request);
			const response = await handler.fetch(request);
			sessionHeaders.push(response.headers.get('mcp-session-id'));
			return response;
		}
	});
	const client = new Client(
		{ name: `${mode}-proof`, version: '1.0.0' },
		mode === 'modern' ? { versionNegotiation: { mode: 'auto' } } : undefined
	);
	await client.connect(transport);
	const listed = await client.listTools();
	const read = await client.callTool({ name: 'list_user_households', arguments: {} });
	const write = await client.callTool({
		name: 'create_household_meal',
		arguments: {
			householdId,
			customMeal: { title: `${mode} soup`, ingredients: ['water'], instructions: ['Simmer.'] },
			date: '2026-08-23'
		}
	});
	const safeError = await client.callTool({
		name: 'create_household_meal',
		arguments: {
			householdId,
			url: privateArgument,
			userRecipeId: 'recipe_conflicting_source'
		}
	});
	await client.close();
	return {
		domain,
		servers,
		requests,
		sessionHeaders,
		eras,
		listed,
		read,
		write,
		safeError,
		handler
	};
};

describe('stateless SDK-v2 MCP protocol', () => {
	test.each(['modern', 'legacy'] as const)(
		'connects a %s SDK-v2 client, lists tools, and calls read/write tools',
		async (mode) => {
			const result = await runClient(mode);
			expect(result.listed.tools.map(({ name }) => name)).toEqual(tools.map(({ name }) => name));
			expect(result.read.structuredContent).toMatchObject({
				households: [{ id: householdId, name: 'Family' }]
			});
			expect(result.write.structuredContent).toMatchObject({
				meal: { householdId, title: `${mode} soup`, date: '2026-08-23' }
			});
			expect(result.domain.meals).toHaveLength(1);
			expect(result.safeError.isError).toBe(true);
			expect(JSON.stringify(result.safeError)).not.toContain(privateArgument);
			expect(result.eras).toContain(mode);
			expect(result.sessionHeaders.every((value) => value === null)).toBe(true);
			const posts = result.requests.filter(({ method }) => method === 'POST');
			expect(result.servers).toHaveLength(posts.length);
			expect(new Set(result.servers).size).toBe(result.servers.length);
		}
	);

	test('does not expose protocol GET or DELETE routes', async () => {
		const result = await runClient('modern');
		for (const method of ['GET', 'DELETE']) {
			const response = await result.handler.fetch(
				new Request('https://maal.test/mcp', { method, headers: { host: 'maal.test' } })
			);
			expect(response.status).toBe(405);
		}
	});
});
