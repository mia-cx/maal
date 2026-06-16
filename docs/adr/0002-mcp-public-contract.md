# ADR 0002: Treat MCP tools as a public contract

## Status

Accepted

## Context

MCP tools expose household planning and recipe behavior to external callers. Tool names, inputs, and output shapes are therefore integration contracts, not implementation details.

## Decision

MCP protocol handling, context resolution, schemas, registry setup, input mapping, and tool implementations are split into dedicated modules. Tool names/order are snapshot-tested, and compatibility rules are documented.

## Consequences

- Tool additions and breaking changes require explicit review.
- HTTP and MCP can share domain behavior without sharing transport adapters.
- Input mappers should get tests when arguments are optional, derived, or destructive.
