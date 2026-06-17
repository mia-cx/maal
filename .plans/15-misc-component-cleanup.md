# #15 Code review: miscellaneous component findings

## Summary

Tighten remaining miscellaneous component reliability issues: public marketing components, local user state, async dialog/onboarding/switching flows, and small cleanup called out by review.

## Acceptance criteria

- [x] Marketing/footer/public components avoid runtime CDN/SVG HTML risks and route anchors correctly.
- [x] Sticky header cleans up global side effects and tracks header height changes.
- [x] Pricing trial CTAs are per-price and typed enough to avoid global trial-price reuse.
- [x] Nav user uses mutable local state without mutating a derived value.
- [x] Async component handlers clear busy/submitting state and surface errors on failure.
- [x] Focused and repo validation pass or residual risks are recorded.
- [x] Unresolved PR review discussions are classified, fixed, replied to, and resolved.

## TODOs

- [x] Clean up public marketing components: footer CDN/links, wordmark rendering, sticky header globals, pricing CTA typing, and gradient blur dead CSS.
- [x] Fix nav-user local state semantics and unreachable link branches.
- [x] Harden household onboarding, team switching, and delete confirm async paths.
- [x] Harden user settings async handlers and remove dead imports/state.
- [x] Run final validation and file the PR.
- [x] Resolve PR #41 review discussions for nav user, household switcher, settings navigation, delete dialog, and sticky header.

## Notes

- Svelte MCP server is not available in this session (`mcp` only lists the maal server), so Svelte docs/autofixer cannot be used.
- Public marketing validation: `pnpm exec prettier --write ... && pnpm check` passed with 0 Svelte diagnostics.
- Nav user validation: `pnpm exec prettier --write src/lib/components/nav-user.svelte && pnpm check` passed with 0 Svelte diagnostics.
- Async component validation: `pnpm exec prettier --write src/lib/components/delete-confirm-dialog.svelte src/lib/components/household/household-onboarding.svelte src/lib/components/team-switcher.svelte && pnpm check` passed with 0 Svelte diagnostics.
- User settings validation: `pnpm exec prettier --write src/lib/components/user-settings-dialog.svelte && pnpm check` passed with 0 Svelte diagnostics.
- Final validation: `pnpm test:e2e` passed after retrying the web server startup; `pnpm check` passed with 0 Svelte diagnostics after clearing stale `.svelte-kit` build output; `pnpm architecture:check` passed.
- PR discussion resolution validation: `pnpm check` passed with 0 Svelte diagnostics after clearing stale `.svelte-kit` build output.
- Follow-up review resolution validation: `pnpm check` passed with 0 Svelte diagnostics after adding request-id guarding to settings tab navigation and replaying delayed household store ids.
- Full `pnpm lint` remains blocked by pre-existing repository-wide Prettier warnings outside this issue's changed files.
