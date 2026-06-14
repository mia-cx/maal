# Refactor test baseline

Initial refactor branch baseline from `refactor/deep-modularization`.

Required gates before merge:

```bash
pnpm check
pnpm test:unit -- --run
pnpm test:e2e
```

Run focused tests before and after each extraction. If an environment-specific command fails, record the failure and keep fixes scoped to the affected domain.
