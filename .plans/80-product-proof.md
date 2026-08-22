# #80 Run the accessibility, browser, performance, and UI proof matrix

## Summary

Prove the local-first product against the release budgets and the approved prototype UI without redesigning it.
Automate what this Linux host can execute and record native or missing-runtime gates as external evidence.

## Acceptance criteria

- [ ] Light and dark automated accessibility checks cover plan, recipes, profiles, household settings,
      preferences, billing, and recovery, including visible keyboard focus.
- [ ] Chromium, Firefox, and WebKit smoke runs cover local-first startup, offline reopen, update startup, and
      recovery where the host can launch them.
- [ ] Browser measurements enforce shell render, interaction, long-task, CLS, 10,000-recipe, and bundle budgets.
- [ ] Phone, tablet, and desktop evidence compares every in-scope product route with the prototype authority and
      covers scroll, drag/drop, keyboard planning, check-ins, settings, and billing.
- [ ] Confirmed product regressions are fixed. Host and device limitations remain explicit external gates.

## TODOs

- [x] Add a deterministic product-proof fixture and dedicated Playwright project.
- [x] Add automated accessibility and visible keyboard-focus coverage in light and dark modes.
- [x] Add local-first browser smoke and measured performance-budget coverage.
- [x] Add responsive prototype comparison evidence and interaction preservation checks.
- [x] Run focused proof, document measured results and external gates, then run the serialized full validation.

## Notes

- Base integration commit: `833843751463b8fcc02e911297cd1ec265895d31`.
- Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- This is a proof and confirmed-regression slice. It does not change the approved product design.
- Browser MCP and a live Chrome DevTools trace are intentionally outside this gate. Reproducible Playwright and
  browser Performance API measurements cover the committed budgets instead.
- Native Safari, iOS, and Android evidence remains issue #70.
- The focused Chromium proof, Firefox smoke, 33 responsive snapshots, and prototype-source check pass against the
  production Worker build. WebKit cannot launch on this host because its system libraries are unavailable.
