# Android SMS Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Twilio with an Android phone running smsgateway.me, cutting per-message costs ~40x, and fix the env var loading bug that breaks the MCP when launched from another project.

**Architecture:** Introduce a thin `GatewayClient` abstraction in `src/gateway.ts` that mirrors the shape `Poller` already expects, backed by the smsgateway.me REST API (basic auth, JSON, fetch). The `Poller` and `PermissionManager` are untouched except for renaming `TwilioMessage → GatewayMessage`. The env-var bug is fixed by adding `--env-file <absolute-path>` to the bun args in `.mcp.json.example`, so the right `.env` is loaded regardless of CWD.

**Tech Stack:** Bun, smsgateway.me REST API (fetch/no extra dep), `@modelcontextprotocol/sdk`, Zod

---

## File map

| File | Action | What changes |
|---|---|---|
| `src/config.ts` | Modify | Remove Twilio block; add `gateway` block (baseUrl, login, password, deviceId) |
| `src/gateway.ts` | Create | `GatewayMessage` type + `GatewayClient` class wrapping smsgateway.me REST API |
| `src/poller.ts` | Modify | Rename `TwilioMessage → GatewayMessage`, `TwilioClient → GatewayClient` from gateway.ts |
| `src/index.ts` | Modify | Remove `twilio` import/client; import `GatewayClient`; wire `sendSms` to gateway |
| `package.json` | Modify | Remove `twilio` dependency |
| `.env.example` | Modify | Replace Twilio vars with gateway vars |
| `.mcp.json.example` | Modify | Add `--env-file` arg pointing to absolute sms-to-claude `.env` path |
| `tests/config.test.ts` | Modify | Update env var keys to match new config shape |
| `tests/poller.test.ts` | Modify | Rename `TwilioMessage → GatewayMessage`, `TwilioClient → GatewayClient` in imports |
| `tests/gateway.test.ts` | Create | Tests for `GatewayClient.send()` and `GatewayClient.list()` using mocked fetch |

---

## smsgateway.me API primer

The app runs on the Android phone and connects to smsgateway.me's cloud relay. All calls use HTTP Basic Auth with your device login + password.

**Send SMS:**
```
POST https://smsgateway.me/api/v1/message
Authorization: Basic base64(login:password)
Content-Type: application/json

{ "phone": "+905xxxxxxxxx", "message": "hello", "device_id": 12345 }
```
Response: `{ "success": true, "result": [{ "id": "uuid", ... }] }`

**List received messages (poll):**
```
GET https://smsgateway.me/api/v1/message/inbox?deviceId=12345&from=<unix-ms>
Authorization: Basic base64(login:password)
```
Response: `{ "success": true, "result": [{ "id": "uuid", "number": "+905xx", "message": "body", "received_at": 1710000000000 }] }`

The `from` query param is a Unix timestamp in milliseconds — equivalent to Twilio's `dateSentAfter`. IDs are stable UUIDs for deduplication.

---

## Task 1: Fix env var loading in `.mcp.json.example`

**Files:**
- Modify: `.mcp.json.example`

The root cause: Bun loads `.env` from CWD. When Claude Code spawns the MCP subprocess, CWD is the host project (e.g. refutr), not sms-to-claude — so the `.env` is never found. Fix: pass `--env-file` with an absolute path.

- [ ] **Step 1: Update `.mcp.json.example`**

```json
{
  "mcpServers": {
    "sms": {
      "command": "bun",
      "args": [
        "--env-file", "/absolute/path/to/sms-to-claude/.env",
        "/absolute/path/to/sms-to-claude/src/index.ts"
      ]
    }
  }
}
```

> Note: both `/absolute/path/to/sms-to-claude` placeholders must be replaced with the real path when setting up. The README should say this clearly.

- [ ] **Step 2: Update the Setup section in README.md**

Replace the current step 3 block:

```markdown
**3. Register with Claude Code**

Copy `.mcp.json.example` to your project directory as `.mcp.json` and replace both `/absolute/path/to/sms-to-claude` placeholders with the real path to this repo:

```json
{
  "mcpServers": {
    "sms": {
      "command": "bun",
      "args": [
        "--env-file", "/Users/you/dev/sms-to-claude/.env",
        "/Users/you/dev/sms-to-claude/src/index.ts"
      ]
    }
  }
}
```

The `--env-file` flag tells Bun exactly where to find the credentials, regardless of which project directory Claude Code is running from.
```

- [ ] **Step 3: Commit**

```bash
git add .mcp.json.example README.md
git commit -m "fix: load .env via --env-file so MCP works from any project CWD"
```

---

