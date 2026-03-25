// scripts/test-sms.ts — smoke test the Android SMS gateway integration without Claude Code
import { loadConfig } from '../src/config'
import { GatewayClient } from '../src/gateway'

const config = loadConfig()
const client = new GatewayClient(config.gateway)
const owner = [...config.allowedPhoneNumbers][0]

// 1. Register webhook so inbound messages are delivered to this machine
console.log('Registering webhook...')
await client.registerWebhook(config.webhookUrl)
console.log('Webhook registered.')

// 2. Send a test SMS to yourself
console.log('Sending test SMS...')
await client.send(owner, 'sms-to-claude test: outbound works')
console.log('Sent.')

console.log(`Start the MCP server to receive inbound SMS at ${config.webhookUrl}`)
