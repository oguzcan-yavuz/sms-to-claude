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
    await this.request(`${this.cfg.baseUrl}/api/v1/message`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumbers: [to],
        textMessage: { text: body },
      }),
    })
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    await this.request(`${this.cfg.baseUrl}/api/v1/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, event: 'sms:received' }),
    })
  }
}
