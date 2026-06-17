## Closes #24

Converts authenticated app UI copy to Paraglide message tokens and makes active household locale drive app-surface Paraglide locale selection.

### Plan executed
- [x] Inventory authenticated app copy, Paraglide setup, and household locale resolution seams.
- [x] Add shared localization utilities, documentation, and household-locale resolution tests.
- [x] Convert app shell, shared components, and settings copy to Paraglide messages.
- [x] Convert planning, menu, subscribe, and household feature copy to Paraglide messages.
- [x] Run Paraglide generation plus focused type/test validation and fix regressions.

### Tests
- `pnpm check` — pass
- `pnpm architecture:check` — pass
- `pnpm test:unit -- --run src/hooks.server.test.ts` — pass (Vitest runs the unit suite; 67 files / 248 tests passed)
- Targeted hardcoded-copy scanner — no remaining uppercase authenticated-app copy matches; one false positive in `schedule-keyboard.ts` for `Array.from(document.querySelectorAll...)`

### Notes
- Public/auth/legal/marketing routes keep the existing Paraglide runtime policy.
- Authenticated app routes map household BCP-47 locales to supported Paraglide language tags and set the Paraglide cookie for app requests.
- Non-English locale files currently receive English fallback text for new keys so every copy site is tokenized and ready for translation.
