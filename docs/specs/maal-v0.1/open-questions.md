# Open Questions

## Product

1. Should leftovers be v0.1 or v0.2?
2. Should grocery lists include floating meals by default, or only scheduled meals?
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
2. Should `suggest_meals_for_day` return only existing scheduled/floating household meals, or also accept candidate recipe snapshots from Poke?
3. Should Maal own scoring, Poke own scoring, or both with Maal providing vectors?

## UX copy

1. Final English label for “voor herhaling vatbaar”: “Worth repeating”, “Make again”, or “Repeat-worthy”?
2. Should “never again” be softened in UI while staying explicit in data?
3. What wording best avoids shame around skipped/takeout meals?
