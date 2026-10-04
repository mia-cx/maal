const TRACE_REQUEST_HEADER = 'x-maal-proof-trace';
const D1_RESPONSE_HEADER = 'x-maal-proof-d1-opened';
const TRACE_LABEL = /^[-a-zA-Z0-9_.]{1,80}$/;
const D1_METHODS = new Set<PropertyKey>(['prepare', 'batch', 'exec', 'dump', 'withSession']);

type StagingProofEnvironment = Env & { readonly MAAL_PROOF_TELEMETRY?: string };

export interface StagingProofTelemetry {
	readonly environment: Env;
	readonly label: string;
	readonly evidence: { d1Opened: boolean };
}

export const stagingProofTelemetry = (
	request: Request,
	environment: StagingProofEnvironment
): StagingProofTelemetry | null => {
	const pathname = new URL(request.url).pathname;
	const label = request.headers.get(TRACE_REQUEST_HEADER) ?? '';
	if (
		environment.MAAL_PROOF_TELEMETRY !== 'staging-only' ||
		(!pathname.startsWith('/api/') && pathname !== '/mcp') ||
		!TRACE_LABEL.test(label)
	) {
		return null;
	}

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
	return { environment: { ...environment, DB: database }, label, evidence };
};

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
