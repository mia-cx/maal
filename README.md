# Maal

<a href="https://0rwx.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://0rwx.com/static/AI-W-dark.svg">
    <img alt="AI:W" src="https://0rwx.com/static/AI-W-light.svg" height="48">
  </picture>
</a>

Maal is a local-first meal planner and recipe library for households.
Keep recipes, plan meals, record cooking check-ins, and import or export your data as files.
The SvelteKit app stores data in your browser with Dexie and IndexedDB, so existing profiles work offline.
Creating a profile requires an initial WorkOS sign-in.

Local meal planning is free. A household subscription adds Cloudflare D1 sync, cross-device collaboration, and MCP access.
Stripe handles subscriptions. The configured staging host is [staging.maal.is](https://staging.maal.is).

The [local-first rewrite specification](docs/architecture/local-first-rewrite-spec.md) defines the product and architecture.
The [greenfield design](docs/architecture/greenfield-design.md) preserves the original rewrite plan.

## Local setup

Use Node.js 24 or newer and pnpm 10.34.5.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
```

Open the local URL printed by Vite, usually http://localhost:5173.
Migrations create a local D1 database under `.wrangler/state`; they do not need Cloudflare credentials.
The development server starts without secrets. Configure WorkOS to sign in and create a profile.

## Environment

Set local Worker values in `.dev.vars` at the repository root, using the names below.
Keep this file private and untracked. For deployed Workers, use Cloudflare secrets for the matching environment:

```sh
pnpm exec wrangler secret put WORKOS_API_KEY --env staging
```

Repeat for each required secret. Use `--env production` for production.
Non-secret deployed values can go in the matching environment's `vars` in `wrangler.jsonc`.

| Variable | Purpose |
| --- | --- |
| `WORKOS_API_KEY` | WorkOS API access for sign-in, household membership, and account maintenance. |
| `WORKOS_CLIENT_ID` | WorkOS application used by AuthKit. |
| `WORKOS_COOKIE_PASSWORD` | Seals session cookies. Use at least 32 characters. |
| `STRIPE_SECRET_KEY` | Stripe API access for billing. |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe events at `/api/billing/webhook`. |
| `STRIPE_PRODUCT_ID` | Stripe product for the household subscription. |
| `BILLING_MAINTENANCE_SECRET` | Bearer secret for `POST /api/billing/purge`. |

WorkOS and Stripe configuration readers also accept process environment variables.
Stripe prices set trial lengths. Stripe coupons and promotion codes apply discounts at Checkout.
The purge endpoint reads its maintenance secret from the Worker environment.
WorkOS handles the callback at `/api/auth/callback`; register its full URL in your WorkOS application.

`wrangler.jsonc` supplies the `DB`, `ASSETS`, and `RECIPE_URL_RATE_LIMIT` bindings.
It also sets `MAAL_PROOF_TELEMETRY=staging-only` for staging proof instrumentation.
The `.env.example` file includes credentials and metadata for remote deployment and proof scripts.
Those values are separate from local setup; the current Drizzle configuration uses a local SQLite schema.

## Checks

```sh
pnpm test:e2e:install
pnpm test:unit
pnpm test:e2e
pnpm lint
```

The unit suite includes headless Chromium tests. The end-to-end suite builds the app and starts a local Wrangler server.
`pnpm test` runs both suites. `pnpm check` checks Svelte and TypeScript.
`pnpm validate` runs lint, type checks, unit tests, the build, performance budgets, and end-to-end tests.
