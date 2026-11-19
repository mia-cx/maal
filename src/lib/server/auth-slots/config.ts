import { createWorkOSAuthSlotAdapter, type AuthSlotServerConfig } from './adapter';

type AuthEnvironment = Partial<Record<keyof AuthSlotServerConfigMap, string>>;
type AuthSlotServerConfigMap = {
	WORKOS_API_KEY: string;
	WORKOS_CLIENT_ID: string;
	WORKOS_COOKIE_PASSWORD: string;
};

export function readAuthSlotConfig(environment?: unknown): AuthSlotServerConfig {
	const source = (environment ?? {}) as AuthEnvironment;
	const apiKey = source.WORKOS_API_KEY ?? process.env.WORKOS_API_KEY;
	const clientId = source.WORKOS_CLIENT_ID ?? process.env.WORKOS_CLIENT_ID;
	const cookiePassword = source.WORKOS_COOKIE_PASSWORD ?? process.env.WORKOS_COOKIE_PASSWORD;

	if (!apiKey || !clientId || !cookiePassword) {
		throw new AuthSlotConfigurationError();
	}
	if (cookiePassword.length < 32) {
		throw new AuthSlotConfigurationError(
			'WORKOS_COOKIE_PASSWORD must contain at least 32 characters'
		);
	}

	return { apiKey, clientId, cookiePassword };
}

export function authSlotAdapterFor(environment?: unknown) {
	return createWorkOSAuthSlotAdapter(readAuthSlotConfig(environment));
}

export class AuthSlotConfigurationError extends Error {
	readonly _tag = 'AuthSlotConfigurationError';

	constructor(message = 'WorkOS auth-slot configuration is missing') {
		super(message);
		this.name = 'AuthSlotConfigurationError';
	}
}
