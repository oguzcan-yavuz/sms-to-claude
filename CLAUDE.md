# sms-to-claude

An MCP server (Claude Code Channel) that relays SMS commands to Claude Code and routes replies back via an Android SMS gateway.

## Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict, ESNext modules)
- **MCP SDK:** `@modelcontextprotocol/sdk` — use `McpServer` (high-level) not the deprecated `Server`
- **Validation:** Zod

## Project layout

```
src/
  index.ts          # MCP server entry point — wires everything together
  config.ts         # Env var loading and validation
  gateway.ts        # HTTP client for the Android SMS Gateway
  permissions.ts    # Permission request/verdict lifecycle manager
  webhook-receiver.ts  # HTTP server receiving inbound SMS webhooks
tests/              # Bun test files (*.test.ts)
scripts/            # Manual testing helpers (test-receive.ts, test-sms.ts)
```

## Commands

```bash
bun run src/index.ts   # start the MCP server
bun test               # run all tests
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GATEWAY_BASE_URL` | yes | Base URL of the Android SMS Gateway |
| `GATEWAY_LOGIN` | yes | Gateway basic-auth username |
| `GATEWAY_PASSWORD` | yes | Gateway basic-auth password |
| `WEBHOOK_URL` | yes | Public URL the gateway will POST inbound SMS to |
| `WEBHOOK_PORT` | no | Port to listen on (defaults to port in WEBHOOK_URL) |
| `ALLOWED_PHONE_NUMBERS` | yes | Comma-separated E.164 numbers allowed to send commands |

## Code style

- No semicolons, single quotes, 2-space indent
- Strict TypeScript — no `any` casts unless absolutely necessary
- Keep functions small and focused; avoid premature abstractions

## Using Serena

Prefer Serena's semantic tools over raw file search whenever possible:

- Use `find_symbol` / `get_symbols_overview` to locate classes, functions, and types instead of `grep` or `find`
- Use `find_referencing_symbols` to understand call sites before modifying a symbol
- Use `replace_symbol_body` or `insert_after_symbol` / `insert_before_symbol` for symbol-level edits
- Use `replace_content` for targeted line-level edits within a symbol
- Fall back to `search_for_pattern` only when a symbol name is unknown or ambiguous
- Avoid reading entire files when a targeted symbol read is sufficient
