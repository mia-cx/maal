/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

import { isServiceWorkerCommand } from '$lib/pwa/messages.js';

const worker = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `maal-shell-${version}`;
const ASSET_CACHE = `maal-assets-${version}`;
const OWNED_CACHE_PREFIXES = ['maal-shell-', 'maal-assets-'] as const;
const SHELL_URL = '/plan';
const immutableAssets = new Set(build);
const installAssets = [...new Set([...build, ...files, ...prerendered])];
const excludedPath =
	/^\/(?:api\/(?:auth|auth-slots|billing|households\/[^/]+\/invites|sync|recipes\/import|mcp)|mcp)(?:\/|$)/;

const absoluteRequest = (path: string): Request =>
	new Request(new URL(path, worker.location.origin), { credentials: 'same-origin' });

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const replacesActiveWorker = worker.registration.active !== null;
			const [assetCache, shellCache] = await Promise.all([
				caches.open(ASSET_CACHE),
				caches.open(SHELL_CACHE)
			]);
			await Promise.all([
				assetCache.addAll(installAssets.map(absoluteRequest)),
				shellCache.add(absoluteRequest(SHELL_URL))
			]);
			if (replacesActiveWorker) {
				const clients = await worker.clients.matchAll({
					type: 'window',
					includeUncontrolled: true
				});
				for (const client of clients) {
					client.postMessage({ type: 'UPDATE_WAITING', version, critical: false });
				}
			}
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(
				names
					.filter(
						(name) =>
							OWNED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
							name !== SHELL_CACHE &&
							name !== ASSET_CACHE
					)
					.map((name) => caches.delete(name))
			);
			await worker.clients.claim();
			const clients = await worker.clients.matchAll({ type: 'window' });
			for (const client of clients) client.postMessage({ type: 'SHELL_READY', version });
		})()
	);
});

worker.addEventListener('message', (event) => {
	if (!isServiceWorkerCommand(event.data)) return;
	if (event.data.type === 'GET_VERSION') {
		(event.source as Client | null)?.postMessage({
			type: 'UPDATE_WAITING',
			version,
			critical: false
		});
		return;
	}
	if (event.data.version === version) event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== worker.location.origin || excludedPath.test(url.pathname)) return;

	if (immutableAssets.has(url.pathname)) {
		event.respondWith(
			caches.open(ASSET_CACHE).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) await cache.put(request, response.clone());
				return response;
			})
		);
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					return await fetch(request);
				} catch {
					const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
					return cached ?? Response.error();
				}
			})()
		);
	}
});
