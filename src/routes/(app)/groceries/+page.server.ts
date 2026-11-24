import { error } from '@sveltejs/kit';

export const prerender = false;
export const ssr = true;
export const load = () => error(404, { message: 'Feature not available.' });
