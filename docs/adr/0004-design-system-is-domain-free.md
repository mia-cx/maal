# ADR 0004: Keep design-system primitives domain-free

## Status

Accepted

## Context

Shared UI primitives are reused by unrelated product areas. Importing product domains from primitives would make the design system a hidden integration point.

## Decision

`src/lib/components/ui/*` stays generic and domain-free. Product behavior belongs in feature components or feature-specific wrappers.

## Consequences

- UI primitives can be reused across future micro-frontends.
- Product semantics remain close to product features.
- Boundary checks should reject product-domain imports from design-system primitives.
