# Client

Browser-only adapters live here. Dexie repositories, live-query adapters, profile databases, service-worker
coordination, and ephemeral UI state belong in this boundary. Components observe Dexie-derived adapters only;
HTTP responses never hydrate component state directly.
