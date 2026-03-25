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
