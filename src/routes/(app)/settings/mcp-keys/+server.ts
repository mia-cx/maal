import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import {
	createMcpKey,
	listMcpKeys,
	MAAL_API_SCOPES,
	rerollMcpKey,
	revokeMcpKey,
	type MaalApiScope,
	type McpKeyHouseholdScope,
	type McpKeyPreset
} from '$lib/server/auth/mcp-keys';
import { listUserHouseholds } from '$lib/server/auth/household';
import { readJsonObject, isRecord } from '$lib/server/http/request';

const presets = new Set<McpKeyPreset>(['read_only_planner', 'meal_planner', 'full_access']);
const scopes = new Set<MaalApiScope>(MAAL_API_SCOPES);

const readHouseholdScope = async (
	platform: App.Platform | undefined,
	userId: string,
	value: unknown
): Promise<McpKeyHouseholdScope> => {
	if (!isRecord(value)) error(400, { message: 'Household scope is required.' });
	if (value.kind === 'all') return { kind: 'all' };
	if (value.kind !== 'households' || !Array.isArray(value.householdIds)) {
		error(400, { message: 'Choose one or more households, or all households.' });
	}
	const householdIds = [
		...new Set(value.householdIds.filter((id): id is string => typeof id === 'string'))
	];
	if (!householdIds.length) error(400, { message: 'Choose at least one household.' });
	const allowedHouseholdIds = new Set(
		(await listUserHouseholds(platform, userId)).map((household) => household.id)
	);
	if (householdIds.some((id) => !allowedHouseholdIds.has(id))) {
		error(403, { message: 'You can only scope MCP keys to your households.' });
	}
	return { kind: 'households', householdIds };
};

const readScopes = (value: unknown): MaalApiScope[] => {
	const selectedScopes = Array.isArray(value)
		? [
				...new Set(
					value.filter((scope): scope is MaalApiScope => scopes.has(scope as MaalApiScope))
				)
			]
		: [];
	if (!selectedScopes.length) error(400, { message: 'Choose at least one MCP key scope.' });
	return selectedScopes;
};

export const GET: RequestHandler = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	try {
		const [keys, households] = await Promise.all([
			listMcpKeys({ platform, userId: session.user.id }),
			listUserHouseholds(platform, session.user.id)
		]);
		return json({ keys, households });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error(cause);
		error(503, { message: 'MCP key storage is not available.' });
	}
};

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const body = await readJsonObject(request);

	const label = typeof body.label === 'string' ? body.label.trim() : '';
	if (label.length < 2) error(400, { message: 'Give this MCP key a label.' });
	if (label.length > 80) error(400, { message: 'Keep the MCP key label under 80 characters.' });

	const preset = presets.has(body.preset as McpKeyPreset)
		? (body.preset as McpKeyPreset)
		: undefined;
	try {
		const householdScope = await readHouseholdScope(platform, session.user.id, body.householdScope);
		const selectedScopes = readScopes(body.scopes);
		const created = await createMcpKey({
			platform,
			userId: session.user.id,
			label,
			householdScope,
			scopes: selectedScopes,
			preset
		});
		return json(created, { status: 201 });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error(cause);
		error(503, { message: 'MCP key storage is not available.' });
	}
};

export const PUT: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const body = await readJsonObject(request);
	const keyId = isRecord(body) && typeof body.keyId === 'string' ? body.keyId.trim() : '';
	if (!keyId) error(400, { message: 'MCP key is required.' });

	try {
		const rerolled = await rerollMcpKey({ platform, userId: session.user.id, keyId });
		if (!rerolled) error(404, { message: 'MCP key not found.' });
		return json(rerolled);
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error(cause);
		error(503, { message: 'MCP key storage is not available.' });
	}
};

export const DELETE: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const body = await readJsonObject(request);
	const keyId = isRecord(body) && typeof body.keyId === 'string' ? body.keyId.trim() : '';
	if (!keyId) error(400, { message: 'MCP key is required.' });

	try {
		const revoked = await revokeMcpKey({ platform, userId: session.user.id, keyId });
		if (!revoked) error(404, { message: 'MCP key not found.' });
		return json({ revoked: true });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error(cause);
		error(503, { message: 'MCP key storage is not available.' });
	}
};
