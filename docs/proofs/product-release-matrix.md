# Product release proof matrix

Date: 2026-08-22  
Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`  
Rewrite baseline: `833843751463b8fcc02e911297cd1ec265895d31`

## Result

The Linux-hosted product gate is green in Chromium and Firefox. The automated proof covers every v1 product
surface, local-first browser behavior, light and dark accessibility, the committed performance budgets, and the
prototype interactions. WebKit and native-device evidence remain explicit external gates below.

## Accessibility

`pnpm test:proof:product -- tests/product-proof/accessibility.proof.ts`

- 12/12 Chromium cases pass.
- Light and dark appearances each cover the plan, recipes, local profiles, household settings plus taxonomy
  preferences, billing, and recovery.
- Every case checks WCAG 2 A/AA and WCAG 2.1 A/AA rules with axe and proves that keyboard traversal produces a
  visible focus indicator.
- Confirmed regressions fixed by this proof: light muted-text contrast, nested interactive schedule roles, the
  missing household taxonomy-preferences surface, and an unnamed member-role selector.

## Browser and PWA smoke

`pnpm exec playwright test --config playwright.product-proof.config.ts --project=chromium --project=firefox tests/product-proof/browser-smoke.proof.ts`

- Chromium: pass.
- Firefox: pass.
- Both runs prove a quiet first install, an active service-worker controller after reload, an offline reopen, local
  recovery, no content API traffic, and no page errors.
- `tests/unit/pwa-update-coordinator.spec.ts`: 3/3 update-startup and controller-transition cases pass.

WebKit was attempted with the installed Playwright browser and could not launch on this Debian host. Playwright
reported these missing runtime libraries: `libgtk-4.so.1`, `libavif.so.16`, `libmanette-0.2.so.0`,
`libenchant-2.so.2`, `libsecret-1.so.0`, and `libwoff2dec.so.1.0.2`. Native Safari, iOS, and Android remain issue
#70.

## Measured performance

`pnpm exec playwright test --config playwright.product-proof.config.ts --project=chromium tests/product-proof/performance.proof.ts`

| Measurement                       |                        Result |             Budget |
| --------------------------------- | ----------------------------: | -----------------: |
| Initial shell render              |                      378.4 ms |           1,000 ms |
| Month-mode interaction response   |                        9.8 ms |             100 ms |
| Month-mode longest task           |                 0 ms observed |              50 ms |
| Cumulative layout shift           |                             0 |                0.1 |
| 10,000-recipe initial DOM window  |                     120 cards |          120 cards |
| 10,000-recipe search response     |                         25 ms |             100 ms |
| 10,000-recipe search longest task |                 0 ms observed |              50 ms |
| Initial SPA entry                 | 185,847 bytes gzip / 27 files | 256,000 bytes gzip |

The measurements use deterministic browser `PerformanceObserver`, mutation, and timing APIs against the
production Worker build. A live Chrome DevTools trace is intentionally not part of this gate; no browser MCP was
used or claimed. Playwright's failure trace remains its ordinary diagnostic artifact, not a DevTools performance
trace.

The first 10,000-recipe run exposed a real 4.78-second all-card DOM replacement. The menu now keeps an accessible
120-card window and uses a bounded top-result heap. The final measured search is 25 ms with no observed long task.

## Prototype UI and interaction preservation

`pnpm proof:prototype-ui`

- 10 core files match the prototype authority byte-for-byte, including the custom scroll SDK, schedule header,
  multi-day schedule, meal pool, drag/drop behavior, keyboard navigation, meal preview, and focused check-in.
- 10 local-first rewrite surfaces required for the same product composition are present.
- Scroll SDK and schedule keyboard unit coverage passes 11/11.

`tests/product-proof/ui-preservation.proof.ts` stores 33 deterministic Chromium screenshots:

| Surface or interaction |      Phone 390×844       |     Tablet 1024×768      |     Desktop 1440×900     |
| ---------------------- | :----------------------: | :----------------------: | :----------------------: |
| Plan                   |           Day            |        Multi-day         |          Month           |
| Drag/drop planning     |           Pass           |           Pass           |           Pass           |
| Focused check-in       | Snapshot + saved locally | Snapshot + saved locally | Snapshot + saved locally |
| Recipes                |         Snapshot         |         Snapshot         |         Snapshot         |
| Household              |         Snapshot         |         Snapshot         |         Snapshot         |
| Taxonomy preferences   |         Snapshot         |         Snapshot         |         Snapshot         |
| Local profiles         |         Snapshot         |         Snapshot         |         Snapshot         |
| Security               |         Snapshot         |         Snapshot         |         Snapshot         |
| MCP                    |         Snapshot         |         Snapshot         |         Snapshot         |
| Billing                |         Snapshot         |         Snapshot         |         Snapshot         |
| Subscribe              |         Snapshot         |         Snapshot         |         Snapshot         |
| Recovery               |         Snapshot         |         Snapshot         |         Snapshot         |

Each viewport also saves a check-in to IndexedDB, verifies the persisted row, and exercises the `d`, `w`, and `m`
keyboard schedule modes. The screenshots were inspected from their generated artifacts; no browser MCP was used.

## Host notes

The production Worker occasionally writes a non-fatal `workerd` broken-pipe or connection-reset diagnostic while
Playwright closes a page. The browser assertions and process exit codes remain authoritative, and the green runs
completed normally after those diagnostics.
