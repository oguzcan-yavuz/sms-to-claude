# Android SMS Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Twilio with an Android phone running [capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway) (open-source, local server mode — no cloud relay), and fix the env var loading bug that breaks the MCP when launched from another project.

**Architecture:** Introduce a thin `GatewayClient` abstraction in `src/gateway.ts` for sending SMS, and replace the `Poller` (polling) with a `WebhookReceiver` in `src/webhook-receiver.ts` (small HTTP server that receives POSTs from the Android app when messages arrive). The `PermissionManager` is untouched. The env-var bug is fixed by adding `--env-file <absolute-path>` to the bun args in `.mcp.json.example`.

**Key architectural shift from old plan:** The old design polled for inbound messages (`GET /inbox`). capcom6 delivers inbound messages via webhooks — the Android app POSTs to a URL on your machine when an SMS arrives. The MCP server exposes a local HTTP endpoint for this.

**Tech Stack:** Bun, capcom6 REST API (fetch/no extra dep), `@modelcontextprotocol/sdk`, Zod

---

## File map

| File | Action | What changes |
|---|---|---|
| `src/config.ts` | Modify | Remove Twilio block; add `gateway` block (baseUrl, login, password) + `webhookUrl` + `webhookPort` |
| `src/gateway.ts` | Create | `GatewayMessage` type + `GatewayClient` class: `send()` + `registerWebhook()` |
| `src/webhook-receiver.ts` | Create | `WebhookReceiver` class: HTTP server that receives inbound SMS POSTs from the phone |
| `src/poller.ts` | Delete | Replaced by `webhook-receiver.ts` |
| `src/index.ts` | Modify | Remove Twilio + Poller; import `GatewayClient` + `WebhookReceiver`; start webhook server |
| `package.json` | Modify | Remove `twilio` dependency |
| `.env.example` | Modify | Replace Twilio vars with gateway + webhook vars |
| `.mcp.json.example` | Modify | Add `--env-file` arg pointing to absolute sms-to-claude `.env` path |
| `tests/config.test.ts` | Modify | Update env var keys to match new config shape |
| `tests/poller.test.ts` | Delete | Replaced by `tests/webhook-receiver.test.ts` |
| `tests/gateway.test.ts` | Create | Tests for `GatewayClient.send()` and `GatewayClient.registerWebhook()` using mocked fetch |
| `tests/webhook-receiver.test.ts` | Create | Tests for `WebhookReceiver` message parsing, allowlist filtering, verdict routing |

---

## capcom6/android-sms-gateway API primer

The Android app runs a local HTTP server on port 8080. All calls use HTTP Basic Auth.

**Send SMS:**
```
POST http://<phone-ip>:8080/api/v1/message
Authorization: Basic base64(login:password)
Content-Type: application/json

{ "phoneNumbers": ["+905xxxxxxxxx"], "textMessage": { "text": "hello" } }
```
Response 202: `{ "id": "uuid", "state": "Pending", "recipients": [{ "phoneNumber": "+905x", "state": "Pending" }] }`

**Register webhook (so phone knows where to POST incoming messages):**
```
POST http://<phone-ip>:8080/api/v1/webhooks
Authorization: Basic base64(login:password)
Content-Type: application/json

{ "url": "http://<mcp-machine-ip>:8081/webhook", "event": "sms:received" }
```

**Incoming SMS webhook payload (POST from phone → MCP server):**
```json
{
  "event": "sms:received",
  "id": "webhook-uuid",
  "payload": {
    "messageId": "uuid",
    "message": "hello claude",
    "sender": "+905xxxxxxxxx",
    "recipient": "+905yyyyy",
    "simNumber": 1,
    "receivedAt": "2026-03-25T10:00:00Z"
  }
}
```

**`GatewayMessage` field mapping:**
| `GatewayMessage` field | Source field |
|---|---|
| `sid` | `payload.messageId` |
| `from` | `payload.sender` |
| `body` | `payload.message` |
| `dateSent` | `new Date(payload.receivedAt)` |

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

