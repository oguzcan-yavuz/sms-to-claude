import type { GatewayMessage } from './gateway.js'

export { type GatewayMessage }
export const VERDICT_REGEX = /^(yes|no)\s+([a-z0-9]{3,8})$/i

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
