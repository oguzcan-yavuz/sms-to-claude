# SMS-to-Claude Channel: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP channel server that bridges Twilio SMS with Claude Code, enabling remote control of the refutr project via SMS from a regular phone.

**Architecture:** A Bun/TypeScript MCP server registered as a Claude Code channel. It polls Twilio every 5 seconds for inbound SMS, forwards them to Claude as channel notifications, exposes an `sms_reply` tool for Claude to SMS back, and relays permission prompts with approve/deny over SMS.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`, `twilio`, `zod`, `bun:test`

---

## File Map

| File | Responsibility |
|---|---|
| `src/config.ts` | Load and validate env vars; export typed `Config` |
| `src/poller.ts` | Twilio poll loop, deduplication, allowlist filtering, verdict detection |
| `src/permissions.ts` | Permission relay state, timeout sweep, verdict dispatch |
| `src/index.ts` | MCP server setup, tool registration, notification handlers, wiring |
| `tests/config.test.ts` | Unit tests for config loading |
| `tests/poller.test.ts` | Unit tests for poller with mocked Twilio client |
| `tests/permissions.test.ts` | Unit tests for permission manager |
| `.env.example` | Template for required env vars |
| `.mcp.json.example` | Template for registering server in refutr project |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `.gitignore` | Ignore `.env` and `node_modules` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "sms-to-claude",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.10.2",
    "twilio": "^5.4.0",
    "zod": "^3.24.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
```

- [ ] **Step 4: Create .env.example**

```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
ALLOWED_PHONE_NUMBERS=+90xxxxxxxxx
POLL_INTERVAL_MS=5000
```

- [ ] **Step 5: Install dependencies**

```bash
bun install
```

Expected: `node_modules/` created, `bun.lockb` generated.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example bun.lockb
git commit -m "chore: project scaffold"
```

---

## Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/config.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const snapshot: Record<string, string | undefined> = {}
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'ALLOWED_PHONE_NUMBERS', 'POLL_INTERVAL_MS']

  beforeEach(() => {
    keys.forEach(k => { snapshot[k] = process.env[k] })
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'
    process.env.TWILIO_AUTH_TOKEN = 'authtest'
    process.env.TWILIO_PHONE_NUMBER = '+11234567890'
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
    expect(config.twilio.accountSid).toBe('ACtest')
    expect(config.twilio.authToken).toBe('authtest')
    expect(config.twilio.phoneNumber).toBe('+11234567890')
    expect(config.allowedPhoneNumbers.has('+19876543210')).toBe(true)
    expect(config.pollIntervalMs).toBe(5000)
  })

  test('parses comma-separated ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, +2222, +3333'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(3)
    expect(config.allowedPhoneNumbers.has('+1111')).toBe(true)
    expect(config.allowedPhoneNumbers.has('+2222')).toBe(true)
    expect(config.allowedPhoneNumbers.has('+3333')).toBe(true)
  })

  test('uses custom POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = '10000'
    const config = loadConfig()
    expect(config.pollIntervalMs).toBe(10000)
  })

  test('throws on missing TWILIO_ACCOUNT_SID', () => {
    delete process.env.TWILIO_ACCOUNT_SID
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_ACCOUNT_SID')
  })

  test('throws on missing TWILIO_AUTH_TOKEN', () => {
    delete process.env.TWILIO_AUTH_TOKEN
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_AUTH_TOKEN')
  })

  test('throws on missing TWILIO_PHONE_NUMBER', () => {
    delete process.env.TWILIO_PHONE_NUMBER
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_PHONE_NUMBER')
  })

  test('throws on missing ALLOWED_PHONE_NUMBERS', () => {
    delete process.env.ALLOWED_PHONE_NUMBERS
    expect(() => loadConfig()).toThrow('Missing required env var: ALLOWED_PHONE_NUMBERS')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun test tests/config.test.ts
```

Expected: FAIL with `Cannot find module '../src/config'`

- [ ] **Step 3: Implement src/config.ts**

```typescript
// src/config.ts
export interface Config {
  twilio: {
    accountSid: string
    authToken: string
    phoneNumber: string
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
  return {
    twilio: {
      accountSid: required('TWILIO_ACCOUNT_SID'),
      authToken: required('TWILIO_AUTH_TOKEN'),
      phoneNumber: required('TWILIO_PHONE_NUMBER'),
    },
    allowedPhoneNumbers: new Set(
      required('ALLOWED_PHONE_NUMBERS').split(',').map(n => n.trim())
    ),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun test tests/config.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config module with env var loading"
```

