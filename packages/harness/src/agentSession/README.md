# agentSession

Middle library: durable sessions/turns over `ISessionStore`, wired to the public harness for execution.

**Deps:** `agentSession → harness`. Never reverse.

## Scope

- Zod product contracts (`schemas/`) — no `sequence_number`, no SSE envelopes
- `Sessions` / `SessionHandle` / `TurnHandle` — storage + `run()` / `stream()`
- `ISessionStore` + `InMemorySessionStore` (reference impl)
- `ITurnResourceResolver` / `TurnResourceResolver` — per-run secrets/providers

## Not in v1

Private gateway adoption (handlers, Redis store, ActiveTurnRegistry, SSE fan-out, `/subscribe`) is **out of scope**. §4 of the design plan is a mapping sketch only — gradual adapt later; this package does not replace private gateway code.