## Task 2: Update config to remove Twilio, add gateway vars

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Replace `tests/config.test.ts` with:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const snapshot: Record<string, string | undefined> = {}
  const keys = [
    'GATEWAY_BASE_URL', 'GATEWAY_LOGIN', 'GATEWAY_PASSWORD',
    'GATEWAY_DEVICE_ID', 'ALLOWED_PHONE_NUMBERS', 'POLL_INTERVAL_MS',
  ]

  beforeEach(() => {
    keys.forEach(k => { snapshot[k] = process.env[k] })
    process.env.GATEWAY_BASE_URL = 'https://smsgateway.me/api/v1'
    process.env.GATEWAY_LOGIN = 'testlogin'
    process.env.GATEWAY_PASSWORD = 'testpass'
    process.env.GATEWAY_DEVICE_ID = '12345'
    process.env.ALLOWED_PHONE_NUMBERS = '+19876543210'
    delete process.env.POLL_INTERVAL_MS
  })

  afterEach(() => {
    keys.forEach(k => {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    })
  })

  test('loads required env vars with default poll interval', () => {
    const config = loadConfig()
    expect(config.gateway.baseUrl).toBe('https://smsgateway.me/api/v1')
    expect(config.gateway.login).toBe('testlogin')
    expect(config.gateway.password).toBe('testpass')
    expect(config.gateway.deviceId).toBe(12345)
    expect(config.allowedPhoneNumbers.has('+19876543210')).toBe(true)
    expect(config.pollIntervalMs).toBe(5000)
  })

  test('parses comma-separated ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, +2222, +3333'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(3)
    expect(config.allowedPhoneNumbers.has('+2222')).toBe(true)
  })

  test('uses custom POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = '10000'
    const config = loadConfig()
    expect(config.pollIntervalMs).toBe(10000)
  })

  test('throws on missing GATEWAY_BASE_URL', () => {
    delete process.env.GATEWAY_BASE_URL
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_BASE_URL')
  })

  test('throws on missing GATEWAY_LOGIN', () => {
    delete process.env.GATEWAY_LOGIN
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_LOGIN')
  })

  test('throws on missing GATEWAY_PASSWORD', () => {
    delete process.env.GATEWAY_PASSWORD
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_PASSWORD')
  })

  test('throws on missing GATEWAY_DEVICE_ID', () => {
    delete process.env.GATEWAY_DEVICE_ID
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_DEVICE_ID')
  })

  test('throws on non-numeric GATEWAY_DEVICE_ID', () => {
    process.env.GATEWAY_DEVICE_ID = 'abc'
    expect(() => loadConfig()).toThrow('GATEWAY_DEVICE_ID must be a number')
  })

  test('throws on missing ALLOWED_PHONE_NUMBERS', () => {
    delete process.env.ALLOWED_PHONE_NUMBERS
    expect(() => loadConfig()).toThrow('Missing required env var: ALLOWED_PHONE_NUMBERS')
  })

  test('throws on non-numeric POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = 'abc'
    expect(() => loadConfig()).toThrow('POLL_INTERVAL_MS must be a number')
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun test tests/config.test.ts
```
Expected: FAIL — `config.gateway` is undefined

- [ ] **Step 3: Rewrite `src/config.ts`**

```typescript
export interface Config {
  gateway: {
    baseUrl: string
    login: string
    password: string
    deviceId: number
  }
  allowedPhoneNumbers: Set<string>
  pollIntervalMs: number
}

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export function loadConfig(): Config {
  const deviceIdRaw = required('GATEWAY_DEVICE_ID')
  const deviceId = parseInt(deviceIdRaw, 10)
  if (isNaN(deviceId)) throw new Error(`GATEWAY_DEVICE_ID must be a number, got: "${deviceIdRaw}"`)

  const pollRaw = process.env.POLL_INTERVAL_MS ?? '5000'
  const pollIntervalMs = parseInt(pollRaw, 10)
  if (isNaN(pollIntervalMs)) throw new Error(`POLL_INTERVAL_MS must be a number, got: "${pollRaw}"`)

  return {
    gateway: {
      baseUrl: required('GATEWAY_BASE_URL'),
      login: required('GATEWAY_LOGIN'),
      password: required('GATEWAY_PASSWORD'),
      deviceId,
    },
    allowedPhoneNumbers: new Set(
      required('ALLOWED_PHONE_NUMBERS').split(',').map(n => n.trim())
    ),
    pollIntervalMs,
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun test tests/config.test.ts
```
Expected: all PASS

- [ ] **Step 5: Update `.env.example`**

```
GATEWAY_BASE_URL=https://smsgateway.me/api/v1
GATEWAY_LOGIN=your-smsgateway-login
GATEWAY_PASSWORD=your-smsgateway-password
GATEWAY_DEVICE_ID=12345
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx
POLL_INTERVAL_MS=5000
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts .env.example
git commit -m "feat: replace Twilio config with smsgateway.me gateway config"
```

---

## Task 3: Create `GatewayClient`

**Files:**
- Create: `src/gateway.ts`
- Create: `tests/gateway.test.ts`

The `GatewayClient` wraps the smsgateway.me REST API. It exposes two methods:
- `list(since: Date): Promise<GatewayMessage[]>` — poll inbox for new messages
- `send(to: string, body: string): Promise<void>` — send an outbound SMS

The `GatewayMessage` type replaces `TwilioMessage` everywhere — same shape, different field names internally.

- [ ] **Step 1: Write failing tests**

Create `tests/gateway.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { GatewayClient, type GatewayMessage } from '../src/gateway'

const BASE_CONFIG = {
  baseUrl: 'https://smsgateway.me/api/v1',
  login: 'testlogin',
  password: 'testpass',
  deviceId: 12345,
}

function makeApiMessage(overrides = {}) {
  return {
    id: 'uuid-1',
    number: '+19876543210',
    message: 'hello',
    received_at: new Date('2026-03-25T10:00:00Z').getTime(),
    ...overrides,
  }
}

describe('GatewayClient.list', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('calls inbox endpoint with correct auth, deviceId, and from timestamp', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    const since = new Date('2026-03-25T10:00:00Z')
    await client.list(since)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/message/inbox')
    expect(url).toContain('deviceId=12345')
    expect(url).toContain(`from=${since.getTime()}`)  // milliseconds, not seconds
    expect(opts.headers as Record<string, string>).toMatchObject({
      'Authorization': 'Basic ' + btoa('testlogin:testpass'),
    })
  })

  test('maps API response to GatewayMessage shape', async () => {
    const raw = makeApiMessage()
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: [raw] }), { status: 200 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    const messages = await client.list(new Date(0))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      sid: 'uuid-1',
      from: '+19876543210',
      body: 'hello',
    })
    expect(messages[0].dateSent).toBeInstanceOf(Date)
  })

  test('returns empty array when result is empty', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    const messages = await client.list(new Date())
    expect(messages).toHaveLength(0)
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.list(new Date())).rejects.toThrow('401')
  })
})

