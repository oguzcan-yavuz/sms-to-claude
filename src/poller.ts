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
