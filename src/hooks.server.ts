import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import {
	authenticateSealedSession,
	clearSealedSession,
	readSealedSession
} from '$lib/server/auth/session';
import { tryCreateAuthRuntime } from '$lib/server/auth/workos';

const handleAuth: Handle = async ({ event, resolve }) => {
	event.locals.session = null;

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

	return resolve(event);
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

export const handle: Handle = sequence(handleAuth, handleParaglide);