describe('GatewayClient.send', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('posts to message endpoint with correct payload', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: [{ id: 'uuid-2' }] }), { status: 200 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await client.send('+19876543210', 'hello world')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_CONFIG.baseUrl}/message`)  // exact path — not /message/inbox
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.phone).toBe('+19876543210')
    expect(body.message).toBe('hello world')
    expect(body.device_id).toBe(12345)
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Bad Request', { status: 400 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.send('+1234', 'hi')).rejects.toThrow('400')
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun test tests/gateway.test.ts
```
Expected: FAIL — `GatewayClient` does not exist

- [ ] **Step 3: Implement `src/gateway.ts`**

```typescript
export interface GatewayMessage {
  sid: string      // maps to API `id`
  from: string     // maps to API `number`
  body: string     // maps to API `message`
  dateSent: Date   // maps to API `received_at` (unix ms)
}

export interface GatewayConfig {
  baseUrl: string
  login: string
  password: string
  deviceId: number
}

export class GatewayClient {
  private auth: string

  constructor(private cfg: GatewayConfig) {
    this.auth = 'Basic ' + btoa(`${cfg.login}:${cfg.password}`)
  }

  private get headers() {
    return {
      'Authorization': this.auth,
      'Content-Type': 'application/json',
    }
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(url, { ...init, headers: { ...this.headers, ...(init.headers ?? {}) } })
    if (!res.ok) throw new Error(`Gateway API error: ${res.status} ${res.statusText}`)
    return res.json()
  }

  async list(since: Date): Promise<GatewayMessage[]> {
    const url = `${this.cfg.baseUrl}/message/inbox?deviceId=${this.cfg.deviceId}&from=${since.getTime()}`
    const data = (await this.request(url)) as { success: boolean; result: Array<{
      id: string; number: string; message: string; received_at: number
    }> }
    return data.result.map(m => ({
      sid: m.id,
      from: m.number,
      body: m.message,
      dateSent: new Date(m.received_at),
    }))
  }

  async send(to: string, body: string): Promise<void> {
    await this.request(`${this.cfg.baseUrl}/message`, {
      method: 'POST',
      body: JSON.stringify({ phone: to, message: body, device_id: this.cfg.deviceId }),
    })
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun test tests/gateway.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts tests/gateway.test.ts
git commit -m "feat: add GatewayClient wrapping smsgateway.me REST API"
```

