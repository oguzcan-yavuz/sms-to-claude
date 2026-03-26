import { createHmac, timingSafeEqual } from 'crypto'
import type { GatewayMessage } from './gateway.js'

export { type GatewayMessage }
export const VERDICT_REGEX = /^(yes|no)\s+([a-z0-9]{3,8})$/i

export interface ReceiverContext {
  allowedPhoneNumbers: Set<string>
  signingKey?: string
  onMessage: (msg: GatewayMessage) => Promise<void>
  onVerdict?: (behavior: 'allow' | 'deny', requestId: string) => Promise<void>
}

function verifySignature(signingKey: string, body: string, timestamp: string, signature: string): boolean {
  try {
    const expected = createHmac('sha256', signingKey)
      .update(body + timestamp)
      .digest('hex')
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature.trim().toLowerCase(), 'hex'),
    )
  } catch {
    return false
  }
}

export class WebhookReceiver {
  private processedSids = new Set<string>()

  constructor(private ctx: ReceiverContext) {}

  async handleRequest(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const rawBody = await req.text()

    console.error(`[sms-channel] webhook received: method=${req.method} signingKeySet=${!!this.ctx.signingKey}`)

    if (this.ctx.signingKey) {
      const signature = req.headers.get('X-Signature')
      const timestamp = req.headers.get('X-Timestamp')
      console.error(`[sms-channel] auth headers: X-Signature=${signature ? 'present' : 'missing'} X-Timestamp=${timestamp ?? 'missing'}`)

      if (!signature || !timestamp) {
        console.error('[sms-channel] rejected: missing auth headers')
        return new Response('', { status: 401 })
      }

      const ts = parseInt(timestamp, 10)
      const now = Math.floor(Date.now() / 1000)
      const ageSecs = Math.abs(now - ts)
      console.error(`[sms-channel] timestamp age: ${ageSecs}s (limit 300s)`)
      if (isNaN(ts) || ageSecs > 300) {
        console.error('[sms-channel] rejected: timestamp expired or invalid')
        return new Response('', { status: 401 })
      }

      const valid = verifySignature(this.ctx.signingKey, rawBody, timestamp, signature)
      console.error(`[sms-channel] signature valid: ${valid}`)
      if (!valid) {
        return new Response('', { status: 401 })
      }
    }

    let body: unknown
    try {
      body = JSON.parse(rawBody)
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

    if (!this.ctx.allowedPhoneNumbers.has(sender)) {
      console.error(`[sms-channel] ignored: sender ${sender} not in allowlist`)
      return new Response('Ignored: sender not allowed')
    }
    if (this.processedSids.has(messageId)) return new Response('Ignored: duplicate')

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

    console.error(`[sms-channel] inbound: from=${sender} body="${message}"`)
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
