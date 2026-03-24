# SMS-to-Claude Channel: Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

An MCP channel server that bridges Twilio SMS with a Claude Code session. The owner can send natural language commands from a regular phone via SMS, Claude Code works on the refutr project and replies via SMS. Permission prompts are relayed to the phone for remote approval.

## Context

The owner will be away on military service for ~1 month starting April 2026 with access only to a regular (non-smart) phone and SMS at limited times. The goal is to keep building the refutr side project remotely by treating SMS as a terminal for Claude Code.

## Architecture

```
Owner's phone (SMS)
      │
      ▼
  Twilio (phone number)
      │  ← polled every 5s
      ▼
SMS Channel Server  ←──── stdio ────→  Claude Code (refutr/)
  (MCP server, Bun)
      │
      └── reply tool → Twilio → Owner's phone
```

Claude Code spawns the channel server as a subprocess over stdio. The channel server is the sole bridge between Twilio and the Claude Code session.

## Three Flows

### 1. Inbound command
1. Owner sends SMS to Twilio number
2. Poll detects new message (≤5s lag)
3. Sender checked against allowlist — unknown senders silently dropped
4. Channel notification emitted to Claude Code
5. Claude works on refutr project
6. Claude calls `sms_reply` tool with result
7. Twilio delivers SMS back to owner

### 2. Permission relay
1. Claude attempts a tool call requiring approval
2. Claude Code fires `notifications/claude/channel/permission_request` to channel
3. Channel formats and sends SMS:
   ```
   [Permission needed]
   Tool: Bash
   rm -rf dist/

   Reply: yes abcde OR no abcde
   ```
4. Owner replies `yes abcde` or `no abcde`
5. Channel parses verdict, emits `notifications/claude/channel/permission`
6. Claude Code proceeds or stops — local terminal dialog also stays open as fallback

### 3. Security gate
Every inbound message is matched against `ALLOWED_PHONE_NUMBER` before being forwarded to Claude. Non-matching senders are silently dropped to prevent prompt injection.

## Project Structure

```
sms-to-claude/
├── src/
│   └── index.ts        # Entire channel server (single file)
├── .env                # Twilio credentials (gitignored)
├── .env.example        # Template with required keys
├── package.json
├── tsconfig.json
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-24-sms-to-claude-design.md
```

The `.mcp.json` registering this server lives in the **refutr project directory**.

## Channel Server: State

| State | Type | Purpose |
|---|---|---|
| `lastChecked` | ISO string | Cursor for Twilio poll — set to "now" on startup, updated after each batch |
| `processedSids` | `Set<string>` | Deduplicated set of Twilio message SIDs already forwarded to Claude. Prevents re-delivery caused by `DateSent` second-level granularity on the Twilio API. |
| `pendingPermissions` | `Map<string, { tool_name: string, description: string, expires: number }>` | Open permission requests keyed by `request_id` (the 5-char nonce issued by Claude Code). Entries expire after 10 minutes. |

## Channel Server: Components

### Polling loop
- Runs every `POLL_INTERVAL_MS` (default: 5000ms)
- Queries Twilio Messages API: `To=<twilio_number>`, `DateSent>=<lastChecked>`, sorted oldest-first
- **Deduplication:** each message's `Sid` is checked against `processedSids` before forwarding; already-seen Sids are skipped. After processing a batch, `lastChecked` is updated to the `DateSent` of the newest message in the batch (not +1s, since Twilio filters are inclusive and deduplication handles re-fetch).
- Filters by `ALLOWED_PHONE_NUMBERS` before emitting
- Emits one channel notification per new message
- Adds processed `Sid` to `processedSids`
- **Concurrent command ordering:** non-verdict messages are forwarded to Claude immediately, even if a permission request is in-flight in `pendingPermissions`. This means the owner could trigger a new Claude task while the first is waiting on a permission reply. This is accepted behavior — the owner is responsible for sequencing during limited SMS windows. No command queuing is implemented.
- **Permission verdict detection:** before forwarding any message to Claude, check if it matches `/^(yes|no)\s+([a-z]{5})$/i`. If it matches:
  - Nonce found in `pendingPermissions` → send verdict, remove from map, do not forward to Claude
  - Nonce NOT found (stale or mistyped) → reply via SMS: `"Unknown permission ID. It may have expired."` — do not forward to Claude
  - Do not treat as a command in either case