---

## Task 3: Poller Module

**Files:**
- Create: `src/poller.ts`
- Create: `tests/poller.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/poller.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { Poller, VERDICT_REGEX, type TwilioMessage, type PollContext } from '../src/poller'

function makeMsg(overrides: Partial<TwilioMessage> = {}): TwilioMessage {
  return {
    sid: 'SM' + Math.random().toString(36).slice(2, 10),
    from: '+19876543210',
    body: 'hello claude',
    dateSent: new Date('2026-03-24T10:00:00Z'),
    ...overrides,
  }
}

describe('VERDICT_REGEX', () => {
  test('matches "yes abcde"', () => expect(VERDICT_REGEX.test('yes abcde')).toBe(true))
  test('matches "no abcde"', () => expect(VERDICT_REGEX.test('no abcde')).toBe(true))
  test('matches case-insensitively', () => expect(VERDICT_REGEX.test('YES ABCDE')).toBe(true))
  test('does not match plain text', () => expect(VERDICT_REGEX.test('yes please')).toBe(false))
  test('does not match partial nonce', () => expect(VERDICT_REGEX.test('yes abc')).toBe(false))
  test('does not match extra text after nonce', () => expect(VERDICT_REGEX.test('yes abcde extra')).toBe(false))
})

describe('Poller', () => {
  let onMessage: ReturnType<typeof mock>
  let listMessages: ReturnType<typeof mock>
  let ctx: PollContext

  beforeEach(() => {
    onMessage = mock(async () => {})
    listMessages = mock(async () => [])
    ctx = {
      twilioClient: { messages: { list: listMessages } },
      twilioPhoneNumber: '+11234567890',
      allowedPhoneNumbers: new Set(['+19876543210']),
      onMessage,
    }
  })

  test('calls onMessage for allowed sender', async () => {
    const msg = makeMsg()
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0][0]).toMatchObject({ sid: msg.sid, body: msg.body })
  })

  test('silently drops message from unknown sender', async () => {
    const msg = makeMsg({ from: '+10000000000' })
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('deduplicates: does not emit the same SID twice', async () => {
    const msg = makeMsg()
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    await poller.poll()
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  test('processes messages oldest-first when multiple arrive', async () => {
    const older = makeMsg({ sid: 'SM1', body: 'first', dateSent: new Date('2026-03-24T10:00:00Z') })
    const newer = makeMsg({ sid: 'SM2', body: 'second', dateSent: new Date('2026-03-24T10:00:01Z') })
    listMessages.mockResolvedValue([newer, older]) // API returns newest first
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage.mock.calls[0][0].body).toBe('first')
    expect(onMessage.mock.calls[1][0].body).toBe('second')
  })

  test('does not call onMessage for verdict-shaped message', async () => {
    const msg = makeMsg({ body: 'yes abcde' })
    listMessages.mockResolvedValue([msg])
    const onVerdict = mock(async () => {})
    const poller = new Poller({ ...ctx, onVerdict })
    await poller.poll()
    expect(onMessage).not.toHaveBeenCalled()
    expect(onVerdict).toHaveBeenCalledWith('allow', 'abcde')
  })

  test('calls onVerdict with deny for "no <id>"', async () => {
    const msg = makeMsg({ body: 'no abcde' })
    listMessages.mockResolvedValue([msg])
    const onVerdict = mock(async () => {})
    const poller = new Poller({ ...ctx, onVerdict })
    await poller.poll()
    expect(onVerdict).toHaveBeenCalledWith('deny', 'abcde')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun test tests/poller.test.ts
```

Expected: FAIL with `Cannot find module '../src/poller'`

- [ ] **Step 3: Implement src/poller.ts**

