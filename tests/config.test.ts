import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const snapshot: Record<string, string | undefined> = {}
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'ALLOWED_PHONE_NUMBERS', 'POLL_INTERVAL_MS']

  beforeEach(() => {
    keys.forEach(k => { snapshot[k] = process.env[k] })
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'
    process.env.TWILIO_AUTH_TOKEN = 'authtest'
    process.env.TWILIO_PHONE_NUMBER = '+11234567890'
    process.env.ALLOWED_PHONE_NUMBERS = '+19876543210'
    delete process.env.POLL_INTERVAL_MS
  })

  afterEach(() => {
    keys.forEach(k => {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    })
  })

  test('loads required env vars with default poll interval', () => {
    const config = loadConfig()
    expect(config.twilio.accountSid).toBe('ACtest')
    expect(config.twilio.authToken).toBe('authtest')
    expect(config.twilio.phoneNumber).toBe('+11234567890')
    expect(config.allowedPhoneNumbers.has('+19876543210')).toBe(true)
    expect(config.pollIntervalMs).toBe(5000)
  })

  test('parses comma-separated ALLOWED_PHONE_NUMBERS', () => {
    process.env.ALLOWED_PHONE_NUMBERS = '+1111, +2222, +3333'
    const config = loadConfig()
    expect(config.allowedPhoneNumbers.size).toBe(3)
    expect(config.allowedPhoneNumbers.has('+1111')).toBe(true)
    expect(config.allowedPhoneNumbers.has('+2222')).toBe(true)
    expect(config.allowedPhoneNumbers.has('+3333')).toBe(true)
  })

  test('uses custom POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = '10000'
    const config = loadConfig()
    expect(config.pollIntervalMs).toBe(10000)
  })

  test('throws on missing TWILIO_ACCOUNT_SID', () => {
    delete process.env.TWILIO_ACCOUNT_SID
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_ACCOUNT_SID')
  })

  test('throws on missing TWILIO_AUTH_TOKEN', () => {
    delete process.env.TWILIO_AUTH_TOKEN
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_AUTH_TOKEN')
  })

  test('throws on missing TWILIO_PHONE_NUMBER', () => {
    delete process.env.TWILIO_PHONE_NUMBER
    expect(() => loadConfig()).toThrow('Missing required env var: TWILIO_PHONE_NUMBER')
  })

  test('throws on missing ALLOWED_PHONE_NUMBERS', () => {
    delete process.env.ALLOWED_PHONE_NUMBERS
    expect(() => loadConfig()).toThrow('Missing required env var: ALLOWED_PHONE_NUMBERS')
  })

  test('throws on non-numeric POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = 'abc'
    expect(() => loadConfig()).toThrow('POLL_INTERVAL_MS must be a number')
  })
})
