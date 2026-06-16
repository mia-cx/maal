/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const appCacheName = `maal-app-${version}`;
const runtimeCacheName = 'maal-runtime';
const cacheableStaticAssets = [...build, ...files];

const canUsePublicNavigationFallback = (url: URL): boolean =>
	url.pathname === '/' ||
	url.pathname === '/onboarding' ||
	url.pathname.startsWith('/legal/') ||
	url.pathname.startsWith('/demo/');

const cacheResponse = async (cacheName: string, request: Request, response: Response) => {
	if (!response.ok || response.type === 'opaque') return response;
	const cache = await caches.open(cacheName);
	await cache.put(request, response.clone());
	return response;
};

const cacheFirst = async (request: Request): Promise<Response> => {
	const cached = await caches.match(request);
	if (cached) return cached;
	return cacheResponse(appCacheName, request, await fetch(request));
};

const publicNavigationFallback = async (request: Request): Promise<Response> => {
	try {
		return await fetch(request);
	} catch {
		return (await caches.match('/')) ?? Response.error();
	}
};

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(appCacheName)
			.then((cache) => cache.addAll(cacheableStaticAssets))
			.then(() => worker.skipWaiting())
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((cacheNames) =>
				Promise.all(
					cacheNames
						.filter(
							(cacheName) =>
								(cacheName.startsWith('maal-app-') && cacheName !== appCacheName) ||
								cacheName === runtimeCacheName
						)
						.map((cacheName) => caches.delete(cacheName))
				)
			)
			.then(() => worker.clients.claim())
	);
});

worker.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== worker.location.origin) return;

	if (request.mode === 'navigate') {
		if (canUsePublicNavigationFallback(url)) event.respondWith(publicNavigationFallback(request));
		return;
	}

	if (cacheableStaticAssets.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
	}
});
