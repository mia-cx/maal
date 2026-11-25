# Changesets

Every change people using Maal can notice gets a changeset: run `pnpm changeset`, pick `maal`, and describe the change in a sentence.

Merging to `main` deploys to [staging.maal.is](https://staging.maal.is) and opens or updates the release pull request. Merging that pull request versions the app, applies its D1 migrations, and deploys it to production.
