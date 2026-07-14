# Domain

Pure domain contracts and commands live here. Effect Schema is the canonical runtime contract system.
This layer must not import SvelteKit, Dexie, Drizzle, WorkOS, Stripe, or transport-specific code.

- `contracts/` contains versioned aggregate and protocol schemas.
- `commands/` will contain decoded domain operations.
- `services/` will contain pure policy and projection logic.
