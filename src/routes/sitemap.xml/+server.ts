import { alternatesFor } from '$lib/public-site';
import type { RequestHandler } from './$types';

const pageFiles = Object.keys(import.meta.glob('/src/routes/[(]public[)]/**/+page.svelte'));
const publicPaths = pageFiles.map((file) =>
	file.slice('/src/routes/(public)'.length, -'+page.svelte'.length)
);

export const GET: RequestHandler = () => {
	const urls = publicPaths.flatMap((path) => {
		const alternates = alternatesFor(path);
		const links = alternates
			.map(({ locale, url }) => `<xhtml:link rel="alternate" hreflang="${locale}" href="${url}" />`)
			.join('');
		return alternates
			.filter(({ locale }) => locale !== 'x-default')
			.map(({ url }) => `<url><loc>${url}</loc>${links}</url>`);
	});
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`,
		{ headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
	);
};
