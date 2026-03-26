import Client, { type HttpClient, WebHookEventType } from 'android-sms-gateway'

export type { WebHookEventType }

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

const WEBHOOK_ID = 'sms-to-claude'

function makeFetchClient(): HttpClient {
  async function request<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gateway API error: ${res.status} ${res.statusText} — ${body}`)
    }
    return res.json() as Promise<T>
  }

  return {
    get: (url, headers) => request(url, { headers }),
    post: (url, body, headers) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    put: (url, body, headers) => request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    patch: (url, body, headers) => request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    delete: (url, headers) => request(url, { method: 'DELETE', headers }),
  }
}

export class GatewayClient {
  private client: Client

  constructor(cfg: GatewayConfig) {
    this.client = new Client(cfg.login, cfg.password, makeFetchClient(), cfg.baseUrl)
  }

  async send(to: string, body: string): Promise<void> {
    await this.client.send({ message: body, phoneNumbers: [to] })
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    await this.client.deleteWebhook(WEBHOOK_ID).catch(() => {})
    await this.client.registerWebhook({
      id: WEBHOOK_ID,
      url: webhookUrl,
      event: WebHookEventType.SmsReceived,
    })
  }
}
