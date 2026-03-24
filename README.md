# sms-to-claude

A [Claude Code Channel](https://code.claude.com/docs/en/channels-reference) that lets you control a Claude Code session via SMS. Send natural language commands, get replies, and approve/deny tool use — all over text message.

```
Your phone (SMS)
      │
      ▼
  Twilio number
      │  ← polled every 5s
      ▼
SMS Channel Server ────── stdio ──────► Claude Code (your project)
      │
      └── sms_reply tool ──► Twilio ──► Your phone
```

## How it works

- **Send a command** — SMS your Twilio number, Claude receives it and gets to work
- **Get a reply** — Claude uses the `sms_reply` tool to SMS you when done
- **Permission relay** — when Claude needs to run a tool requiring approval, you get an SMS like:

  ```
  [Permission needed]
  Tool: Bash
  rm -rf dist/

  Reply: yes abcde OR no abcde
  ```

  Reply `yes abcde` or `no abcde` to approve or deny.

## Requirements

- [Bun](https://bun.sh) installed
- Claude Code v2.1.81+ with a claude.ai login (not API key auth)
- Twilio account with a phone number (~$1/month + pennies per SMS)

## Setup

**1. Install dependencies**

```bash
bun install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Edit `.env`:

```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx     # your Twilio number
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx  # your personal number (allowlist)
POLL_INTERVAL_MS=5000               # optional, defaults to 5s
```

**3. Register with Claude Code**

Copy `.mcp.json.example` to your project directory as `.mcp.json` and update the path:

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

**4. Start Claude Code**

From your project directory:

```bash
claude --dangerously-load-development-channels server:sms
```

The `--dangerously-load-development-channels` flag is required during the research preview. It bypasses the channel allowlist for the named MCP server entry.

## Usage

Once running, SMS your Twilio number from your allowlisted phone. Claude receives the message, works on your project, and replies via SMS when done.

**Tips:**
- Responses longer than 1600 characters are truncated with `[truncated]` — ask Claude to summarize if needed
- Send `yes <id>` or `no <id>` to respond to permission prompts
- If you send a new command while a permission prompt is pending, Claude will start on the new command concurrently — sequence your messages deliberately

## Security

Only phone numbers listed in `ALLOWED_PHONE_NUMBERS` can send commands to Claude. All other senders are silently dropped. Keep your `.env` file out of version control (it's gitignored).

## Project structure

```
src/
  config.ts       — env var loading and validation
  poller.ts       — Twilio poll loop, deduplication, allowlist, verdict detection
  permissions.ts  — permission relay state, timeout sweep
  index.ts        — MCP server, tool registration, wiring
tests/
  config.test.ts
  poller.test.ts
  permissions.test.ts
```

## Running tests

```bash
bun test
```
