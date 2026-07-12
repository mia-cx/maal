import { env as privateEnv } from '$env/dynamic/private';
import { WorkOS } from '@workos-inc/node';

export interface AuthRuntime {
	workos: WorkOS;
	apiKey: string;
	clientId: string;
	cookiePassword: string;
}

interface AuthEnv {
	WORKOS_API_KEY?: string;
	WORKOS_CLIENT_ID?: string;
	WORKOS_COOKIE_PASSWORD?: string;
}

const MIN_WORKOS_COOKIE_PASSWORD_LENGTH = 32;

const runtimeCache = new WeakMap<App.Platform['env'], AuthRuntime>();
let localRuntime: AuthRuntime | undefined;
let localRuntimeKey: string | undefined;

const readValue = (platformEnv: AuthEnv | undefined, key: keyof AuthEnv): string | undefined =>
	platformEnv?.[key] ?? privateEnv[key];

const readAuthEnv = (platformEnv?: App.Platform['env']): Required<AuthEnv> => {
	const apiKey = readValue(platformEnv, 'WORKOS_API_KEY');
	const clientId = readValue(platformEnv, 'WORKOS_CLIENT_ID');
	const cookiePassword = readValue(platformEnv, 'WORKOS_COOKIE_PASSWORD');

	if (!apiKey) throw new Error('WORKOS_API_KEY is not set');
	if (!clientId) throw new Error('WORKOS_CLIENT_ID is not set');
	if (!cookiePassword) throw new Error('WORKOS_COOKIE_PASSWORD is not set');
	if (cookiePassword.length < MIN_WORKOS_COOKIE_PASSWORD_LENGTH) {
		throw new Error(
			`WORKOS_COOKIE_PASSWORD must be at least ${MIN_WORKOS_COOKIE_PASSWORD_LENGTH} characters`
		);
	}

	return {
		WORKOS_API_KEY: apiKey,
		WORKOS_CLIENT_ID: clientId,
		WORKOS_COOKIE_PASSWORD: cookiePassword
	};
};

const createRuntime = (authEnv: Required<AuthEnv>): AuthRuntime => ({
	workos: new WorkOS({
		apiKey: authEnv.WORKOS_API_KEY,
		clientId: authEnv.WORKOS_CLIENT_ID
	}),
	apiKey: authEnv.WORKOS_API_KEY,
	clientId: authEnv.WORKOS_CLIENT_ID,
	cookiePassword: authEnv.WORKOS_COOKIE_PASSWORD
});

export const createAuthRuntime = (platform?: App.Platform): AuthRuntime => {
	if (platform?.env) {
		const cached = runtimeCache.get(platform.env);
		if (cached) return cached;

		const runtime = createRuntime(readAuthEnv(platform.env));
		runtimeCache.set(platform.env, runtime);
		return runtime;
	}

	const authEnv = readAuthEnv();
	const cacheKey = JSON.stringify([
		authEnv.WORKOS_API_KEY,
		authEnv.WORKOS_CLIENT_ID,
		authEnv.WORKOS_COOKIE_PASSWORD
	]);
	if (localRuntime && localRuntimeKey === cacheKey) return localRuntime;

	localRuntime = createRuntime(authEnv);
	localRuntimeKey = cacheKey;
	return localRuntime;
};

export const tryCreateAuthRuntime = (platform?: App.Platform): AuthRuntime | null => {
	try {
		return createAuthRuntime(platform);
	} catch {
		return null;
	}
};