```typescript
// src/poller.ts
export const VERDICT_REGEX = /^(yes|no)\s+([a-z]{5})$/i

export interface TwilioMessage {
  sid: string
  from: string
  body: string
  dateSent: Date
}

export interface TwilioClient {
  messages: {
    list(params: { to: string; dateSentAfter?: Date }): Promise<TwilioMessage[]>
  }
}

export interface PollContext {
  twilioClient: TwilioClient
  twilioPhoneNumber: string
  allowedPhoneNumbers: Set<string>
  onMessage: (msg: TwilioMessage) => Promise<void>
  onVerdict?: (behavior: 'allow' | 'deny', requestId: string) => Promise<void>
}

export class Poller {
  private lastChecked: Date
  private processedSids = new Set<string>()

  constructor(private ctx: PollContext) {
    this.lastChecked = new Date()
  }

  async poll(): Promise<void> {
    const messages = await this.ctx.twilioClient.messages.list({
      to: this.ctx.twilioPhoneNumber,
      dateSentAfter: this.lastChecked,
    })

    const sorted = [...messages].sort(
      (a, b) => a.dateSent.getTime() - b.dateSent.getTime()
    )

    for (const msg of sorted) {
      if (this.processedSids.has(msg.sid)) continue
      if (!this.ctx.allowedPhoneNumbers.has(msg.from)) continue

      this.processedSids.add(msg.sid)
      if (msg.dateSent > this.lastChecked) {
        this.lastChecked = msg.dateSent
      }

      const verdictMatch = msg.body.trim().match(VERDICT_REGEX)
      if (verdictMatch) {
        const behavior = verdictMatch[1].toLowerCase() === 'yes' ? 'allow' : 'deny'
        const requestId = verdictMatch[2].toLowerCase()
        await this.ctx.onVerdict?.(behavior, requestId)
        continue
      }

      await this.ctx.onMessage(msg)
    }
  }

  start(intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => this.poll(), intervalMs)
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun test tests/poller.test.ts
```

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts tests/poller.test.ts
git commit -m "feat: poller module with dedup, allowlist, verdict detection"
```

---

## Task 4: Permission Manager Module

**Files:**
- Create: `src/permissions.ts`
- Create: `tests/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/permissions.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { PermissionManager, type PermissionsContext } from '../src/permissions'

function makeCtx(): { sendSms: ReturnType<typeof mock>; sendVerdict: ReturnType<typeof mock>; ctx: PermissionsContext } {
  const sendSms = mock(async (_text: string) => {})
  const sendVerdict = mock(async (_id: string, _behavior: 'allow' | 'deny') => {})
  return { sendSms, sendVerdict, ctx: { sendSms, sendVerdict } }
}