## Task 2: Update config to remove Twilio, add gateway + webhook vars

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
    'WEBHOOK_URL', 'WEBHOOK_PORT',
    'ALLOWED_PHONE_NUMBERS', 'POLL_INTERVAL_MS',
  ]

  beforeEach(() => {
    keys.forEach(k => { snapshot[k] = process.env[k] })
    process.env.GATEWAY_BASE_URL = 'http://192.168.1.5:8080'
    process.env.GATEWAY_LOGIN = 'testlogin'
    process.env.GATEWAY_PASSWORD = 'testpass'
    process.env.WEBHOOK_URL = 'http://192.168.1.100:8081/webhook'
    process.env.ALLOWED_PHONE_NUMBERS = '+19876543210'
    delete process.env.WEBHOOK_PORT
    delete process.env.POLL_INTERVAL_MS
  })

  afterEach(() => {
    keys.forEach(k => {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    })
  })

  test('loads required env vars with defaults', () => {
    const config = loadConfig()
    expect(config.gateway.baseUrl).toBe('http://192.168.1.5:8080')
    expect(config.gateway.login).toBe('testlogin')
    expect(config.gateway.password).toBe('testpass')
    expect(config.webhookUrl).toBe('http://192.168.1.100:8081/webhook')
    expect(config.webhookPort).toBe(8081)
    expect(config.allowedPhoneNumbers.has('+19876543210')).toBe(true)
  })

  test('uses explicit WEBHOOK_PORT over URL-derived port', () => {
    process.env.WEBHOOK_PORT = '9000'
    const config = loadConfig()
    expect(config.webhookPort).toBe(9000)
  })

  test('parses comma-separated ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, +2222, +3333'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(3)
    expect(config.allowedPhoneNumbers.has('+2222')).toBe(true)
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

  test('throws on missing WEBHOOK_URL', () => {
    delete process.env.WEBHOOK_URL
    expect(() => loadConfig()).toThrow('Missing required env var: WEBHOOK_URL')
  })

  test('throws on missing ALLOWED_PHONE_NUMBERS', () => {
    delete process.env.ALLOWED_PHONE_NUMBERS
    expect(() => loadConfig()).toThrow('Missing required env var: ALLOWED_PHONE_NUMBERS')
  })

  test('throws if WEBHOOK_URL has no parseable port', () => {
    process.env.WEBHOOK_URL = 'http://192.168.1.100/webhook'  // no port in URL
    delete process.env.WEBHOOK_PORT
    expect(() => loadConfig()).toThrow('WEBHOOK_PORT')
  })

  test('throws on non-numeric WEBHOOK_PORT', () => {
    process.env.WEBHOOK_PORT = 'abc'
    expect(() => loadConfig()).toThrow('WEBHOOK_PORT must be a number')
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun test tests/config.test.ts
```
Expected: FAIL — `config.gateway` / `config.webhookUrl` undefined

- [ ] **Step 3: Rewrite `src/config.ts`**

```typescript
export interface Config {
  gateway: {
    baseUrl: string
    login: string
    password: string
  }
  webhookUrl: string
  webhookPort: number
  allowedPhoneNumbers: Set<string>
}

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export function loadConfig(): Config {
  const webhookUrl = required('WEBHOOK_URL')

  let webhookPort: number
  const portRaw = process.env.WEBHOOK_PORT
  if (portRaw) {
    const parsed = parseInt(portRaw, 10)
    if (isNaN(parsed)) throw new Error(`WEBHOOK_PORT must be a number, got: "${portRaw}"`)
    webhookPort = parsed
  } else {
    const portFromUrl = new URL(webhookUrl).port
    if (!portFromUrl) throw new Error('WEBHOOK_PORT must be set (could not derive port from WEBHOOK_URL)')
    webhookPort = parseInt(portFromUrl, 10)
  }

  return {
    gateway: {
      baseUrl: required('GATEWAY_BASE_URL'),
      login: required('GATEWAY_LOGIN'),
      password: required('GATEWAY_PASSWORD'),
    },
    webhookUrl,
    webhookPort,
    allowedPhoneNumbers: new Set(
      required('ALLOWED_PHONE_NUMBERS').split(',').map(n => n.trim())
    ),
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
GATEWAY_BASE_URL=http://192.168.1.5:8080
GATEWAY_LOGIN=your-smsgateway-login
GATEWAY_PASSWORD=your-smsgateway-password
WEBHOOK_URL=http://192.168.1.100:8081/webhook
WEBHOOK_PORT=8081
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts .env.example
git commit -m "feat: replace Twilio config with capcom6 gateway + webhook config"
```

---

## Task 3: Create `GatewayClient`

**Files:**
- Create: `src/gateway.ts`
- Create: `tests/gateway.test.ts`

The `GatewayClient` wraps the capcom6 REST API. It exposes two methods:
- `send(to: string, body: string): Promise<void>` — send an outbound SMS
- `registerWebhook(webhookUrl: string): Promise<void>` — register webhook with the phone so it knows where to POST inbound messages

`GatewayMessage` is the shared type for inbound messages (parsed from webhook payloads by `WebhookReceiver`).

- [ ] **Step 1: Write failing tests**

Create `tests/gateway.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { GatewayClient } from '../src/gateway'

const BASE_CONFIG = {
  baseUrl: 'http://192.168.1.5:8080',
  login: 'testlogin',
  password: 'testpass',
}

describe('GatewayClient.send', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('posts to /api/v1/message with correct payload and auth', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 'uuid-1', state: 'Pending', recipients: [] }), { status: 202 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await client.send('+19876543210', 'hello world')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_CONFIG.baseUrl}/api/v1/message`)
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.phoneNumbers).toEqual(['+19876543210'])
    expect(body.textMessage.text).toBe('hello world')
    expect((opts.headers as Record<string, string>)['Authorization'])
      .toBe('Basic ' + btoa('testlogin:testpass'))
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Bad Request', { status: 400 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.send('+1234', 'hi')).rejects.toThrow('400')
  })
})

describe('GatewayClient.registerWebhook', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('posts to /api/v1/webhooks with url and sms:received event', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 'webhook-id' }), { status: 201 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await client.registerWebhook('http://192.168.1.100:8081/webhook')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_CONFIG.baseUrl}/api/v1/webhooks`)
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.url).toBe('http://192.168.1.100:8081/webhook')
    expect(body.event).toBe('sms:received')
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.registerWebhook('http://x')).rejects.toThrow('401')
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
  sid: string      // maps to webhook payload.messageId
  from: string     // maps to webhook payload.sender
  body: string     // maps to webhook payload.message
  dateSent: Date   // maps to webhook payload.receivedAt
}

export interface GatewayConfig {
  baseUrl: string
  login: string
  password: string
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

  async send(to: string, body: string): Promise<void> {
    await this.request(`${this.cfg.baseUrl}/api/v1/message`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumbers: [to],
        textMessage: { text: body },
      }),
    })
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    await this.request(`${this.cfg.baseUrl}/api/v1/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, event: 'sms:received' }),
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
git commit -m "feat: add GatewayClient wrapping capcom6 android-sms-gateway REST API"
```

---

## Task 4: Replace `Poller` with `WebhookReceiver`

**Files:**
- Create: `src/webhook-receiver.ts`
- Create: `tests/webhook-receiver.test.ts`
- Delete: `src/poller.ts`
- Delete: `tests/poller.test.ts`

The `WebhookReceiver` replaces the `Poller`. Instead of polling on an interval, it starts a lightweight HTTP server (Bun.serve) that the Android phone POSTs to. The `ReceiverContext` interface mirrors `PollContext` so `index.ts` wiring stays nearly identical.

- [ ] **Step 1: Write failing tests**

Create `tests/webhook-receiver.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { WebhookReceiver, VERDICT_REGEX, type ReceiverContext } from '../src/webhook-receiver'
import type { GatewayMessage } from '../src/gateway'

function makeWebhookPayload(overrides: Partial<{
  messageId: string; message: string; sender: string; receivedAt: string
}> = {}) {
  return {
    event: 'sms:received',
    id: 'webhook-uuid',
    payload: {
      messageId: overrides.messageId ?? 'msg-uuid-1',
      message: overrides.message ?? 'hello claude',
      sender: overrides.sender ?? '+19876543210',
      recipient: '+19999999999',
      simNumber: 1,
      receivedAt: overrides.receivedAt ?? '2026-03-25T10:00:00Z',
    },
  }
}

async function postWebhook(receiver: WebhookReceiver, payload: object): Promise<Response> {
  return receiver.handleRequest(
    new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

describe('WebhookReceiver', () => {
  let onMessage: ReturnType<typeof mock>
  let onVerdict: ReturnType<typeof mock>
  let ctx: ReceiverContext

  beforeEach(() => {
    onMessage = mock(async () => {})
    onVerdict = mock(async () => {})
    ctx = {
      allowedPhoneNumbers: new Set(['+19876543210']),
      onMessage,
      onVerdict,
    }
  })

  test('processes a valid inbound SMS and calls onMessage', async () => {
    const receiver = new WebhookReceiver(ctx)
    const res = await postWebhook(receiver, makeWebhookPayload())

    expect(res.status).toBe(200)
    expect(onMessage).toHaveBeenCalledTimes(1)
    const msg: GatewayMessage = onMessage.mock.calls[0][0]
    expect(msg.sid).toBe('msg-uuid-1')
    expect(msg.from).toBe('+19876543210')
    expect(msg.body).toBe('hello claude')
    expect(msg.dateSent).toBeInstanceOf(Date)
  })

  test('ignores messages from numbers not in allowedPhoneNumbers', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ sender: '+10000000000' }))

    expect(onMessage).not.toHaveBeenCalled()
    expect(onVerdict).not.toHaveBeenCalled()
  })

  test('deduplicates messages with the same messageId', async () => {
    const receiver = new WebhookReceiver(ctx)
    const payload = makeWebhookPayload()
    await postWebhook(receiver, payload)
    await postWebhook(receiver, payload)

    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  test('routes verdict message to onVerdict instead of onMessage', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ message: 'yes abcde' }))

    expect(onVerdict).toHaveBeenCalledTimes(1)
    expect(onVerdict.mock.calls[0]).toEqual(['allow', 'abcde'])
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('routes "no" verdict correctly', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ message: 'no abcde' }))

    expect(onVerdict).toHaveBeenCalledTimes(1)
    expect(onVerdict.mock.calls[0]).toEqual(['deny', 'abcde'])
  })

  test('returns 400 for non-POST requests', async () => {
    const receiver = new WebhookReceiver(ctx)
    const res = await receiver.handleRequest(
      new Request('http://localhost/webhook', { method: 'GET' })
    )
    expect(res.status).toBe(400)
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('returns 400 for unknown event types', async () => {
    const receiver = new WebhookReceiver(ctx)
    const payload = { event: 'sms:sent', id: 'x', payload: {} }
    const res = await postWebhook(receiver, payload)
    expect(res.status).toBe(400)
  })
})

describe('VERDICT_REGEX', () => {
  test('matches "yes abcde"', () => {
    expect('yes abcde'.match(VERDICT_REGEX)).toBeTruthy()
  })
  test('matches "NO ABCDE" case-insensitively', () => {
    expect('NO ABCDE'.match(VERDICT_REGEX)).toBeTruthy()
  })
  test('does not match plain messages', () => {
    expect('hello world'.match(VERDICT_REGEX)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun test tests/webhook-receiver.test.ts
```
Expected: FAIL — `WebhookReceiver` does not exist

- [ ] **Step 3: Implement `src/webhook-receiver.ts`**

```typescript
import type { GatewayMessage } from './gateway.js'

export { type GatewayMessage }
export const VERDICT_REGEX = /^(yes|no)\s+([a-z]{5})$/i

export interface ReceiverContext {
  allowedPhoneNumbers: Set<string>
  onMessage: (msg: GatewayMessage) => Promise<void>
  onVerdict?: (behavior: 'allow' | 'deny', requestId: string) => Promise<void>
}

export class WebhookReceiver {
  private processedSids = new Set<string>()

  constructor(private ctx: ReceiverContext) {}

  async handleRequest(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const payload = body as {
      event: string
      payload: {
        messageId: string
        message: string
        sender: string
        receivedAt: string
      }
    }

    if (payload.event !== 'sms:received') {
      return new Response('Ignored', { status: 400 })
    }

    const { messageId, message, sender, receivedAt } = payload.payload

    if (!this.ctx.allowedPhoneNumbers.has(sender)) return new Response('OK')
    if (this.processedSids.has(messageId)) return new Response('OK')

    this.processedSids.add(messageId)

    const msg: GatewayMessage = {
      sid: messageId,
      from: sender,
      body: message,
      dateSent: new Date(receivedAt),
    }

    const verdictMatch = message.trim().match(VERDICT_REGEX)
    if (verdictMatch) {
      const behavior = verdictMatch[1].toLowerCase() === 'yes' ? 'allow' : 'deny'
      const requestId = verdictMatch[2].toLowerCase()
      await this.ctx.onVerdict?.(behavior, requestId)
      return new Response('OK')
    }

    await this.ctx.onMessage(msg)
    return new Response('OK')
  }

  start(port: number): ReturnType<typeof Bun.serve> {
    const self = this
    return Bun.serve({
      port,
      fetch(req) {
        return self.handleRequest(req).catch(err => {
          console.error('[sms-channel] webhook error:', err)
          return new Response('Internal error', { status: 500 })
        })
      },
    })
  }
}
```

- [ ] **Step 4: Run webhook receiver tests — confirm they pass**

```bash
bun test tests/webhook-receiver.test.ts
```
Expected: all PASS

- [ ] **Step 5: Delete old poller files**

```bash
rm src/poller.ts tests/poller.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/webhook-receiver.ts tests/webhook-receiver.test.ts
git rm src/poller.ts tests/poller.test.ts
git commit -m "feat: replace Poller (polling) with WebhookReceiver (Bun.serve HTTP server)"
```

---

## Task 5: Update `index.ts` to wire up `GatewayClient` + `WebhookReceiver`

**Files:**
- Modify: `src/index.ts`

Remove all Twilio imports. Replace `Poller` with `WebhookReceiver`. On startup, register the webhook with the Android phone so it knows where to POST.

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
import { WebhookReceiver } from './webhook-receiver.js'
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

// --- Webhook receiver ---
const receiver = new WebhookReceiver({
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

// --- Connect and start ---
try {
  await mcp.connect(new StdioServerTransport())
  receiver.start(config.webhookPort)
  await gatewayClient.registerWebhook(config.webhookUrl)
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
Expected: all PASS (config, gateway, webhook-receiver, permissions tests)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire GatewayClient + WebhookReceiver into MCP server, remove Twilio; bump version to 0.2.0"
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
- An Android phone (any cheap/old one) with the [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway) app installed
- Both the Android phone and your Mac on the same local network
```

- [ ] **Step 2: Update the env vars block in Setup section**

```
GATEWAY_BASE_URL=http://192.168.1.5:8080     # Android phone's local IP + port 8080
GATEWAY_LOGIN=your-gateway-login
GATEWAY_PASSWORD=your-gateway-password
WEBHOOK_URL=http://192.168.1.100:8081/webhook # This machine's local IP, any free port
WEBHOOK_PORT=8081                             # Port for the local webhook server (optional if in WEBHOOK_URL)
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx            # Your personal number (allowlist)
```

- [ ] **Step 3: Add a "Finding your gateway credentials" note**

After the env block, add:
```markdown
> **Finding your credentials:** Open the SMS Gateway app on the Android phone → tap the hamburger menu → Settings → API. Your login and password are shown there. The phone's local IP is shown on the Local Server screen.
```

- [ ] **Step 4: Update the Mermaid diagram** — replace `Twilio` node label with `SMS Gateway\n(Android phone)`

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for Android SMS gateway (capcom6) setup"
```

---

## Verification

After all tasks, do a full end-to-end smoke test:

```bash
# 1. Confirm no twilio references remain in src/
grep -r "twilio" src/   # should return nothing

# 2. Confirm no poller references remain
grep -r "poller\|Poller" src/   # should return nothing

# 3. All tests pass
bun test

# 4. TypeScript checks clean
bun tsc --noEmit
```
