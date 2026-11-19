## Parent PRD

#55

## What to build

Port the approved shared product-UI substrate from prototype commit `74a12ec38f6c297d1a6adbf596234c45212bac11` before vertical UI slices reconnect their Dexie data seams. This ticket owns shared components and dependencies, not feature-domain behavior or a redesign.

## Acceptance criteria

- [ ] The prototype design tokens, global styles, fonts/assets, app-shell primitives, utilities, icon conventions, and reusable `src/lib/components/ui/**` component kit are carried over without visual reinterpretation.
- [ ] `src/lib/interaction/scroll-sdk.ts`, calendar/range-calendar primitives, scroll-area primitives, and their existing unit tests are preserved exactly except for compatibility fixes required by the locked rewrite stack.
- [ ] Required UI dependencies are restored selectively without replacing or downgrading the rewrite's SvelteKit, Effect, Dexie, Drizzle, WorkOS, Stripe, or Cloudflare foundations.
- [ ] Shared components compile and their unit/browser smoke tests pass with the foundation route; no prototype HTTP/store hydration path is introduced.
- [ ] `/tmp/maal-local-first/prototype-ui-inventory.md` is used as the port checklist, and downstream feature slices have stable components to reuse rather than copying private subsets.

## Blocked by

Shared local runtime (#60).
