import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import {
	joinHouseholdFromInvite,
	loadHouseholdInviteByCode,
	type HouseholdInvite
} from '$lib/server/auth/household-invites';

const inviteNotFound = { message: 'Invite not found.' };
const inviteStorageUnavailable = { message: 'Invite storage is not available.' };

const inviteCode = (code: string | undefined): string => {
	const trimmed = code?.trim() ?? '';
	if (!trimmed) error(404, inviteNotFound);
	return trimmed;
};

const inviteDatabase = (platform: App.Platform | undefined): D1Database => {
	const db = platform?.env?.DB;
	if (!db) error(503, inviteStorageUnavailable);
	return db;
};

const loadInvite = async (
	platform: App.Platform | undefined,
	code: string
): Promise<HouseholdInvite> => {
	const invite = await loadHouseholdInviteByCode(inviteDatabase(platform), code);
	if (!invite) error(404, inviteNotFound);
	return invite;
};

const loginLocation = (url: URL): string =>
	resolve(
		`/auth/login?screen_hint=sign-up&returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`
	);

const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const invitePreview = (invite: HouseholdInvite): Response =>
	new Response(
		`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Accept household invite · Maal</title>
	</head>
	<body>
		<main>
			<h1>Accept household invite</h1>
			<p>You have been invited to join household ${escapeHtml(invite.householdId)}.</p>
			<form method="post">
				<button type="submit">Accept invite</button>
			</form>
		</main>
	</body>
</html>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

export const GET: RequestHandler = async ({ locals, platform, url, params }) => {
	const code = inviteCode(params.code);
	const invite = await loadInvite(platform, code);

	if (!locals.session) redirect(303, loginLocation(url));

	return invitePreview(invite);
};

export const POST: RequestHandler = async ({ cookies, locals, platform, url, params }) => {
	const code = inviteCode(params.code);
	await loadInvite(platform, code);

	if (!locals.session) redirect(303, loginLocation(url));

	try {
		await joinHouseholdFromInvite({
			platform: platform as App.Platform,
			cookies,
			url,
			code,
			userId: locals.session.user.id
		});
	} catch (cause) {
		console.error('Failed to join household from invite', cause);
		error(502, { message: 'Could not join household.' });
	}

	redirect(303, '/plan?joined=1');
};
