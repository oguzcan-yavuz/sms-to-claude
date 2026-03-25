import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const snapshot: Record<string, string | undefined> = {}
  const keys = [
    'GATEWAY_BASE_URL', 'GATEWAY_LOGIN', 'GATEWAY_PASSWORD',
    'WEBHOOK_URL', 'WEBHOOK_PORT',
    'ALLOWED_PHONE_NUMBERS', 'POLL_INTERVAL_MS',
  ]

  beforeEach(() => {
    keys.forEach(k => { snapshot[k] = process.env[k] })
    process.env.GATEWAY_BASE_URL = 'http://192.168.1.5:8080'
    process.env.GATEWAY_LOGIN = 'testlogin'
    process.env.GATEWAY_PASSWORD = 'testpass'
    process.env.WEBHOOK_URL = 'http://192.168.1.100:8081/webhook'
    process.env.ALLOWED_PHONE_NUMBERS = '+19876543210'
    delete process.env.WEBHOOK_PORT
    delete process.env.POLL_INTERVAL_MS
  })

  afterEach(() => {
    keys.forEach(k => {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    })
  })

  test('loads config from valid env vars', () => {
    const config = loadConfig()
    expect(config.gateway.baseUrl).toBe('http://192.168.1.5:8080')
    expect(config.gateway.login).toBe('testlogin')
    expect(config.gateway.password).toBe('testpass')
    expect(config.webhookUrl).toBe('http://192.168.1.100:8081/webhook')
    expect(config.webhookPort).toBe(8081)
    expect(config.allowedPhoneNumbers.has('+19876543210')).toBe(true)
  })

  test('uses explicit WEBHOOK_PORT over URL-derived port', () => {
    process.env.WEBHOOK_PORT = '9000'
    const config = loadConfig()
    expect(config.webhookPort).toBe(9000)
  })

  test('parses comma-separated ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, +2222, +3333'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(3)
    expect(config.allowedPhoneNumbers.has('+2222')).toBe(true)
  })

  test('throws on missing GATEWAY_BASE_URL', () => {
    delete process.env.GATEWAY_BASE_URL
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_BASE_URL')
  })

  test('throws on missing GATEWAY_LOGIN', () => {
    delete process.env.GATEWAY_LOGIN
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_LOGIN')
  })

  test('throws on missing GATEWAY_PASSWORD', () => {
    delete process.env.GATEWAY_PASSWORD
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_PASSWORD')
  })

  test('throws on missing WEBHOOK_URL', () => {
    delete process.env.WEBHOOK_URL
    expect(() => loadConfig()).toThrow('Missing required env var: WEBHOOK_URL')
  })

  test('throws on missing ALLOWED_PHONE_NUMBERS', () => {
    delete process.env.ALLOWED_PHONE_NUMBERS
    expect(() => loadConfig()).toThrow('Missing required env var: ALLOWED_PHONE_NUMBERS')
  })

  test('throws if WEBHOOK_URL has no parseable port', () => {
    process.env.WEBHOOK_URL = 'http://192.168.1.100/webhook'  // no port in URL
    delete process.env.WEBHOOK_PORT
    expect(() => loadConfig()).toThrow('WEBHOOK_PORT')
  })

  test('throws on non-numeric WEBHOOK_PORT', () => {
    process.env.WEBHOOK_PORT = 'abc'
    expect(() => loadConfig()).toThrow('WEBHOOK_PORT must be a number')
  })

  test('throws on whitespace-only GATEWAY_BASE_URL', () => {
    process.env.GATEWAY_BASE_URL = '   '
    expect(() => loadConfig()).toThrow('Missing required env var: GATEWAY_BASE_URL')
  })

  test('throws on out-of-range WEBHOOK_PORT', () => {
    process.env.WEBHOOK_PORT = '99999'
    expect(() => loadConfig()).toThrow('WEBHOOK_PORT must be between 1 and 65535')
  })

  test('ignores empty entries in ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, , +2222'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(2)
    expect(config.allowedPhoneNumbers.has('+1111')).toBe(true)
  })
})