---

## Task 4: Update `Poller` to use `GatewayClient`

**Files:**
- Modify: `src/poller.ts`
- Modify: `tests/poller.test.ts`

The `Poller` is already well-abstracted — it only needs the interface types renamed and the `list()` call signature adjusted (passes `since: Date`, same as before).

- [ ] **Step 1: Update `tests/poller.test.ts`** — rename imports only

```typescript
// Change the import line from:
import { Poller, VERDICT_REGEX, type TwilioMessage, type PollContext } from '../src/poller'

// To:
import { Poller, VERDICT_REGEX, type GatewayMessage, type PollContext } from '../src/poller'
```

Replace all `TwilioMessage` occurrences in the file with `GatewayMessage`. The `makeMsg()` helper and all test logic stays identical — only the type name changes.

The updated `makeMsg` helper:
```typescript
function makeMsg(overrides: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    sid: 'uuid-' + Math.random().toString(36).slice(2, 10),
    from: '+19876543210',
    body: 'hello claude',
    dateSent: new Date('2026-03-25T10:00:00Z'),
    ...overrides,
  }
}
```

The mock `ctx` shape changes from `twilioClient: { messages: { list } }` to `gatewayClient: { list }`. Also remove `twilioPhoneNumber` — the gateway filters by device on the server side, so it's no longer needed in `PollContext`:

```typescript
beforeEach(() => {
  onMessage = mock(async () => {})
  listMessages = mock(async () => [])
  ctx = {
    gatewayClient: { list: listMessages },  // PollContext only requires `list`, not `send`
    allowedPhoneNumbers: new Set(['+19876543210']),
    onMessage,
    // twilioPhoneNumber is gone — remove it entirely
  }
})
```

- [ ] **Step 2: Run poller tests — confirm they fail**

```bash
bun test tests/poller.test.ts
```
Expected: FAIL — type errors / wrong interface

- [ ] **Step 3: Rewrite `src/poller.ts`**

```typescript
import type { GatewayMessage, GatewayClient } from './gateway.js'

export { type GatewayMessage }
export const VERDICT_REGEX = /^(yes|no)\s+([a-z]{5})$/i

export interface PollContext {
  gatewayClient: Pick<GatewayClient, 'list'>
  allowedPhoneNumbers: Set<string>
  onMessage: (msg: GatewayMessage) => Promise<void>
  onVerdict?: (behavior: 'allow' | 'deny', requestId: string) => Promise<void>
}

export class Poller {
  private lastChecked: Date
  private processedSids = new Set<string>()

  constructor(private ctx: PollContext) {
    this.lastChecked = new Date()
  }

  async poll(): Promise<void> {
    const messages = await this.ctx.gatewayClient.list(this.lastChecked)

    const sorted = [...messages].sort(
      (a, b) => a.dateSent.getTime() - b.dateSent.getTime()
    )

    for (const msg of sorted) {
      if (this.processedSids.has(msg.sid)) continue
      if (!this.ctx.allowedPhoneNumbers.has(msg.from)) continue

      this.processedSids.add(msg.sid)

      const verdictMatch = msg.body.trim().match(VERDICT_REGEX)
      if (verdictMatch) {
        const behavior = verdictMatch[1].toLowerCase() === 'yes' ? 'allow' : 'deny'
        const requestId = verdictMatch[2].toLowerCase()
        await this.ctx.onVerdict?.(behavior, requestId)
        continue
      }

      await this.ctx.onMessage(msg)
    }

    this.lastChecked = new Date()
  }

  start(intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.poll().catch(err => {
        console.error('[sms-channel] poll error:', err)
      })
    }, intervalMs)
  }
}
```

- [ ] **Step 4: Run poller tests — confirm they pass**

```bash
bun test tests/poller.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts tests/poller.test.ts
git commit -m "refactor: replace TwilioClient with GatewayClient in Poller"
```

---

## Task 5: Update `index.ts` to wire up `GatewayClient`

**Files:**
- Modify: `src/index.ts`

Remove all Twilio imports and client construction. Replace `sendSms` with a call to `gatewayClient.send()`. The `Poller` now receives `gatewayClient` instead of `twilioClient`.

- [ ] **Step 1: Rewrite `src/index.ts`**

