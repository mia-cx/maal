// The authenticated/local-first application is a client-side SPA. Public and legal routes can live in a
// separate route group and opt into prerendering without changing this boundary.
export const ssr = false;
export const prerender = true;
