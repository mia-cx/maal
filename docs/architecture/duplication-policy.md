# Duplication policy

Semantic duplication is repeated domain behavior, validation, projection, parsing, state orchestration, or persistence mapping that must change together to preserve product behavior.

This is not semantic duplication:

- Calling the same existing abstractions in several places.
- Similar markup around different product concepts.
- Generated or vendor-like design-system primitive wrappers.
- Coincidental syntax similarity that does not encode the same business rule.

Policy:

- One implementation is ideal.
- Two semantically distinct or transitional implementations are borderline but acceptable during a refactor.
- Three semantically duplicated implementations are a hard failure and must become one abstraction or a documented exception.

Preferred destinations:

- Shared kernel for transport-neutral utilities.
- Domain service for product behavior.
- Domain constant module for canonical literals.
- Public domain API for cross-domain contracts.

Every abstraction should be earned: extract behavior only when there is a coherent concept, not just repeated tokens.

Use `pnpm duplicates:scan` or `pnpm architecture:check` during review. Generated/import-only noise is intentionally filtered by the scanner; product behavior inside generated-looking files is not exempt once edited by hand.
