export interface GatewayMessage {
  sid: string      // maps to webhook payload.messageId
  from: string     // maps to webhook payload.sender
  body: string     // maps to webhook payload.message
  dateSent: Date   // maps to webhook payload.receivedAt
}

export interface GatewayConfig {
  baseUrl: string
  login: string
  password: string
}

export class GatewayClient {
  private auth: string

  constructor(private cfg: GatewayConfig) {
    this.auth = 'Basic ' + btoa(`${cfg.login}:${cfg.password}`)
  }

  private get headers() {
    return {
      'Authorization': this.auth,
      'Content-Type': 'application/json',
    }
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(url, { ...init, headers: { ...this.headers, ...(init.headers ?? {}) } })
    if (!res.ok) throw new Error(`Gateway API error: ${res.status} ${res.statusText}`)
    return res.json()
  }

  async send(to: string, body: string): Promise<void> {
    await this.request(`${this.cfg.baseUrl}/message`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumbers: [to],
        textMessage: { text: body },
      }),
    })
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    // Delete any existing registration first so re-starts are idempotent
    await fetch(`${this.cfg.baseUrl}/webhooks/sms-to-claude`, {
      method: 'DELETE',
      headers: this.headers,
    })
    const res = await fetch(`${this.cfg.baseUrl}/webhooks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ id: 'sms-to-claude', url: webhookUrl, event: 'sms:received' }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gateway API error: ${res.status} ${res.statusText} — ${body}`)
    }
  }
}
