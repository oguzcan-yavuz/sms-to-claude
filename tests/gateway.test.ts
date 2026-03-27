import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { GatewayClient } from '../src/gateway'

const BASE_CONFIG = {
  baseUrl: 'http://192.168.1.5:8080',
  login: 'testlogin',
  password: 'testpass',
}

describe('GatewayClient.send', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('posts to /api/v1/message with correct payload and auth', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 'uuid-1', state: 'Pending', recipients: [] }), { status: 202 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await client.send('+19876543210', 'hello world')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_CONFIG.baseUrl}/message`)
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.phoneNumbers).toEqual(['+19876543210'])
    expect(body.message).toBe('hello world')
    expect((opts.headers as Record<string, string>)['Authorization'])
      .toBe('Basic ' + btoa('testlogin:testpass'))
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Bad Request', { status: 400 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.send('+1234', 'hi')).rejects.toThrow('400')
  })
})

describe('GatewayClient.registerWebhook', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('posts to /api/v1/webhooks with url and sms:received event', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 'webhook-id' }), { status: 201 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await client.registerWebhook('http://192.168.1.100:8081/webhook')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_CONFIG.baseUrl}/webhooks`)
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.url).toBe('http://192.168.1.100:8081/webhook')
    expect(body.event).toBe('sms:received')
  })

  test('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )
    const client = new GatewayClient(BASE_CONFIG)
    await expect(client.registerWebhook('http://x')).rejects.toThrow('401')
  })
})
