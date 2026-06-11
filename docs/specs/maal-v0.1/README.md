# Maal v0.1 Spec

Maal is a flexible meal logistics layer for Poke: recipes come in as `schema.org/Recipe`, meals can float inside a calendar until scheduled, grocery lists are derived from household meals, and feedback teaches Poke which meals are safe, neutral, or never again.

## Files

- [product-spec.md](./product-spec.md) — product shape, scope, and behavior rules.
- [domain-model.md](./domain-model.md) — core entities and lifecycle rules.
- [persistence-model.md](./persistence-model.md) — normalized backend model vs API DTOs.
- [mcp-tools.md](./mcp-tools.md) — tools Poke should be able to call.
- [user-flows.md](./user-flows.md) — important user/Poke flows.
- [schemas.ts](./schemas.ts) — draft TypeScript schemas.
- [taxonomy-drizzle-sketch.ts](./taxonomy-drizzle-sketch.ts) — draft Drizzle shape for ingredient/unit taxonomy, aliases, overrides, and moderation.
- [taxonomy-effect-schemas.ts](./taxonomy-effect-schemas.ts) — draft Effect Schema DTOs for the taxonomy model.
- [open-questions.md](./open-questions.md) — decisions to revisit before implementation.
- [context-menu-todo.md](./context-menu-todo.md) — deferred custom context menu work.
- [check-in-todo.md](./check-in-todo.md) — deferred post-meal check-in system.

## v0.1 thesis

Maal is not recipe search and not a cookbook index. Users bring their own recipe links/snapshots directly or through Poke. Maal stores the plan, user recipe snapshots, grocery demand, pantry assumptions, cook-time reality, and user feedback.
