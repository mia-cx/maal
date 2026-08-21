const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
export const MAX_RECIPE_IMPORT_BYTES = 1_500_000;

const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

export class RecipeImportFetchError extends Error {
	readonly _tag = 'RecipeImportFetchError';
	constructor(
		readonly code:
			| 'invalid_url'
			| 'private_host'
			| 'too_many_redirects'
			| 'timeout'
			| 'response_too_large'
			| 'fetch_failed'
	) {
		super(code);
	}
}

const normalizedHostname = (hostname: string): string =>
	hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');

const parseIpv4 = (hostname: string): [number, number, number, number] | null => {
	const parts = hostname.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
	return octets as [number, number, number, number];
};

const publicIpv4 = ([a, b, c]: [number, number, number, number]): boolean => {
	if (a === 0 || a === 10 || a === 127) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && (b === 0 || b === 168 || b === 2)) return false;
	if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
	if (a === 203 && b === 0 && c === 113) return false;
	return a < 224;
};

const parseIpv6Groups = (hostname: string): number[] | null => {
	const halves = hostname.split('::');
	if (halves.length > 2) return null;
	const parse = (part: string): number | null =>
		/^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : null;
	const head = halves[0] ? halves[0].split(':').map(parse) : [];
	const tail = halves[1] ? halves[1].split(':').map(parse) : [];
	if ([...head, ...tail].some((value) => value === null)) return null;
	const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
	const groups = [...(head as number[]), ...Array<number>(missing).fill(0), ...(tail as number[])];
	return groups.length === 8 ? groups : null;
};

const publicIpv6 = (hostname: string): boolean => {
	const groups = parseIpv6Groups(hostname);
	if (!groups) return false;
	const [first = 0, second = 0] = groups;
	if (groups.every((group) => group === 0)) return false;
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false;
	if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return false;
	if ((first & 0xff00) === 0xff00 || (first === 0x2001 && second === 0x0db8)) return false;
	if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
		return publicIpv4([groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff]);
	}
	return true;
};

export const assertPublicRecipeUrl = (value: string, maxLength = 2_048): URL => {
	if (value.length > maxLength) throw new RecipeImportFetchError('invalid_url');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new RecipeImportFetchError('invalid_url');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new RecipeImportFetchError('invalid_url');
	}
	const hostname = normalizedHostname(url.hostname);
	if (
		!hostname ||
		hostname === 'localhost' ||
		blockedSuffixes.some((suffix) => hostname.endsWith(suffix))
	) {
		throw new RecipeImportFetchError('private_host');
	}
	const ipv4 = parseIpv4(hostname);
	if (ipv4 && !publicIpv4(ipv4)) throw new RecipeImportFetchError('private_host');
	if (hostname.includes(':') && !publicIpv6(hostname)) {
		throw new RecipeImportFetchError('private_host');
	}
	if (!ipv4 && !hostname.includes(':') && !hostname.includes('.')) {
		throw new RecipeImportFetchError('private_host');
	}
	return url;
};

const readLimitedText = async (response: Response, maxBytes: number): Promise<string> => {
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new RecipeImportFetchError('response_too_large');
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new RecipeImportFetchError('response_too_large');
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
};

export const fetchRecipePage = async (
	value: string,
	options: {
		fetcher?: typeof fetch;
		timeoutMs?: number;
		maxBytes?: number;
	} = {}
): Promise<{ html: string; finalUrl: string }> => {
	const fetcher = options.fetcher ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? MAX_RECIPE_IMPORT_BYTES;
	let url = assertPublicRecipeUrl(value);
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response;
		try {
			response = await fetcher(url, {
				redirect: 'manual',
				signal: controller.signal,
				headers: {
					accept: 'text/html,application/xhtml+xml',
					'user-agent': 'Maal recipe importer/1.0'
				}
			});
		} catch (cause) {
			if (cause instanceof RecipeImportFetchError) throw cause;
			if (controller.signal.aborted) throw new RecipeImportFetchError('timeout');
			throw new RecipeImportFetchError('fetch_failed');
		} finally {
			clearTimeout(timeout);
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) throw new RecipeImportFetchError('fetch_failed');
			if (redirects === MAX_REDIRECTS) {
				throw new RecipeImportFetchError('too_many_redirects');
			}
			url = assertPublicRecipeUrl(new URL(location, url).toString());
			continue;
		}
		if (!response.ok) throw new RecipeImportFetchError('fetch_failed');
		return { html: await readLimitedText(response, maxBytes), finalUrl: url.toString() };
	}
	throw new RecipeImportFetchError('too_many_redirects');
};
