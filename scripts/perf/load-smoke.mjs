#!/usr/bin/env node
import { chromium } from 'playwright';

const baseUrl = process.env.MAAL_PERF_BASE_URL ?? 'http://127.0.0.1:4173';
const routes = (process.env.MAAL_PERF_ROUTES ?? '/plan,/menu,/household,/settings')
	.split(',')
	.map((route) => route.trim())
	.filter(Boolean);
const outputJson = process.env.MAAL_PERF_JSON === '1';
const iterationInput = process.env.MAAL_PERF_ITERATIONS ?? '3';
const iterations = Number.parseInt(iterationInput, 10);
if (!/^\d+$/.test(iterationInput) || iterations < 1) {
	throw new Error('MAAL_PERF_ITERATIONS must be a positive integer');
}
const smokeHeaders = { 'x-maal-smoke-auth': '1' };

const percentile = (values, ratio) => {
	if (!values.length) return 0;
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
};

const summarize = (samples) => {
	const durations = samples.map((sample) => sample.durationMs);
	return {
		minMs: Math.round(Math.min(...durations)),
		p50Ms: Math.round(percentile(durations, 0.5)),
		p95Ms: Math.round(percentile(durations, 0.95)),
		maxMs: Math.round(Math.max(...durations))
	};
};

const measureNavigation = async (context, route) => {
	const page = await context.newPage();
	const consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => consoleErrors.push(error.message));

	const response = await page.goto(new URL(route, baseUrl).href, { waitUntil: 'networkidle' });
	const timing = await page.evaluate(() => {
		const [navigation] = performance.getEntriesByType('navigation');
		if (!(navigation instanceof PerformanceNavigationTiming)) return null;
		return {
			durationMs: navigation.duration,
			ttfbMs: navigation.responseStart - navigation.requestStart,
			domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
			loadEventMs: navigation.loadEventEnd - navigation.startTime,
			transferSize: navigation.transferSize,
			decodedBodySize: navigation.decodedBodySize
		};
	});
	const result = {
		route,
		finalUrl: page.url(),
		status: response?.status() ?? null,
		consoleErrors,
		...(timing ?? {})
	};
	await page.close();
	return result;
};

const measureCold = async (browser, route) => {
	const context = await browser.newContext({ extraHTTPHeaders: smokeHeaders });
	await context.clearCookies();
	const sample = await measureNavigation(context, route);
	await context.close();
	return sample;
};

const measureWarm = async (browser, route) => {
	const context = await browser.newContext({ extraHTTPHeaders: smokeHeaders });
	await measureNavigation(context, route);
	const sample = await measureNavigation(context, route);
	await context.close();
	return sample;
};

const browser = await chromium.launch();
const startedAt = new Date().toISOString();
const results = [];

try {
	for (const route of routes) {
		for (let index = 0; index < iterations; index += 1) {
			results.push({ mode: 'cold', iteration: index + 1, ...(await measureCold(browser, route)) });
			results.push({ mode: 'warm', iteration: index + 1, ...(await measureWarm(browser, route)) });
		}
	}
} finally {
	await browser.close();
}

const report = {
	startedAt,
	baseUrl,
	iterations,
	routes,
	results,
	summary: Object.fromEntries(
		routes.flatMap((route) =>
			['cold', 'warm'].map((mode) => {
				const samples = results.filter((result) => result.route === route && result.mode === mode);
				return [`${mode} ${route}`, summarize(samples)];
			})
		)
	)
};

const failures = results.filter(
	(result) => result.status !== 200 || result.consoleErrors.length > 0
);

if (outputJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`Maal load smoke (${startedAt}) against ${baseUrl}`);
	for (const [label, summary] of Object.entries(report.summary)) {
		console.log(
			`${label}: min=${summary.minMs}ms p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms`
		);
	}
	if (failures.length) {
		console.log('\nFailures:');
		for (const failure of failures) {
			console.log(
				`${failure.mode} ${failure.route} #${failure.iteration}: status=${failure.status} final=${failure.finalUrl} consoleErrors=${failure.consoleErrors.length}`
			);
		}
	}
}

if (failures.length) process.exitCode = 1;
