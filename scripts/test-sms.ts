// scripts/test-sms.ts — test Twilio integration without Claude Code
import twilio from 'twilio'
import { loadConfig } from '../src/config'
import { Poller } from '../src/poller'

const config = loadConfig()
const client = twilio(config.twilio.accountSid, config.twilio.authToken)

// 1. Send a test SMS to yourself
console.log('Sending test SMS...')
await client.messages.create({
    body: 'sms-to-claude test: outbound works',
    from: config.twilio.phoneNumber,
    to: [...config.allowedPhoneNumbers][0],
})
console.log('Sent.')

// 2. Start polling and log whatever arrives
console.log(`Polling for inbound SMS (send one to ${config.twilio.phoneNumber})...`)
const poller = new Poller({
    twilioClient: client as any,
    twilioPhoneNumber: config.twilio.phoneNumber,
    allowedPhoneNumbers: config.allowedPhoneNumbers,
    onMessage: async msg => {
        console.log(`[inbound] from=${msg.from} body="${msg.body}"`)
        // Echo it back so you can verify the full loop
        await client.messages.create({
            body: `echo: ${msg.body}`,
            from: config.twilio.phoneNumber,
            to: msg.from,
        })
        console.log('[reply sent]')
    },
    onVerdict: async (behavior, id) => {
        console.log(`[verdict] ${behavior} ${id}`)
    },
})

poller.start(config.pollIntervalMs)
