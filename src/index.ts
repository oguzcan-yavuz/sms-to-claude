#!/usr/bin/env bun
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { appendFileSync } from 'fs'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { GatewayClient } from './gateway.js'
import { WebhookReceiver } from './webhook-receiver.js'
import { PermissionManager } from './permissions.js'

const MAX_SMS_CHARS = 1600
const HEARTBEAT_INTERVAL_MS = 60_000
const TRUNCATED_SUFFIX = ' [truncated]'
const LOG_FILE = '/tmp/sms-to-claude.log'

function log(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`
  process.stderr.write(line)
  appendFileSync(LOG_FILE, line)
}

let taskStartedAt: number | null = null
let lastSmsAt: number | null = null
let silenceWarningSent = false

const config = loadConfig()
const gatewayClient = new GatewayClient(config.gateway)
const owner = [...config.allowedPhoneNumbers][0] // single owner

// --- MCP server ---
const mcp = new McpServer(
  { name: 'sms', version: '0.2.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions:
      'Commands arrive via SMS from the owner as <channel source="sms" ...> tags. ' +
      'IMPORTANT: You MUST call sms_update every 2-3 tool calls during long-running tasks. ' +
      'The owner has no other way to know what you are doing — silence is indistinguishable from being stuck. ' +
      'Group recent actions into a single brief update (e.g. "Read 5 files, running tests now..."). ' +
      'Use sms_reply only when your work is fully complete or when you need to ask the owner something. ' +
      'Be concise — this is SMS. If sms_reply fails, log the error to the terminal.',
  },
)

function sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
  return mcp.server.notification({ method, params })
}

async function sendSms(text: string): Promise<void> {
  const body = text.length > MAX_SMS_CHARS
    ? text.slice(0, MAX_SMS_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX
    : text
  lastSmsAt = Date.now()
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
mcp.registerTool(
  'sms_reply',
  {
    description: 'Send a message back to the owner via SMS',
    inputSchema: { text: z.string().describe('The message to send') },
  },
  async ({ text }) => {
    try {
      taskStartedAt = null
      await sendSms(text)
      return { content: [{ type: 'text', text: 'sent' }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: `Failed to send SMS: ${msg}` }],
        isError: true,
      }
    }
  },
)

// --- sms_update tool ---
mcp.registerTool(
  'sms_update',
  {
    description: 'Send a progress update to the owner mid-task without signalling completion. Use this to report what you are currently doing.',
    inputSchema: { text: z.string().describe('Short status update, e.g. "Running migrations..."') },
  },
  async ({ text }) => {
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
  },
)

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

mcp.server.setNotificationHandler(PermissionRequestSchema, async notif => {
  const { request_id, tool_name, description, input_preview } = notif.params
  await permMgr.handleRequest(request_id, tool_name, description, input_preview)
})

// --- Webhook receiver ---
const receiver = new WebhookReceiver({
  allowedPhoneNumbers: config.allowedPhoneNumbers,
  signingKey: config.webhookSigningKey,
  onMessage: async msg => {
    taskStartedAt = Date.now()
    lastSmsAt = null
    silenceWarningSent = false
    log('[sms-channel] forwarding to claude:', msg.body)
    await sendNotification('notifications/claude/channel', {
      content: msg.body,
      meta: { from: msg.from, message_sid: msg.sid },
    })
    log('[sms-channel] notification sent')
  },
  onVerdict: async (behavior, requestId) => {
    await permMgr.handleVerdict(behavior, requestId)
  },
  onUnrecognizedVerdict: async (raw) => {
    const ids = permMgr.pendingIds()
    const hint = ids.length > 0
      ? `Pending: ${ids.map(id => `yes ${id} / no ${id}`).join(', ')}`
      : 'No pending permission requests.'
    await sendSms(`Could not parse verdict: "${raw}"\nExpected: yes [id] or no [id]\n${hint}`)
  },
})

// --- Connect and start ---
log('[sms-channel] starting...')
try {
  await mcp.connect(new StdioServerTransport())
  receiver.start(config.webhookPort)
  permMgr.startSweep()
  setInterval(async () => {
    if (taskStartedAt === null || silenceWarningSent) return
    const silentSince = lastSmsAt ?? taskStartedAt
    if (Date.now() - silentSince < HEARTBEAT_INTERVAL_MS) return
    silenceWarningSent = true
    const secs = Math.round((Date.now() - taskStartedAt) / 1000)
    await sendSms(`[no update from Claude in 1m — still running, ${Math.floor(secs / 60)}m${secs % 60}s elapsed]`)
  }, HEARTBEAT_INTERVAL_MS)
  log('[sms-channel] started, webhook listening on port', config.webhookPort)
} catch (err) {
  log('[sms-channel] startup failed:', err)
  process.exit(1)
}

try {
  await gatewayClient.registerWebhook(config.webhookUrl)
  log('[sms-channel] webhook registered:', config.webhookUrl)
} catch (err) {
  log('[sms-channel] webhook registration failed (is ngrok running?):', err)
}
