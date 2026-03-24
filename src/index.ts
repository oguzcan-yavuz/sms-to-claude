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
    await (mcp as any).notification({
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
    await (mcp as any).notification({
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
