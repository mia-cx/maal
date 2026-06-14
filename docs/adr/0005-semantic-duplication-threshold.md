# ADR 0005: Enforce a semantic duplication threshold

## Status

Accepted

## Context

The refactor split large files into smaller modules. Splitting can accidentally create repeated rules, mappers, and parsers that drift over time.

## Decision

Three instances of the same semantic behavior are a hard failure unless documented as an exception. Duplicate detection is part of `pnpm architecture:check`.

## Consequences

- Shared behavior gets named before drift becomes normal.
- Similar markup without shared semantics can remain inline.
- Generated/import-only repetition is filtered so reviews focus on maintainability risk.
