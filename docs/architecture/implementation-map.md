# Implementation map

## Shared kernel

- HTTP helpers: `src/lib/server/http/*`
- Pagination/date helpers: `src/lib/shared/*`
- Household domain values: `src/lib/domain/household/*`

## Server domains

- Billing public API: `src/lib/server/domains/billing`
- Planning public API: `src/lib/server/domains/planning`
- Recipe public API: `src/lib/server/domains/recipes`

## Feature clients

- Menu HTTP client: `src/lib/menu/menu-client.ts`
- Planning meal client: `src/lib/components/dashboard/schedule-meal-client.ts`
- Settings clients: `src/lib/settings/*-client.ts`

## Public UI surfaces

- Menu feature exports: `src/lib/components/menu/index.ts`
- UI primitive exports: `src/lib/components/ui/index.ts`
- Store contract exports: `src/lib/stores/index.ts`
