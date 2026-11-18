const TRACE_REQUEST_HEADER = 'x-maal-proof-trace';
const RUN_REQUEST_HEADER = 'x-maal-proof-run';
const D1_RESPONSE_HEADER = 'x-maal-proof-d1-opened';
const TRACE_LABEL = /^[-a-zA-Z0-9_.]{1,80}$/;
const D1_METHODS = new Set<PropertyKey>(['prepare', 'batch', 'exec', 'dump', 'withSession']);

/** The Workers Logs event name for one traced staging request. */
export const STAGING_PROOF_EVENT = 'staging_proof_request';

type StagingProofEnvironment = Env & { readonly MAAL_PROOF_TELEMETRY?: string };

export type FreeUseRouteClass = 'auth' | 'billing' | 'admin';

/**
 * The only remote calls free use may make. Every other Worker request, including page loads,
 * counts as a content route.
 */
const permittedFreeUseCalls: ReadonlyArray<{
	readonly method: string;
	readonly pattern: RegExp;
	readonly routeClass: FreeUseRouteClass;
}> = [
	{ method: 'GET', pattern: /^\/api\/auth-slots\/[^/]+\/$/, routeClass: 'auth' },
	{ method: 'POST', pattern: /^\/api\/auth-slots\/[^/]+\/refresh$/, routeClass: 'auth' },
	{ method: 'GET', pattern: /^\/api\/auth-slots\/[^/]+\/households\/[^/]+$/, routeClass: 'admin' },
	{ method: 'GET', pattern: /^\/api\/auth-slots\/[^/]+\/billing\/status$/, routeClass: 'billing' }
];

export const classifyPermittedFreeUseCall = (
	method: string,
	pathname: string
): FreeUseRouteClass | null =>
	permittedFreeUseCalls.find(
		(candidate) => candidate.method === method.toUpperCase() && candidate.pattern.test(pathname)
	)?.routeClass ?? null;

export interface StagingProofTelemetry {
	readonly environment: Env;
	readonly label: string;
	/** A per-run label that separates one proof run from earlier runs of the same deployment. */
	readonly run: string | null;
	readonly evidence: { d1Opened: boolean };
}

export const stagingProofTelemetry = (
	request: Request,
	environment: StagingProofEnvironment
): StagingProofTelemetry | null => {
	// A staging-only cookie also traces native navigations and application-generated requests.
	const cookieLabel = request.headers
		.get('cookie')
		?.match(/(?:^|;\s*)maal_proof_trace=([^;]*)/)?.[1];
	const label = request.headers.get(TRACE_REQUEST_HEADER) ?? cookieLabel ?? '';
	if (environment.MAAL_PROOF_TELEMETRY !== 'staging-only' || !TRACE_LABEL.test(label)) {
		return null;
	}
	const run = request.headers.get(RUN_REQUEST_HEADER);

	const evidence = { d1Opened: false };
	const database = new Proxy(environment.DB, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			return (...args: unknown[]) => {
				if (D1_METHODS.has(property)) evidence.d1Opened = true;
				return Reflect.apply(value, target, args);
			};
		}
	});
	return {
		environment: { ...environment, DB: database },
		label,
		run: run && TRACE_LABEL.test(run) ? run : null,
		evidence
	};
};

/**
 * The Workers Logs record for one traced request. It is logged as an object so Workers Logs
 * indexes each field, and it carries labels, the route class, and the D1 boolean only: no path,
 * header, or identifier.
 */
export const stagingProofLogEvent = (request: Request, telemetry: StagingProofTelemetry) => ({
	event: STAGING_PROOF_EVENT,
	proofLabel: telemetry.label,
	proofRun: telemetry.run,
	routeClass:
		classifyPermittedFreeUseCall(request.method, new URL(request.url).pathname) ?? 'content',
	d1Opened: telemetry.evidence.d1Opened
});

export const withStagingProofTelemetry = (
	response: Response,
	evidence: StagingProofTelemetry['evidence']
): Response => {
	const headers = new Headers(response.headers);
	headers.set(D1_RESPONSE_HEADER, String(evidence.d1Opened));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

export const readStagingProofD1Telemetry = (headers: Headers): boolean | null => {
	const value = headers.get(D1_RESPONSE_HEADER);
	if (value === 'true') return true;
	if (value === 'false') return false;
	return null;
};
