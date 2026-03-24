import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { Poller, VERDICT_REGEX, type TwilioMessage, type PollContext } from '../src/poller'

function makeMsg(overrides: Partial<TwilioMessage> = {}): TwilioMessage {
  return {
    sid: 'SM' + Math.random().toString(36).slice(2, 10),
    from: '+19876543210',
    body: 'hello claude',
    dateSent: new Date('2026-03-24T10:00:00Z'),
    ...overrides,
  }
}

describe('VERDICT_REGEX', () => {
  test('matches "yes abcde"', () => expect(VERDICT_REGEX.test('yes abcde')).toBe(true))
  test('matches "no abcde"', () => expect(VERDICT_REGEX.test('no abcde')).toBe(true))
  test('matches case-insensitively', () => expect(VERDICT_REGEX.test('YES ABCDE')).toBe(true))
  test('does not match plain text', () => expect(VERDICT_REGEX.test('yes please')).toBe(false))
  test('does not match partial nonce', () => expect(VERDICT_REGEX.test('yes abc')).toBe(false))
  test('does not match extra text after nonce', () => expect(VERDICT_REGEX.test('yes abcde extra')).toBe(false))
})

describe('Poller', () => {
  let onMessage: ReturnType<typeof mock>
  let listMessages: ReturnType<typeof mock>
  let ctx: PollContext

  beforeEach(() => {
    onMessage = mock(async () => {})
    listMessages = mock(async () => [])
    ctx = {
      twilioClient: { messages: { list: listMessages } },
      twilioPhoneNumber: '+11234567890',
      allowedPhoneNumbers: new Set(['+19876543210']),
      onMessage,
    }
  })

  test('calls onMessage for allowed sender', async () => {
    const msg = makeMsg()
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0][0]).toMatchObject({ sid: msg.sid, body: msg.body })
  })

  test('silently drops message from unknown sender', async () => {
    const msg = makeMsg({ from: '+10000000000' })
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('deduplicates: does not emit the same SID twice', async () => {
    const msg = makeMsg()
    listMessages.mockResolvedValue([msg])
    const poller = new Poller(ctx)
    await poller.poll()
    await poller.poll()
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  test('processes messages oldest-first when multiple arrive', async () => {
    const older = makeMsg({ sid: 'SM1', body: 'first', dateSent: new Date('2026-03-24T10:00:00Z') })
    const newer = makeMsg({ sid: 'SM2', body: 'second', dateSent: new Date('2026-03-24T10:00:01Z') })
    listMessages.mockResolvedValue([newer, older]) // API returns newest first
    const poller = new Poller(ctx)
    await poller.poll()
    expect(onMessage.mock.calls[0][0].body).toBe('first')
    expect(onMessage.mock.calls[1][0].body).toBe('second')
  })

  test('does not call onMessage for verdict-shaped message', async () => {
    const msg = makeMsg({ body: 'yes abcde' })
    listMessages.mockResolvedValue([msg])
    const onVerdict = mock(async () => {})
    const poller = new Poller({ ...ctx, onVerdict })
    await poller.poll()
    expect(onMessage).not.toHaveBeenCalled()
    expect(onVerdict).toHaveBeenCalledWith('allow', 'abcde')
  })

  test('calls onVerdict with deny for "no <id>"', async () => {
    const msg = makeMsg({ body: 'no abcde' })
    listMessages.mockResolvedValue([msg])
    const onVerdict = mock(async () => {})
    const poller = new Poller({ ...ctx, onVerdict })
    await poller.poll()
    expect(onVerdict).toHaveBeenCalledWith('deny', 'abcde')
  })
})
