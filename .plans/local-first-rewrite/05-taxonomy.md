## Parent PRD

#55

## What to build

Deliver the lossless local taxonomy, alias, affine-unit conversion, food preference, and display-preference slice from spec §5.5.

## Acceptance criteria

- [ ] Global seed plus user/household entries and aliases retain every prototype field and constraint.
- [ ] User, household, and global precedence is derived at query time.
- [ ] Unit conversions, paired references, locale/domain defaults, and adoption states are editable offline.
- [ ] Dexie and Effect round-trip tests prove no field loss.

## Blocked by

Local runtime and shared prototype-UI baseline slices.

## Implementation TODOs

- [x] Define field-complete Effect contracts and bundled global seed data.
- [x] Type the Dexie taxonomy stores and install the versioned seed without overwriting edits.
- [x] Add offline scoped commands, invariants, affine conversion, and query-time precedence.
- [x] Preserve the prototype display/store seam on top of Dexie live queries.
- [x] Reconnect the prototype household aliases-and-overrides form to Dexie commands and live queries.
- [x] Prove lossless storage and mutation round trips, constraints, precedence, and reactivity.

## Prototype UI authority

- The only taxonomy-management UI is the `Aliases & overrides` section from the prototype household page. It now lives in `src/lib/components/household/taxonomy-preferences-form.svelte`, with its original controls and layout.
- `src/lib/components/household/household-taxonomy-preferences.svelte` is the local-first household-page adapter. It reads from Dexie live queries and writes Dexie commands without HTTP hydration.
- Recipe ingredient text, the meal preview dialog, and the schedule dashboard consume effective preferences through the preserved `src/lib/stores/taxonomy-preferences.ts` and `src/lib/taxonomy/display.ts` seam when their owning slices port those prototype components.

## Validation

- `pnpm validate`
- 49 server/unit tests, the taxonomy Chromium component test, and 2 end-to-end tests pass.
- Build budget is 36,874 / 256,000 gzip bytes.
