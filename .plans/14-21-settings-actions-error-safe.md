# #14 + #21 Settings actions awaitable and error-safe

## Summary
Fix settings UI and route findings together: make async settings actions awaitable, tighten MCP scope/key state, improve OTP handling, preserve HTTP/provider error semantics, and reduce duplicated WorkOS/session helpers.

## Acceptance criteria
- [ ] MCP household picker toggles by household id and avoids name collisions.
- [ ] Mutating settings UI handlers are typed/awaited consistently, including clipboard copy failure feedback.
- [ ] MCP scope state only accepts known scope group ids.
- [ ] OTP UI and route validation use exact configured code length/format.
- [ ] Settings routes preserve SvelteKit `HttpError`s, use consistent provider error mapping, and avoid partial-success session refresh behavior.
- [ ] WorkOS email-change/session helper logic is centralized and validates returned user payloads.
- [ ] Settings redirects share default/category policy and throw redirects explicitly.
- [ ] Required validation passes or residual risks are documented.

## TODOs
- [x] Fix MCP settings UI selection, async handler contracts, strict scope state, and clipboard error feedback.
- [x] Extract shared OTP input and exact verification-code validation for account/MFA settings.
- [x] Centralize settings route category, WorkOS email-change, public user, and session refresh helpers.
- [ ] Update settings route handlers to preserve HttpErrors, avoid swallowed refresh failures/partial account updates, and use shared helpers.
- [ ] Add or update focused tests for settings model/helper behavior.
- [ ] Run final validation and file PR.

## Notes
- Issues read: #14 and #21.
- Initial relevant files inspected with `rg` and `sed`.
- Fixed MCP picker to use `onSelect` with household ids, tightened MCP scope state to `McpScopeGroupId`, widened async component handlers to `void | Promise<void>`, and surfaced clipboard copy failure text.
- Validation: `pnpm gen && rm -rf .svelte-kit/cloudflare .svelte-kit/cloudflare-tmp .svelte-kit/output && pnpm check` passed after clearing generated Cloudflare output.
- Svelte MCP server was unavailable in this session, so `svelte-autofixer` could not be run.
- Extracted `VerificationCodeInput`, made MFA setup copy/maxlength derive from configured length, and added shared exact six-digit verification-code validation for email/MFA routes.
- Validation: `pnpm check` passed.
- Added shared settings route category helpers, account/session helpers, WorkOS email-change helpers with encoded user ids, and runtime validation for returned public user payloads. Account/email routes now consume shared helpers.
- Validation: `pnpm check` passed.
