# Open Questions

## Product

1. Should leftovers be v0.1 or v0.2?
2. Should grocery lists include top-pool meals by default, or only date-assigned meals?
3. Should takeout be a replacement kind or a distinct household meal type?
4. How much should Poke infer request-time capacity mode vs only use it after user confirmation?

## Data/modeling

1. How much raw recipe import data should be stored: parsed recipe only, raw JSON-LD, or HTML hash too?
2. Do we need per-meal attendance for aggregating member preferences/constraints, or is active household membership enough for v0.1?
3. Should allergies and hard diet constraints live in Maal only, or also be duplicated in Poke state?
4. Should purchased groceries be persisted by generated grocery list version, or directly as reusable ingredient records?
5. What is the minimum useful nutrition model: source-provided only, or normalized per serving?

## MCP/API

1. Should tool calls be user-scoped by auth context only, or include explicit household IDs?
2. Should `suggest_meals_for_day` return only existing assigned/top-pool household meals, or also accept candidate recipe payloads from Poke that Maal immediately flattens?
3. Should Maal own scoring, Poke own scoring, or both with Maal providing vectors?

## UX copy

1. Should “Never again” be softened in some UI surfaces while staying explicit in data?
2. What wording best avoids shame around skipped/takeout meals?

## Keyboard UX

1. Should Month keep `m`, or should the final view-switch shortcut set favor left-hand keys?
2. Should `j`/`k` duplicate arrow navigation everywhere, or only inside card lists?
3. Should keyboard reorder mode use `Space` to pick up/drop, or reserve `Space` for selection and use `Enter` to drop?
