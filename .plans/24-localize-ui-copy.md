# #24 Localize UI copy with Paraglide and household locale

## Summary
Convert authenticated app UI copy to Paraglide message tokens, establish message naming conventions, and make the authenticated app use the active household locale when available while preserving public route locale behavior.

## Acceptance criteria
- [ ] User-visible copy in authenticated app UI is represented by Paraglide message tokens instead of hardcoded strings.
- [ ] Dynamic/interpolated copy uses typed Paraglide parameters rather than manual string concatenation where practical.
- [ ] Active household locale drives Paraglide locale for authenticated app routes after household resolution.
- [ ] Changing household locale updates app UI language without requiring query-param based locale switching.
- [ ] Public routes keep a clear locale-resolution policy and do not depend on an active household.
- [ ] Locale fallback is explicit for users with no active household or households with unsupported/invalid locales.
- [ ] Tests or smoke checks cover household-locale selection, fallback behavior, and at least one translated message render path.
- [ ] Documentation explains message naming, where to add copy, and how household locale interacts with Paraglide.

## TODOs
- [ ] Inventory authenticated app copy, Paraglide setup, and household locale resolution seams.
- [x] Add shared localization utilities, documentation, and household-locale resolution tests.
- [x] Convert app shell, shared components, and settings copy to Paraglide messages.
- [x] Convert planning, menu, subscribe, and household feature copy to Paraglide messages.
- [x] Run Paraglide generation plus focused type/test validation and fix regressions.
- [ ] Push branch and file PR.

## Notes
- Worktree: `.worktrees/24-localize-ui-copy`
- Branch: `issue/24-localize-ui-copy`
- Svelte MCP server was not available in this runtime, so Svelte docs could not be fetched through MCP.
- Main worktree has pre-existing local changes (`.gitignore`, `src/lib/assets/logo.af`, `Untitled.md`); this worktree was created from `origin/main` to avoid mixing them.
- Added household-to-Paraglide locale mapping and authenticated app path gating.
- Validation: `pnpm exec vitest run src/hooks.server.test.ts` — pass.
- Converted authenticated app Svelte copy and user-visible route/server copy to `$lib/paraglide/messages` tokens across app shell, settings, planning, menu, household, billing/subscribe, pantry, and groceries surfaces.
- Added `docs/localization.md` with message naming and household locale policy.
- Validation: `pnpm check` — pass.
- Validation: `pnpm exec vitest run src/hooks.server.test.ts` — pass.
- Residual scan: no remaining uppercase hardcoded authenticated app copy found by targeted scanner; one false positive in `schedule-keyboard.ts` for `Array.from(document.querySelectorAll...)`.
