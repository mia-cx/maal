// Domain tables are introduced by their vertical slices. Keeping this entry point stable lets Drizzle
// generate migrations without coupling callers to the eventual per-aggregate schema modules.
export {};