### Reply tool (`sms_reply`)
- Registered as an MCP tool so Claude can call it
- Input: `{ text: string }`
- Sends via Twilio REST API
- Responses >1600 chars are truncated with `[truncated]` — no paging; owner should ask Claude to summarize if needed
- **Error contract:** on Twilio API failure, the tool returns an MCP error result (not a success) so Claude sees the failure. The `instructions` string tells Claude to log failures to the terminal. The owner will not receive an SMS on failure, but the Claude Code terminal session will show the error.

### Permission relay handler
- Listens for `notifications/claude/channel/permission_request`
- `request_id` is a 5-character nonce issued by Claude Code (lowercase a-z, excluding l to avoid confusion with 1/I)
- Stores in `pendingPermissions` with `expires = Date.now() + 10 * 60 * 1000`
- Formats and sends permission SMS (see Flow 2 above)
- **Timeout:** a background sweep runs every 60s and removes expired entries from `pendingPermissions`. When an entry expires, Claude Code's local terminal dialog is still open — the local user can approve/deny there. No automatic deny is sent (Claude Code handles the open dialog). An SMS is sent to the owner: `"Permission request <id> expired. Answer in terminal if present."`
- Verdict intercept is handled in the polling loop (see above)

### System prompt instructions
Injected via the MCP server `instructions` field in the `Server` constructor. Per the [Channels reference](https://code.claude.com/docs/en/channels-reference#server-options), this string is added to Claude's system prompt at session start:
> "You are working on the refutr project. Commands arrive via SMS from the owner as `<channel source="sms" ...>` tags. Always reply with the `sms_reply` tool when your work is done or when you need to ask something. Be concise — this is SMS."

## Configuration

### Environment variables (`.env`)
```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx        # Twilio number to poll
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx      # Comma-separated allowlist of trusted numbers
POLL_INTERVAL_MS=5000                   # Optional, defaults to 5000
```

### MCP registration (`refutr/.mcp.json`)
```json
{
  "mcpServers": {
    "sms": {
      "command": "bun",
      "args": ["/absolute/path/to/sms-to-claude/src/index.ts"]
    }
  }
}
```

### Starting Claude Code
```bash
# from refutr/ directory
claude --dangerously-load-development-channels server:sms
```

Leave this running on the laptop before departure.

## Runtime: Bun

- Runtime: [Bun](https://bun.sh)
- Dependencies: `@modelcontextprotocol/sdk`, `twilio`
- No separate build step — Bun runs TypeScript directly

## Constraints & Accepted Trade-offs

| Constraint | Decision |
|---|---|
| Research preview | `--dangerously-load-development-channels server:sms` required. This flag bypasses the Channels allowlist for the named MCP server entry; the `channelsEnabled` org policy still applies. Requires claude.ai login (not API key auth). |
| No persistence across restarts | `lastChecked` resets to "now" on restart — messages during downtime are lost (acceptable) |
| SMS length | Truncate at 1600 chars with `[truncated]`, no paging |
| Single session | No multi-session or group chat support |
| Polling lag | ≤5s, imperceptible given limited SMS windows |
| Process supervision | No automatic restart on crash. Mitigation: register a `launchd` plist (macOS) to keep the Claude Code session alive. Out of scope for v1 — owner should start it before departure and accept best-effort uptime. |
| Error reporting | Best-effort: if `sms_reply` Twilio call fails, the error is logged to stderr (visible in `~/.claude/debug/<session>.txt`). No retry. Owner has no SMS feedback on Twilio errors. |
| Liveness indicator | Not implemented in v1. Owner cannot query whether the server is still running remotely. |

## Requirements

- Claude Code v2.1.81+ (for permission relay support)
- claude.ai login (Channels require it — not API key auth)
- Twilio account with a phone number (~$1/month + pennies per SMS)
- Bun installed on the laptop