describe('PermissionManager', () => {
  test('sends formatted SMS on handleRequest', async () => {
    const { sendSms, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleRequest('abcde', 'Bash', 'rm -rf dist/', 'rm -rf dist/')
    expect(sendSms).toHaveBeenCalledTimes(1)
    const text: string = sendSms.mock.calls[0][0]
    expect(text).toContain('[Permission needed]')
    expect(text).toContain('Tool: Bash')
    expect(text).toContain('rm -rf dist/')
    expect(text).toContain('yes abcde')
    expect(text).toContain('no abcde')
  })

  test('sends verdict and removes from pending on matching handleVerdict', async () => {
    const { sendVerdict, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleRequest('abcde', 'Write', 'Write file', 'path/to/file')
    await mgr.handleVerdict('allow', 'abcde')
    expect(sendVerdict).toHaveBeenCalledWith('abcde', 'allow')
    expect(mgr.hasPending()).toBe(false)
  })

  test('sends unknown-ID SMS for stale nonce, does not call sendVerdict', async () => {
    const { sendSms, sendVerdict, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleVerdict('allow', 'zzzzz')
    expect(sendVerdict).not.toHaveBeenCalled()
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendSms.mock.calls[0][0]).toContain('Unknown permission ID')
  })

  test('sweepExpired removes timed-out entry and sends expiry SMS', async () => {
    const { sendSms, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx, -1) // timeout of -1ms = already expired
    await mgr.handleRequest('abcde', 'Bash', 'some command', '')
    await mgr.sweepExpired()
    expect(mgr.hasPending()).toBe(false)
    expect(sendSms).toHaveBeenCalledTimes(2) // once for request, once for expiry
    const expirySms: string = sendSms.mock.calls[1][0]
    expect(expirySms).toContain('abcde')
    expect(expirySms).toContain('expired')
  })

  test('sweepExpired does not remove non-expired entries', async () => {
    const { ctx } = makeCtx()
    const mgr = new PermissionManager(ctx, 10 * 60 * 1000) // 10 min timeout
    await mgr.handleRequest('abcde', 'Bash', 'some command', '')
    await mgr.sweepExpired()
    expect(mgr.hasPending()).toBe(true)
  })

  test('hasPending returns false when map is empty', () => {
    const { ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    expect(mgr.hasPending()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun test tests/permissions.test.ts
```

Expected: FAIL with `Cannot find module '../src/permissions'`

- [ ] **Step 3: Implement src/permissions.ts**

```typescript
// src/permissions.ts
interface PendingPermission {
  tool_name: string
  description: string
  expires: number
}

export interface PermissionsContext {
  sendSms: (text: string) => Promise<void>
  sendVerdict: (requestId: string, behavior: 'allow' | 'deny') => Promise<void>
}

export class PermissionManager {
  private pending = new Map<string, PendingPermission>()

  constructor(
    private ctx: PermissionsContext,
    private timeoutMs = 10 * 60 * 1000,
  ) {}

  async handleRequest(requestId: string, toolName: string, description: string, inputPreview: string): Promise<void> {
    this.pending.set(requestId, {
      tool_name: toolName,
      description,
      expires: Date.now() + this.timeoutMs,
    })

    const lines = [
      '[Permission needed]',
      `Tool: ${toolName}`,
      description,
      inputPreview ? `Input: ${inputPreview.slice(0, 100)}` : '',
      '',
      `Reply: yes ${requestId} OR no ${requestId}`,
    ].filter(l => l !== undefined && !(l === '' && lines?.indexOf(l) !== 4))

    // Build SMS text
    const sms = [
      '[Permission needed]',
      `Tool: ${toolName}`,
      description,
      ...(inputPreview ? [`Input: ${inputPreview.slice(0, 100)}`] : []),
      '',
      `Reply: yes ${requestId} OR no ${requestId}`,
    ].join('\n')

    await this.ctx.sendSms(sms)
  }

  async handleVerdict(behavior: 'allow' | 'deny', requestId: string): Promise<void> {
    if (!this.pending.has(requestId)) {
      await this.ctx.sendSms(`Unknown permission ID. It may have expired.`)
      return
    }
    this.pending.delete(requestId)
    await this.ctx.sendVerdict(requestId, behavior)
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }

  async sweepExpired(): Promise<void> {
    const now = Date.now()
    for (const [id, entry] of this.pending) {
      if (entry.expires <= now) {
        this.pending.delete(id)
        await this.ctx.sendSms(
          `Permission request ${id} expired. Answer in terminal if present.`
        )
      }
    }
  }

  startSweep(intervalMs = 60_000): ReturnType<typeof setInterval> {
    return setInterval(() => this.sweepExpired(), intervalMs)
  }
}
```

> **Note:** The `handleRequest` implementation above has a self-referencing bug in the `lines` filter. Use the explicit form with spread shown below the comment — delete the first `lines` array and keep only the `sms` constant.

- [ ] **Step 4: Fix the self-referencing bug in handleRequest**

Replace the entire `handleRequest` method body with:

```typescript
async handleRequest(requestId: string, toolName: string, description: string, inputPreview: string): Promise<void> {
  this.pending.set(requestId, {
    tool_name: toolName,
    description,
    expires: Date.now() + this.timeoutMs,
  })

  const sms = [
    '[Permission needed]',
    `Tool: ${toolName}`,
    description,
    ...(inputPreview ? [`Input: ${inputPreview.slice(0, 100)}`] : []),
    '',
    `Reply: yes ${requestId} OR no ${requestId}`,
  ].join('\n')

  await this.ctx.sendSms(sms)
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
bun test tests/permissions.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/permissions.ts tests/permissions.test.ts
git commit -m "feat: permission manager with relay, timeout sweep, stale nonce handling"
```

---

## Task 5: MCP Server (index.ts)

**Files:**
- Create: `src/index.ts`

No unit tests for this task — it wires the MCP stdio transport to Claude Code, which requires a live Claude Code session. Manual verification is in Task 6.

- [ ] **Step 1: Create src/index.ts**

```typescript
#!/usr/bin/env bun
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import twilio from 'twilio'
import { loadConfig } from './config.js'
import { Poller } from './poller.js'
import { PermissionManager } from './permissions.js'

const MAX_SMS_CHARS = 1600

const config = loadConfig()
const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken)

// --- MCP server ---
const mcp = new Server(
  { name: 'sms', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'You are working on the refutr project. Commands arrive via SMS from the owner as <channel source="sms" ...> tags. ' +
      'Always reply with the sms_reply tool when your work is done or when you need to ask something. ' +
      'Be concise — this is SMS. If sms_reply fails, log the error to the terminal.',
  },
)

// --- sendSms helper used by both the reply tool and PermissionManager ---
async function sendSms(text: string): Promise<void> {
  const body = text.length > MAX_SMS_CHARS ? text.slice(0, MAX_SMS_CHARS - 12) + ' [truncated]' : text
  await twilioClient.messages.create({
    body,
    from: config.twilio.phoneNumber,
    to: [...config.allowedPhoneNumbers][0], // single owner
  })
}

// --- Permission manager ---
const permMgr = new PermissionManager({
  sendSms,
  sendVerdict: async (requestId, behavior) => {
    await mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: { request_id: requestId, behavior },
    })
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
  twilioClient: twilioClient as any, // Twilio SDK types are compatible
  twilioPhoneNumber: config.twilio.phoneNumber,
  allowedPhoneNumbers: config.allowedPhoneNumbers,
  onMessage: async msg => {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: msg.body,
        meta: { from: msg.from, message_sid: msg.sid },
      },
    })
  },
  onVerdict: async (behavior, requestId) => {
    await permMgr.handleVerdict(behavior, requestId)
  },
})

// --- Connect and start loops ---
await mcp.connect(new StdioServerTransport())
poller.start(config.pollIntervalMs)
permMgr.startSweep()
```

- [ ] **Step 2: Verify TypeScript compiles without errors**

```bash
bun build src/index.ts --target bun --dry-run 2>&1 || bun --check src/index.ts
```

Expected: No type errors. (If `--check` flag isn't available in your Bun version, `bun run src/index.ts --help` will catch import errors.)

- [ ] **Step 3: Run all tests to confirm nothing is broken**

```bash
bun test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP channel server with SMS bridge, reply tool, permission relay"
```

---

## Task 6: Integration Setup & Verification

**Files:**
- Create: `.mcp.json.example`

- [ ] **Step 1: Create .mcp.json.example**

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

> Replace `/absolute/path/to/sms-to-claude` with the actual path on your machine (e.g., `/Users/oguzcanyavuz/dev/sms-to-claude`).

- [ ] **Step 2: Copy and fill .env**

```bash
cp .env.example .env
# Edit .env with real Twilio credentials and phone numbers
```

- [ ] **Step 3: Register the server in the refutr project**

In the refutr project directory, create or update `.mcp.json`:

```bash
# In refutr/ directory
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "sms": {
      "command": "bun",
      "args": ["/Users/oguzcanyavuz/dev/sms-to-claude/src/index.ts"]
    }
  }
}
EOF
```

- [ ] **Step 4: Start Claude Code with the channel enabled**

```bash
# From refutr/ directory
claude --dangerously-load-development-channels server:sms
```

Expected: Claude Code starts, you see the confirmation prompt for loading the development channel. Accept it. The `sms` server should appear as connected in `/mcp`.

- [ ] **Step 5: Verify channel is connected**

In the Claude Code session, run:
```
/mcp
```

Expected: `sms` appears with status `connected` and tools `sms_reply` listed.

- [ ] **Step 6: Smoke test — send an SMS**

Send an SMS from your allowed phone number to your Twilio number with text: `say hello back`

Expected within 10 seconds: Claude Code receives the message, responds, and you receive an SMS reply.

- [ ] **Step 7: Smoke test — permission relay**

Ask Claude to run a bash command that requires approval (e.g., `delete the dist/ directory`).

Expected: You receive an SMS with `[Permission needed]` and a `yes/no <id>` prompt. Reply `yes <id>`. Claude proceeds.

- [ ] **Step 8: Commit**

```bash
git add .mcp.json.example
git commit -m "chore: add MCP registration example and setup instructions"
```

---

## Prerequisites Checklist

Before running for the first time:

- [ ] Bun installed: `curl -fsSL https://bun.sh/install | bash`
- [ ] Claude Code v2.1.81+: `claude --version`
- [ ] Logged into claude.ai in Claude Code (not API key auth)
- [ ] Twilio account created, phone number purchased (~$1/month)
- [ ] `.env` filled with real credentials
- [ ] refutr `.mcp.json` pointing to correct absolute path
