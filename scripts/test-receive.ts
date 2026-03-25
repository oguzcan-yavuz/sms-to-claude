// scripts/test-receive.ts — test inbound SMS without Claude Code
// Starts the webhook server and logs any SMS that arrives from your allowlisted number.
// Also registers the webhook with the Android gateway so the phone knows where to POST.
//
// Usage:
//   bun scripts/test-receive.ts
//
// Then either send a real SMS from your phone, or simulate one with curl:
//   curl -X POST http://localhost:<WEBHOOK_PORT>/webhook \
//     -H 'Content-Type: application/json' \
//     -d '{"event":"sms:received","id":"test-1","payload":{"messageId":"msg-001","message":"hello","sender":"+90xxxxxxxxx","recipient":"+90yyyyy","simNumber":1,"receivedAt":"2026-03-26T10:00:00Z"}}'

import { loadConfig } from '../src/config'
import { GatewayClient } from '../src/gateway'
import { WebhookReceiver } from '../src/webhook-receiver'

const config = loadConfig()
const client = new GatewayClient(config.gateway)

const receiver = new WebhookReceiver({
  allowedPhoneNumbers: config.allowedPhoneNumbers,
  onMessage: async msg => {
    console.log(`[inbound] from=${msg.from} body="${msg.body}" sid=${msg.sid}`)
  },
  onVerdict: async (behavior, id) => {
    console.log(`[verdict] ${behavior} ${id}`)
  },
})

receiver.start(config.webhookPort)
console.log(`Webhook server listening on port ${config.webhookPort}`)

console.log('Registering webhook with Android gateway...')
await client.registerWebhook(config.webhookUrl)
console.log(`Webhook registered: ${config.webhookUrl}`)

console.log(`\nReady. Send an SMS from your phone or use curl to simulate one.`)
console.log(`Allowed senders: ${[...config.allowedPhoneNumbers].join(', ')}`)
