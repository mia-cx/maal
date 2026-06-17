const recipeImportHeaders = {
	accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'accept-language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
	'user-agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
};

const maxRedirects = 3;
const requestTimeoutMs = 8_000;
const blockedHostnameSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

export type RecipeImportFetchRuntime = 'generic-server' | 'cloudflare-workers';

export type RecipeImportFetchOptions = {
	fetcher?: typeof fetch;
	maxUrlLength?: number;
	runtime?: RecipeImportFetchRuntime;
};

export class RecipeImportFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RecipeImportFetchError';
	}
}

const parseRecipeImportUrl = (url: string, maxUrlLength = 2048): URL => {
	if (url.length > maxUrlLength) throw new RecipeImportFetchError('Recipe URL is too long.');
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new RecipeImportFetchError('Invalid recipe URL.');
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new RecipeImportFetchError('Invalid recipe URL.');
	}
	assertPublicHostname(parsed.hostname);
	return parsed;
};

const normalizedHostname = (hostname: string): string =>
	hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');

const isIpLiteralHostname = (hostname: string): boolean => {
	const normalized = normalizedHostname(hostname);
	return parseIpv4(normalized) !== undefined || normalized.includes(':');
};

const assertRuntimeCanFetchHostname = (hostname: string, runtime: RecipeImportFetchRuntime) => {
	if (isIpLiteralHostname(hostname) || runtime === 'cloudflare-workers') return;
	throw new RecipeImportFetchError('Recipe URL host cannot be fetched safely in this runtime.');
};

const assertPublicHostname = (hostname: string) => {
	const normalized = normalizedHostname(hostname);
	if (!normalized) throw new RecipeImportFetchError('Invalid recipe URL.');
	if (
		normalized === 'localhost' ||
		blockedHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))
	) {
		throw new RecipeImportFetchError('Recipe URL must point to a public website.');
	}

	const ipv4 = parseIpv4(normalized);
	if (ipv4) {
		if (!isPublicIpv4(ipv4))
			throw new RecipeImportFetchError('Recipe URL must point to a public website.');
		return;
	}

	if (normalized.includes(':')) {
		if (!isPublicIpv6(normalized)) {
			throw new RecipeImportFetchError('Recipe URL must point to a public website.');
		}
		return;
	}

	if (!normalized.includes('.')) {
		throw new RecipeImportFetchError('Recipe URL must point to a public website.');
	}
};

const parseIpv4 = (hostname: string): [number, number, number, number] | undefined => {
	const octets = hostname.split('.');
	if (octets.length !== 4) return;
	const parsed = octets.map((octet) => (/^\d+$/.test(octet) ? Number(octet) : Number.NaN));
	if (parsed.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return;
	return parsed as [number, number, number, number];
};

const isPublicIpv4 = ([a, b, c]: [number, number, number, number]): boolean => {
	if (a === 0 || a === 10 || a === 127) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 192 && b === 0) return false;
	if (a === 192 && b === 2) return false;
	if (a === 198 && b === 51 && c === 100) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	if (a === 203 && b === 0 && c === 113) return false;
	if (a >= 224) return false;
	return true;
};

const parseIpv6Groups = (hostname: string): number[] | undefined => {
	const [head = '', tail = ''] = hostname.toLowerCase().split('::');
	if (hostname.split('::').length > 2) return;
	const headGroups = head ? head.split(':') : [];
	const tailGroups = tail ? tail.split(':') : [];
	const parseGroup = (group: string): number | undefined => {
		if (!/^[0-9a-f]{1,4}$/i.test(group)) return;
		return Number.parseInt(group, 16);
	};
	const parsedHead = headGroups.map(parseGroup);
	const parsedTail = tailGroups.map(parseGroup);
	if (parsedHead.some((group) => group === undefined)) return;
	if (parsedTail.some((group) => group === undefined)) return;
	const missingGroupCount = hostname.includes('::') ? 8 - parsedHead.length - parsedTail.length : 0;
	if (missingGroupCount < 0) return;
	const groups = [
		...(parsedHead as number[]),
		...Array.from({ length: missingGroupCount }, () => 0),
		...(parsedTail as number[])
	];
	return groups.length === 8 ? groups : undefined;
};

const ipv4FromMappedIpv6 = (groups: number[]): [number, number, number, number] | undefined => {
	if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return;
	return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
};

const isPublicIpv6 = (hostname: string): boolean => {
	const groups = parseIpv6Groups(hostname);
	if (!groups) return false;
	const [first, second] = groups;
	if (groups.every((group) => group === 0)) return false;
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false;
	if ((first & 0xfe00) === 0xfc00) return false;
	if ((first & 0xffc0) === 0xfe80) return false;
	if ((first & 0xff00) === 0xff00) return false;
	if (first === 0x2001 && second === 0x0db8) return false;
	const mappedIpv4 = ipv4FromMappedIpv6(groups);
	if (mappedIpv4) return isPublicIpv4(mappedIpv4);
	return true;
};

const readLimitedText = async (response: Response, maxBytes: number): Promise<string> => {
	const length = Number(response.headers.get('content-length'));
	if (Number.isFinite(length) && length > maxBytes) {
		throw new RecipeImportFetchError('Recipe page is too large.');
	}

	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).length > maxBytes) {
			throw new RecipeImportFetchError('Recipe page is too large.');
		}
		return text;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) throw new RecipeImportFetchError('Recipe page is too large.');
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
};

const fetchWithTimeout = async (url: URL, fetcher: typeof fetch): Promise<Response> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
	try {
		return await fetcher(url, {
			headers: recipeImportHeaders,
			redirect: 'manual',
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeout);
	}
};

export const fetchRecipeImportPage = async (
	url: string,
	maxBytes: number,
	{ fetcher = fetch, maxUrlLength, runtime = 'generic-server' }: RecipeImportFetchOptions = {}
): Promise<{ html: string; finalUrl: string }> => {
	let currentUrl = parseRecipeImportUrl(url, maxUrlLength);
	for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
		let response: Response;
		try {
			assertRuntimeCanFetchHostname(currentUrl.hostname, runtime);
			response = await fetchWithTimeout(currentUrl, fetcher);
		} catch (cause) {
			if (cause instanceof RecipeImportFetchError) throw cause;
			throw new RecipeImportFetchError('Could not fetch recipe page.');
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) throw new RecipeImportFetchError('Could not fetch recipe page.');
			currentUrl = parseRecipeImportUrl(new URL(location, currentUrl).toString(), maxUrlLength);
			continue;
		}

		if (!response.ok) {
			throw new RecipeImportFetchError(`Could not fetch recipe page: HTTP ${response.status}.`);
		}
		return { html: await readLimitedText(response, maxBytes), finalUrl: currentUrl.toString() };
	}
	throw new RecipeImportFetchError('Recipe page redirects too many times.');
};

export const assertRecipeImportUrlForTest = (url: string, maxUrlLength?: number): URL =>
	parseRecipeImportUrl(url, maxUrlLength);
