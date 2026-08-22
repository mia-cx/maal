# Staging cutover and release proof

Status: **the live run requires #83's stable callback contract to be in the candidate.** Do not call the
staging candidate release-ready until that dependency is present and the live proof passes. Native Safari
and Android retained-slot evidence remains tracked separately in #70.

This runbook updates the existing `maal-staging` Worker and D1 database, connects WorkOS staging and a Stripe
test sandbox, runs disposable release proofs, and removes every proof fixture. It never requires a real user,
live Stripe object, or production provider key.

## Safety contract

- Run commands from a clean checkout of the candidate commit. Never substitute the production hostname,
  production D1 name, a WorkOS production key, or a Stripe live key.
- Keep the temporary Wrangler copy, operator environment, raw provider output, fixture ledger, and proof
  evidence outside Git. The harness rejects the production Maal hostname, any Stripe key other than
  `sk_test_`, any WorkOS key other than `sk_test_`, and a Wrangler file tracked by Git.
- Use a fresh private fixture-ledger path for every run. The runtime creates it once with mode `0600` and only
  removes it after WorkOS, Stripe, and D1 report zero remaining fixtures.
- The output evidence is allowlisted. It contains pass/fail facts, counts, UTC times, and a non-secret
  deployment label—never cookies, sessions, tokens, passwords, emails, provider IDs, database IDs, or raw
  provider errors.
- `proof:staging live` creates and removes disposable objects. The rewrite-launch D1 reset is a separate,
  destructive operator action. `preflight`, `contracts`, build, dry-run deploy, migration list, D1 info,
  export, and read-only queries do not mutate remote state.

## Stable WorkOS callback contract

The candidate must ask WorkOS to redirect every profile login to this one registered URI:

```text
https://<staging-origin>/api/auth/callback
```

