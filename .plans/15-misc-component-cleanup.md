# #15 Code review: miscellaneous component findings

## Summary
Tighten remaining miscellaneous component reliability issues: public marketing components, local user state, async dialog/onboarding/switching flows, and small cleanup called out by review.

## Acceptance criteria
- [ ] Marketing/footer/public components avoid runtime CDN/SVG HTML risks and route anchors correctly.
- [ ] Sticky header cleans up global side effects and tracks header height changes.
- [ ] Pricing trial CTAs are per-price and typed enough to avoid global trial-price reuse.
- [ ] Nav user uses mutable local state without mutating a derived value.
- [ ] Async component handlers clear busy/submitting state and surface errors on failure.
- [ ] Focused and repo validation pass or residual risks are recorded.

## TODOs
- [x] Clean up public marketing components: footer CDN/links, wordmark rendering, sticky header globals, pricing CTA typing, and gradient blur dead CSS.
- [x] Fix nav-user local state semantics and unreachable link branches.
- [ ] Harden household onboarding, team switching, and delete confirm async paths.
- [ ] Harden user settings async handlers and remove dead imports/state.
- [ ] Run final validation and file the PR.

## Notes
- Svelte MCP server is not available in this session (`mcp` only lists the maal server), so Svelte docs/autofixer cannot be used.
- Public marketing validation: `pnpm exec prettier --write ... && pnpm check` passed with 0 Svelte diagnostics.
- Nav user validation: `pnpm exec prettier --write src/lib/components/nav-user.svelte && pnpm check` passed with 0 Svelte diagnostics.
