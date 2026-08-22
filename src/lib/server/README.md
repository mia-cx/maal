# Server

Cloudflare Worker adapters live here. Drizzle/D1 persistence, WorkOS, Stripe, imports, sync HTTP routes, and
MCP all delegate to shared domain commands. Server modules must never be imported by browser code.