```typescript
#!/usr/bin/env bun
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { GatewayClient } from './gateway.js'
import { Poller } from './poller.js'
import { PermissionManager } from './permissions.js'

const MAX_SMS_CHARS = 1600
const TRUNCATED_SUFFIX = ' [truncated]'

const config = loadConfig()
const gatewayClient = new GatewayClient(config.gateway)
const owner = [...config.allowedPhoneNumbers][0] // single owner

// --- MCP server ---
const mcp = new Server(
  { name: 'sms', version: '0.2.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    // The "You are working on the refutr project." prefix from the original is intentionally
    // removed here to make this server project-agnostic. Users who want project-specific
    // context should add it via CLAUDE.md in their project, not hardcoded here.
    instructions:
      'Commands arrive via SMS from the owner as <channel source="sms" ...> tags. ' +
      'Always reply with the sms_reply tool when your work is done or when you need to ask something. ' +
      'Be concise — this is SMS. If sms_reply fails, log the error to the terminal.',
  },
)

function sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
  return (mcp as any).notification({ method, params })
}

async function sendSms(text: string): Promise<void> {
  const body = text.length > MAX_SMS_CHARS
    ? text.slice(0, MAX_SMS_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX
    : text
  await gatewayClient.send(owner, body)
}

// --- Permission manager ---
const permMgr = new PermissionManager({
  sendSms,
  sendVerdict: async (requestId, behavior) => {
    await sendNotification('notifications/claude/channel/permission', { request_id: requestId, behavior })
  },
})

// --- sms_reply tool ---
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'sms_reply',
    description: 'Send a message back to the owner via SMS',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'sms_reply') {
    const { text } = req.params.arguments as { text: string }
    try {
      await sendSms(text)
      return { content: [{ type: 'text', text: 'sent' }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: `Failed to send SMS: ${msg}` }],
        isError: true,
      }
    }
  }
  throw new Error(`Unknown tool: ${req.params.name}`)
})

// --- Permission request handler ---
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string().optional().default(''),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async notif => {
  const { request_id, tool_name, description, input_preview } = notif.params
  await permMgr.handleRequest(request_id, tool_name, description, input_preview)
})

// --- Poller ---
const poller = new Poller({
  gatewayClient,
  allowedPhoneNumbers: config.allowedPhoneNumbers,
  onMessage: async msg => {
    await sendNotification('notifications/claude/channel', {
      content: msg.body,
      meta: { from: msg.from, message_sid: msg.sid },
    })
  },
  onVerdict: async (behavior, requestId) => {
    await permMgr.handleVerdict(behavior, requestId)
  },
})

// --- Connect and start loops ---
try {
  await mcp.connect(new StdioServerTransport())
  poller.start(config.pollIntervalMs)
  permMgr.startSweep()
} catch (err) {
  console.error('[sms-channel] startup failed:', err)
  process.exit(1)
}
```

- [ ] **Step 2: Run full test suite**

```bash
bun test
```
Expected: all PASS (config, poller, permissions, gateway tests)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire GatewayClient into MCP server, remove Twilio; bump version to 0.2.0"
```

---

## Task 6: Remove Twilio dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Uninstall twilio**

```bash
bun remove twilio
```

- [ ] **Step 2: Run full test suite to confirm nothing broke**

```bash
bun test
```
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: remove twilio dependency"
```

---

## Task 7: Update README for Android gateway setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Requirements section**

Replace:
```markdown
- Twilio account with a phone number (~$1/month + pennies per SMS)
```
With:
```markdown
- An Android phone (any cheap/old one) with a Turkish SIM card
- [SMS Gateway for Android](https://smsgateway.me) app installed and running on that phone
- A smsgateway.me account (free tier available)
```

- [ ] **Step 2: Update the env vars block in Setup section**

```
GATEWAY_BASE_URL=https://smsgateway.me/api/v1
GATEWAY_LOGIN=your-smsgateway-login
GATEWAY_PASSWORD=your-smsgateway-password
GATEWAY_DEVICE_ID=12345            # found in the smsgateway.me dashboard
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx # your personal number (allowlist)
POLL_INTERVAL_MS=5000              # optional, defaults to 5s
```

- [ ] **Step 3: Add a "Getting your Device ID" note**

After the env block, add:
```markdown
> **Finding your Device ID:** Open the smsgateway.me web dashboard → Devices. The numeric ID appears next to your registered phone.
```

- [ ] **Step 4: Update the Mermaid diagram** — replace `Twilio` node label with `SMS Gateway\n(Android phone)`

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for Android SMS gateway setup"
```

---

## Verification

After all tasks, do a full end-to-end smoke test:

```bash
# 1. Confirm no twilio references remain in src/
grep -r "twilio" src/   # should return nothing

# 2. All tests pass
bun test

# 3. TypeScript checks clean
bun tsc --noEmit
```