The slot stays in authenticated, tamper-resistant flow state and must never appear in the redirect URI. WorkOS
requires the authorization request's redirect URI to match a configured redirect URI; its wildcard support
does not make arbitrary path segments configurable. Source:
[WorkOS Get authorization URL — Redirect URI and Wildcards](https://workos.com/docs/reference/authkit/authentication/get-authorization-url).
The hosted and deployed proofs assert the exact URI and fail if `auth-slots` or a slot appears in its path.

## 1. Inspect D1 and prepare the private Wrangler file

Authenticate Wrangler with the `mia.cx` Cloudflare account. Inspect the existing staging database before any
mutation. Do not create another database:

```sh
pnpm exec wrangler whoami
pnpm exec wrangler d1 info maal-staging --config wrangler.jsonc --env staging
```

Keep the raw command output in the private change record. Do not attach its account or database ID to public
evidence. Copy `wrangler.jsonc` to `.wrangler/staging-proof.jsonc` without changing the D1 binding or ID. Keep
these committed contracts unchanged:

- Worker/environment name: `maal-staging`
- D1 binding/name: `DB` / `maal-staging`
- migration directory: `drizzle`
- rate-limit binding: `RECIPE_URL_RATE_LIMIT`
- cron: `17 3 * * *` (03:17 UTC)
- assets directory: `.svelte-kit/cloudflare`
- observability enabled, logs at `1`, traces at `0.01`
- staging-only non-secret var: `MAAL_PROOF_TELEMETRY=staging-only` (omit it from production)

Confirm the private file is ignored and inspect the resolved staging configuration without publishing it:

```sh
git check-ignore --quiet .wrangler/staging-proof.jsonc
pnpm exec wrangler deploy --dry-run --config .wrangler/staging-proof.jsonc --env staging
```

Run the local schema contract. Inspect unapplied remote migrations. Export the current schema and record the
current Time Travel bookmark in the private change record. The export and generated reset file must use fresh,
absolute paths outside the repository:

```sh
pnpm test:d1-schema
pnpm exec wrangler d1 migrations list maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler d1 time-travel info maal-staging --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler d1 export maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging --no-data --output=/absolute/private/path/maal-staging-before-rewrite.sql
node scripts/generate-d1-reset-sql.mjs maal-staging /absolute/private/path/maal-staging-before-rewrite.sql /absolute/private/path/maal-staging-reset.sql
```

Review both private SQL files. The generated file must drop every exported application table, view, and
`d1_migrations`, while leaving `sqlite_*` and `_cf_*` internal objects alone. Stop staging traffic and Stripe
webhook delivery before the reset. Then require the operator to type the database-specific phrase exactly:

```sh
printf '%s\n' 'Type exactly: RESET maal-staging FOR REWRITE LAUNCH'
read -r MAAL_RESET_CONFIRMATION
test "$MAAL_RESET_CONFIRMATION" = 'RESET maal-staging FOR REWRITE LAUNCH' || { unset MAAL_RESET_CONFIRMATION; printf '%s\n' 'Reset cancelled.' >&2; exit 1; }
unset MAAL_RESET_CONFIRMATION
```

Do not continue if that check exits nonzero. Execute the reviewed reset file only after the bookmark, export,
traffic pause, and confirmation are recorded:

```sh
pnpm exec wrangler d1 execute maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging --file=/absolute/private/path/maal-staging-reset.sql
pnpm exec wrangler d1 execute maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging --command "SELECT COUNT(*) AS application_objects FROM sqlite_schema WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" --json
```

`application_objects` must equal `0`. A missing table, stale `d1_migrations` row, or any other nonzero result
blocks the launch. Apply the two-file fresh chain only to that verified empty database:

```sh
pnpm exec wrangler d1 migrations apply maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler d1 migrations list maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler d1 execute maal-staging --remote --config .wrangler/staging-proof.jsonc --env staging --command "SELECT name FROM d1_migrations ORDER BY id; SELECT (SELECT COUNT(*) FROM units) AS units, (SELECT COUNT(*) FROM unit_aliases) AS unit_aliases, (SELECT COUNT(*) FROM foods) AS foods, (SELECT COUNT(*) FROM food_aliases) AS food_aliases" --json
```

The migration list must be empty afterward. `d1_migrations` must contain only
`0000_rewrite_baseline.sql` and `0001_global_taxonomy_seed.sql`. The seed counts must be `40` units, `184`
unit aliases, and the intentionally empty current global food sets at `0` and `0`. Do not attach raw D1 output
to a public issue because it can contain infrastructure metadata. D1 records applied files in
`d1_migrations`. See [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), and
[D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

This destructive reset happens once for the rewrite launch. Every later schema version uses generated,
forward-only migrations against `maal-staging` in place. Never reset it for a routine release, create a
versioned replacement D1, or copy the complete database for an application version.

## 2. Configure WorkOS staging

In the WorkOS **staging** environment:

1. Select the Maal web application and retain its staging Client ID/API key.
2. Configure the staging origin as the application/homepage origin.
3. Register exactly `https://<staging-origin>/api/auth/callback` and make it the default redirect. Do not
   register per-slot callbacks.
4. Confirm the `admin`, `member`, and `child` organization roles exist. The staging proof creator uses `admin`,
   which must have all ten Maal permissions: `households`, `recipes`, `meals`, `check_ins`, and `food_profile`,
   each with `read` and `write`. Verify the intended member/child mapping against the product role policy.
5. Confirm hosted AuthKit password login is enabled. Passkeys are not a v1 gate.

WorkOS staging and production have separate keys, users, organizations, redirects, webhooks, and branding;
none are promoted automatically. See [WorkOS environments](https://workos.com/docs/authkit/environments).

## 3. Configure the Stripe test catalog and webhook

In a Stripe sandbox/test mode, create one active Product named `Maal`. Create exactly three active,
per-unit, licensed recurring Prices on it, using the desired currency and amounts:

| Interval | Lookup key        |
| -------- | ----------------- |
| week     | `maal_weekly_v1`  |
| month    | `maal_monthly_v1` |
| year     | `maal_yearly_v1`  |

All three prices grant the same Maal capability. Trial length is application configuration
(`MAAL_TRIAL_DAYS`, default `30`), not another product or tier. D1's Stripe webhook projection is canonical;
do not make a WorkOS entitlement a v1 correctness dependency. Stripe documents multiple prices and stable
lookup keys in [Manage products and prices](https://docs.stripe.com/products-prices/manage-prices).

Create one **test-mode** webhook endpoint at:

```text
https://<staging-origin>/api/billing/webhook
```

Subscribe only to the events the Worker handles:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
```

Retain the endpoint's test `whsec_` secret. Stripe can duplicate events and does not guarantee delivery order;
the D1 projection uses event IDs for idempotency and event creation time to reject stale projections. See
[Stripe webhooks](https://docs.stripe.com/webhooks?lang=node) and
[Stripe Billing testing](https://docs.stripe.com/billing/testing).

## 4. Install Worker secrets and deploy

Generate independent high-entropy values for `WORKOS_COOKIE_PASSWORD` (at least 32 characters) and
`BILLING_MAINTENANCE_SECRET`. Put the following values into the staging Worker interactively; never add them
to `vars` or paste them into a command line:

```text
WORKOS_API_KEY
WORKOS_CLIENT_ID
WORKOS_COOKIE_PASSWORD
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRODUCT_ID
MAAL_TRIAL_DAYS
BILLING_MAINTENANCE_SECRET
```

Repeat this command for each name, supplying the value only at Wrangler's prompt:

```sh
pnpm exec wrangler secret put <NAME> --config .wrangler/staging-proof.jsonc --env staging
```

Build first, dry-run the exact artifact, then deploy the staging environment:

```sh
pnpm build
pnpm exec wrangler deploy --dry-run --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler deploy --config .wrangler/staging-proof.jsonc --env staging
pnpm exec wrangler deployments list --config .wrangler/staging-proof.jsonc --env staging
```

Record the candidate commit, deployment label, active Worker version, D1 Time Travel bookmark, WorkOS mode
(`staging`), and Stripe mode (`test`) in the private change record. Never record their IDs in GitHub.

## 5. Observe the candidate

Cloudflare Cron Triggers run in UTC and can take up to 15 minutes to propagate. The deployed configuration
must show `17 3 * * *`; do not create a second dashboard-managed trigger. See
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Open a JSON log tail during smoke/proof traffic:

```sh
pnpm exec wrangler tail maal-staging --format json --config .wrangler/staging-proof.jsonc --env staging
```

Expected maintenance records are `maintenance_completed` with non-negative counts. Any
`maintenance_failed`, uncaught exception, webhook signature error, D1 error, WorkOS error, or sustained 5xx
rate blocks the cutover. Check Workers Logs and traces for the proof window, D1 query/error telemetry, Stripe
webhook deliveries/retries, and WorkOS API errors. Do not copy request headers, cookies, raw webhook bodies,
or provider objects into evidence. Wrangler configuration is the source of truth for observability and
triggers; see [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

For the free-use gate, the staging-only Worker probe marks every proof API response with whether its D1 binding
was opened and emits `staging_proof_request` with only the deployment label and that boolean. The browser
requires this telemetry on every same-origin API/MCP call. Only explicit billing-status and household-admin
calls may open D1; auth calls must not, and any content call fails even if it did not open D1. Correlate the
same label and UTC window in Workers Logs/traces. Do not export raw logs, URLs, account IDs, database IDs, or
request headers. Production must not define `MAAL_PROOF_TELEMETRY`.

## 6. Run the guarded proof

Load the following values from a private mode-`0600` operator environment outside the repository. The proof
needs the same staging/test provider values to create and verify disposable fixtures. Do not echo the file or
run with shell tracing enabled.

```text
MAAL_STAGING_PROOF_CONFIRM=create-and-remove-disposable-staging-fixtures
MAAL_STAGING_BASE_URL=https://<staging-origin>
MAAL_STAGING_DEPLOYMENT_LABEL=<non-secret-candidate-label>
MAAL_STAGING_DATABASE_NAME=maal-staging
MAAL_STAGING_WRANGLER_CONFIG=.wrangler/staging-proof.jsonc
MAAL_STAGING_FIXTURE_FILE=/absolute/private/path/maal-staging-fixtures.json
MAAL_STAGING_EVIDENCE_FILE=/absolute/private/path/maal-staging-evidence.json
WORKOS_API_KEY=<WorkOS-staging-key>
WORKOS_CLIENT_ID=<WorkOS-staging-client>
WORKOS_COOKIE_PASSWORD=<staging-cookie-key>
STRIPE_SECRET_KEY=<Stripe-test-key>
STRIPE_WEBHOOK_SECRET=<Stripe-test-endpoint-secret>
STRIPE_PRODUCT_ID=<Stripe-test-Maal-product>
BILLING_MAINTENANCE_SECRET=<staging-maintenance-secret>
```

Run in order:

```sh
pnpm proof:staging preflight
pnpm proof:staging contracts
pnpm proof:staging live
```

Run the live command only from a candidate containing #83. It asserts the exact stable callback before creating
fixtures and fails closed while attempting provider cleanup. Do not waive or hand-edit the result.

The gates prove:

- direct WorkOS, hosted AuthKit, and deployed retained-slot behavior using existing auth proofs;
- one Product/three Prices, trial, cash refund, WorkOS organization metadata, and provider cleanup using the
  existing billing-service proof;
- deployed duplicate/out-of-order webhooks, 30-day grace, paid sync/D1 convergence, lapse denial, resubscribe
  recovery, read-only MCP denial, stateless MCP discovery/write, key revocation on the next request, household
  deletion/recovery, retention purge, and zero-remnant cleanup;
- a local-only recipe created offline and reopened online while every same-origin API/MCP call is checked
  against an explicit auth/billing/admin allowlist and operator-correlated Cloudflare telemetry reports zero D1
  opens;
- focused unit contracts plus the complete D1 migration/schema contract.

MCP uses the stateless `2026-07-28` request model and `server/discover`; the current protocol removes transport
sessions and makes each HTTP request self-contained. See the
[MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

## 7. Cleanup and evidence

Successful proof output must report all booleans true and all remnant counts zero. Confirm separately:

- the disposable WorkOS user and organization no longer resolve;
- the disposable Stripe customer is deleted, its subscriptions are canceled, Checkout sessions are expired,
  disposable catalog objects are inactive/detached, and the immutable successful test refund remains only as
  the provider's financial audit artifact;
- D1 has no proof user, trial claim, household, billing/audit/deletion row, asynchronous or forged Stripe event,
  MCP key, sync change/scope/version/tombstone/receipt/device row, or domain aggregate tied to the private
  fixture IDs.

The harness performs and verifies those checks. If it reports an interrupted cleanup, keep the private ledger
and rerun:

```sh
pnpm proof:staging:cleanup
```

Do not delete the ledger manually until cleanup passes. If provider cleanup cannot be completed, stop the
cutover and give the private ledger—not its contents—to an authorized operator. Store only the sanitized
evidence file with the release record. Remove the private operator environment, fixture ledger, raw logs, and
temporary Wrangler file when the staging investigation is over.

## 8. Rollback-forward

Prefer a new compatible Worker deployment and a forward-only corrective D1 migration. Never edit or delete an
already-applied migration. If only Worker code is bad and the schema remains backward-compatible, immediately
activate the previous version:

```sh
pnpm exec wrangler rollback --config .wrangler/staging-proof.jsonc --env staging
```

Then fix forward, rebuild, dry-run, deploy, and rerun all gates. Cloudflare notes that Worker rollback creates
a new active deployment immediately; see [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

D1 Time Travel restore is destructive, overwrites the database, and cancels in-flight queries. Use it only
after stopping staging traffic and Stripe webhook delivery, recording the current bookmark, and confirming a
forward migration cannot recover the data. Restore the pre-migration bookmark interactively, deploy code
compatible with that restored schema, resume provider delivery, and rerun the migration and complete proof.
The restore command returns a bookmark that can undo the restore; retain both in the private incident record.

## 9. Production handoff

Production keeps separate provider objects from staging and uses the existing `maal` Worker and `maal-prod` D1:

1. Confirm #83's stable WorkOS callback is deployed and obtain a fully passing sanitized staging proof.
2. Copy the tracked config to an ignored production cutover file. Confirm it resolves Worker `maal` and D1
   `maal-prod`. Keep raw resource IDs only in the private operations record.
3. Stop production traffic, scheduled work, and Stripe webhook delivery. Inspect the database, capture its
   Time Travel bookmark, export its schema, and generate the private reset file:

   ```sh
   pnpm exec wrangler d1 info maal-prod --config .wrangler/production-cutover.jsonc --env production
   pnpm exec wrangler d1 migrations list maal-prod --remote --config .wrangler/production-cutover.jsonc --env production
   pnpm exec wrangler d1 time-travel info maal-prod --config .wrangler/production-cutover.jsonc --env production
   pnpm exec wrangler d1 export maal-prod --remote --config .wrangler/production-cutover.jsonc --env production --no-data --output=/absolute/private/path/maal-prod-before-rewrite.sql
   node scripts/generate-d1-reset-sql.mjs maal-prod /absolute/private/path/maal-prod-before-rewrite.sql /absolute/private/path/maal-prod-reset.sql
   ```

   Review both SQL files and record the bookmark. Require the production-specific confirmation before the
   one-time rewrite reset:

   ```sh
   printf '%s\n' 'Type exactly: RESET maal-prod FOR REWRITE LAUNCH'
   read -r MAAL_RESET_CONFIRMATION
   test "$MAAL_RESET_CONFIRMATION" = 'RESET maal-prod FOR REWRITE LAUNCH' || { unset MAAL_RESET_CONFIRMATION; printf '%s\n' 'Reset cancelled.' >&2; exit 1; }
   unset MAAL_RESET_CONFIRMATION
   pnpm exec wrangler d1 execute maal-prod --remote --config .wrangler/production-cutover.jsonc --env production --file=/absolute/private/path/maal-prod-reset.sql
   pnpm exec wrangler d1 execute maal-prod --remote --config .wrangler/production-cutover.jsonc --env production --command "SELECT COUNT(*) AS application_objects FROM sqlite_schema WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" --json
   ```

   Stop if the explicit confirmation fails or `application_objects` is not `0`. Apply and verify the fresh
   chain only after the empty check:

   ```sh
   pnpm exec wrangler d1 migrations apply maal-prod --remote --config .wrangler/production-cutover.jsonc --env production
   pnpm exec wrangler d1 migrations list maal-prod --remote --config .wrangler/production-cutover.jsonc --env production
   pnpm exec wrangler d1 execute maal-prod --remote --config .wrangler/production-cutover.jsonc --env production --command "SELECT name FROM d1_migrations ORDER BY id; SELECT (SELECT COUNT(*) FROM units) AS units, (SELECT COUNT(*) FROM unit_aliases) AS unit_aliases, (SELECT COUNT(*) FROM foods) AS foods, (SELECT COUNT(*) FROM food_aliases) AS food_aliases" --json
   ```

4. Confirm the WorkOS application redirects, roles/permissions, branding, production API key, and Client ID.
5. Confirm one live Stripe `Maal` Product, its three live Prices with the exact lookup keys, and a live webhook
   endpoint subscribed only to the seven events above. Keep its independent live signing secret.
6. Generate independent production cookie and maintenance secrets. Never reuse staging values.
7. Build, dry-run, deploy, observe, and run non-mutating smoke checks. The staging harness intentionally refuses
   production provider keys and must not be weakened or pointed at production.
8. Attach the sanitized staging evidence and the #70 native-browser evidence to the release decision. Keep
   infrastructure IDs and provider object IDs only in the private operations record.

The reset is exclusive to the rewrite launch. Future production versions inspect, bookmark, and apply
forward-only generated migrations against the same `maal-prod`. They never reset routine releases, create a
replacement D1, or create a versioned production Worker.

Cut over traffic only when the callback blocker is closed, every staging gate passes, cleanup is verified,
scheduled maintenance is observable, and an operator has rehearsed rollback-forward.
