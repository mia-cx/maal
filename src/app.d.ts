// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthSession, PublicAuthSession } from '$lib/server/auth/session';

declare global {
	interface Env {
		DB: D1Database;
		MCP_KEYS: KVNamespace;
		WORKOS_API_KEY: string;
		WORKOS_CLIENT_ID: string;
		WORKOS_COOKIE_PASSWORD: string;
		STRIPE_SECRET_KEY: string;
		PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
		STRIPE_WEBHOOK_SECRET?: string;
		STRIPE_DEFAULT_PRICE_ID?: string;
		STRIPE_PRICING_TABLE_ID?: string;
		STRIPE_PRODUCT_ID?: string;
		MAAL_SMOKE_AUTH_ENABLED?: string;
	}

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			session: AuthSession | null;
		}

		interface PageData {
			session: PublicAuthSession | null;
		}

		// interface Error {}
		// interface PageState {}
	}
}

export {};
