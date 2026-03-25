import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { WebhookReceiver, VERDICT_REGEX, type ReceiverContext } from '../src/webhook-receiver'
import type { GatewayMessage } from '../src/gateway'

function makeWebhookPayload(overrides: Partial<{
  messageId: string; message: string; sender: string; receivedAt: string
}> = {}) {
  return {
    event: 'sms:received',
    id: 'webhook-uuid',
    payload: {
      messageId: overrides.messageId ?? 'msg-uuid-1',
      message: overrides.message ?? 'hello claude',
      sender: overrides.sender ?? '+19876543210',
      recipient: '+19999999999',
      simNumber: 1,
      receivedAt: overrides.receivedAt ?? '2026-03-25T10:00:00Z',
    },
  }
}

async function postWebhook(receiver: WebhookReceiver, payload: object): Promise<Response> {
  return receiver.handleRequest(
    new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

describe('WebhookReceiver', () => {
  let onMessage: ReturnType<typeof mock>
  let onVerdict: ReturnType<typeof mock>
  let ctx: ReceiverContext

  beforeEach(() => {
    onMessage = mock(async () => {})
    onVerdict = mock(async () => {})
    ctx = {
      allowedPhoneNumbers: new Set(['+19876543210']),
      onMessage,
      onVerdict,
    }
  })

  test('processes a valid inbound SMS and calls onMessage', async () => {
    const receiver = new WebhookReceiver(ctx)
    const res = await postWebhook(receiver, makeWebhookPayload())

    expect(res.status).toBe(200)
    expect(onMessage).toHaveBeenCalledTimes(1)
    const msg: GatewayMessage = onMessage.mock.calls[0][0]
    expect(msg.sid).toBe('msg-uuid-1')
    expect(msg.from).toBe('+19876543210')
    expect(msg.body).toBe('hello claude')
    expect(msg.dateSent).toBeInstanceOf(Date)
  })

  test('ignores messages from numbers not in allowedPhoneNumbers', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ sender: '+10000000000' }))

    expect(onMessage).not.toHaveBeenCalled()
    expect(onVerdict).not.toHaveBeenCalled()
  })

  test('deduplicates messages with the same messageId', async () => {
    const receiver = new WebhookReceiver(ctx)
    const payload = makeWebhookPayload()
    await postWebhook(receiver, payload)
    await postWebhook(receiver, payload)

    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  test('routes verdict message to onVerdict instead of onMessage', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ message: 'yes abcde' }))

    expect(onVerdict).toHaveBeenCalledTimes(1)
    expect(onVerdict.mock.calls[0]).toEqual(['allow', 'abcde'])
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('routes "no" verdict correctly', async () => {
    const receiver = new WebhookReceiver(ctx)
    await postWebhook(receiver, makeWebhookPayload({ message: 'no abcde' }))

    expect(onVerdict).toHaveBeenCalledTimes(1)
    expect(onVerdict.mock.calls[0]).toEqual(['deny', 'abcde'])
  })

  test('returns 400 for non-POST requests', async () => {
    const receiver = new WebhookReceiver(ctx)
    const res = await receiver.handleRequest(
      new Request('http://localhost/webhook', { method: 'GET' })
    )
    expect(res.status).toBe(400)
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('returns 400 for unknown event types', async () => {
    const receiver = new WebhookReceiver(ctx)
    const payload = { event: 'sms:sent', id: 'x', payload: {} }
    const res = await postWebhook(receiver, payload)
    expect(res.status).toBe(400)
  })
})

describe('VERDICT_REGEX', () => {
  test('matches 5-char id "yes abcde"', () => {
    expect('yes abcde'.match(VERDICT_REGEX)).toBeTruthy()
  })
  test('matches 3-char id "yes xyz"', () => {
    expect('yes xyz'.match(VERDICT_REGEX)).toBeTruthy()
  })
  test('matches "NO ABCDE" case-insensitively', () => {
    expect('NO ABCDE'.match(VERDICT_REGEX)).toBeTruthy()
  })
  test('does not match plain messages', () => {
    expect('hello world'.match(VERDICT_REGEX)).toBeNull()
  })
  test('does not match id shorter than 3 chars', () => {
    expect('yes ab'.match(VERDICT_REGEX)).toBeNull()
  })
  test('does not match id longer than 8 chars', () => {
    expect('yes abcdefghi'.match(VERDICT_REGEX)).toBeNull()
  })
})
