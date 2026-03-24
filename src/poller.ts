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

      const verdictMatch = msg.body.trim().match(VERDICT_REGEX)
      if (verdictMatch) {
        const behavior = verdictMatch[1].toLowerCase() === 'yes' ? 'allow' : 'deny'
        const requestId = verdictMatch[2].toLowerCase()
        await this.ctx.onVerdict?.(behavior, requestId)
        continue
      }

      await this.ctx.onMessage(msg)
    }

    // Always advance the cursor so filtered messages are not re-fetched
    this.lastChecked = new Date()
  }

  start(intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.poll().catch(err => {
        console.error('[sms-channel] poll error:', err)
      })
    }, intervalMs)
  }
}
