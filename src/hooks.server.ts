import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import {
	authenticateSealedSession,
	clearSealedSession,
	readSealedSession
} from '$lib/server/auth/session';
import {
	commitHouseholdCookie,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { provisionAuthSession } from '$lib/server/auth/provisioning';
import { smokeAuthEnabled, smokeSession } from '$lib/server/auth/smoke';
import { tryCreateAuthRuntime } from '$lib/server/auth/workos';
import { firstAccessibleHouseholdId, hasHouseholdAccess } from '$lib/server/billing/entitlements';

const handleAuth: Handle = async ({ event, resolve }) => {
	event.locals.session = null;

	if (
		smokeAuthEnabled(event.platform) &&
		(event.request.headers.get('x-maal-smoke-auth') === '1' ||
			event.cookies.get('maal_smoke_auth') === '1')
	) {
		event.locals.session = smokeSession();
		await provisionAuthSession(event.platform, event.locals.session);
		return resolve(event);
	}

	if (!readSealedSession(event.cookies)) return resolve(event);

	const runtime = tryCreateAuthRuntime(event.platform);
	if (!runtime) {
		clearSealedSession(event.cookies);
		return resolve(event);
	}

	event.locals.session = await authenticateSealedSession({
		runtime,
		cookies: event.cookies,
		url: event.url
	});
	if (event.locals.session) await provisionAuthSession(event.platform, event.locals.session);

	return resolve(event);
};

const subscriptionExemptPath = (pathname: string): boolean =>
	pathname.startsWith('/auth') ||
	pathname.startsWith('/onboarding') ||
	pathname.startsWith('/subscribe') ||
	pathname.startsWith('/billing') ||
	pathname.startsWith('/export-data') ||
	pathname.startsWith('/demo');

const activeSubscribedHouseholdId = async (
	platform: App.Platform,
	session: NonNullable<App.Locals['session']>
): Promise<string | null> => {
	const households = await listUserHouseholds(platform, session.user.id).catch(() => []);
	return firstAccessibleHouseholdId({ platform, households });
};

const handleSubscriptionGate: Handle = async ({ event, resolve }) => {
	if (
		!event.locals.session ||
		event.request.method !== 'GET' ||
		subscriptionExemptPath(event.url.pathname) ||
		(!event.isDataRequest && !event.request.headers.get('accept')?.includes('text/html')) ||
		!event.platform?.env.DB
	) {
		return resolve(event);
	}

	const { householdId } = await resolveActiveHouseholdId({
		platform: event.platform,
		cookies: event.cookies,
		url: event.url,
		session: event.locals.session
	});
	if (!householdId) return resolve(event);

	const hasAccess = await hasHouseholdAccess({
		platform: event.platform,
		householdId
	});
	if (hasAccess) return resolve(event);

	const subscribedHouseholdId = await activeSubscribedHouseholdId(
		event.platform,
		event.locals.session
	);
	if (subscribedHouseholdId) {
		commitHouseholdCookie(event.cookies, subscribedHouseholdId, event.url);
		return resolve(event);
	}

	redirect(303, '/subscribe');
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

export const handle: Handle = sequence(handleAuth, handleSubscriptionGate, handleParaglide);
