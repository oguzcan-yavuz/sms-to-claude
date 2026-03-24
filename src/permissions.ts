interface PendingPermission {
  tool_name: string
  description: string
  expires: number
}

export interface PermissionsContext {
  sendSms: (text: string) => Promise<void>
  sendVerdict: (requestId: string, behavior: 'allow' | 'deny') => Promise<void>
}

export class PermissionManager {
  private pending = new Map<string, PendingPermission>()

  constructor(
    private ctx: PermissionsContext,
    private timeoutMs = 10 * 60 * 1000,
  ) {}

  async handleRequest(requestId: string, toolName: string, description: string, inputPreview: string): Promise<void> {
    this.pending.set(requestId, {
      tool_name: toolName,
      description,
      expires: Date.now() + this.timeoutMs,
    })

    const sms = [
      '[Permission needed]',
      `Tool: ${toolName}`,
      description,
      ...(inputPreview ? [`Input: ${inputPreview.slice(0, 100)}`] : []),
      '',
      `Reply: yes ${requestId} OR no ${requestId}`,
    ].join('\n')

    await this.ctx.sendSms(sms)
  }

  async handleVerdict(behavior: 'allow' | 'deny', requestId: string): Promise<void> {
    if (!this.pending.has(requestId)) {
      await this.ctx.sendSms(`Unknown permission ID. It may have expired.`)
      return
    }
    this.pending.delete(requestId)
    await this.ctx.sendVerdict(requestId, behavior)
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }

  async sweepExpired(): Promise<void> {
    const now = Date.now()
    const expired = [...this.pending.entries()].filter(([, entry]) => entry.expires <= now)
    for (const [id] of expired) {
      this.pending.delete(id)
      await this.ctx.sendSms(
        `Permission request ${id} expired. Answer in terminal if present.`
      )
    }
  }

  startSweep(intervalMs = 60_000): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.sweepExpired().catch(err => {
        console.error('[sms-channel] sweep error:', err)
      })
    }, intervalMs)
  }
}
