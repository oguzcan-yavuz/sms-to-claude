import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { PermissionManager, type PermissionsContext } from '../src/permissions'

function makeCtx(): { sendSms: ReturnType<typeof mock>; sendVerdict: ReturnType<typeof mock>; ctx: PermissionsContext } {
  const sendSms = mock(async (_text: string) => {})
  const sendVerdict = mock(async (_id: string, _behavior: 'allow' | 'deny') => {})
  return { sendSms, sendVerdict, ctx: { sendSms, sendVerdict } }
}

describe('PermissionManager', () => {
  test('sends formatted SMS on handleRequest', async () => {
    const { sendSms, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleRequest('abcde', 'Bash', 'rm -rf dist/', 'rm -rf dist/')
    expect(sendSms).toHaveBeenCalledTimes(1)
    const text: string = sendSms.mock.calls[0][0]
    expect(text).toContain('[Permission needed]')
    expect(text).toContain('Tool: Bash')
    expect(text).toContain('rm -rf dist/')
    expect(text).toContain('yes abcde')
    expect(text).toContain('no abcde')
  })

  test('sends verdict and removes from pending on matching handleVerdict', async () => {
    const { sendVerdict, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleRequest('abcde', 'Write', 'Write file', 'path/to/file')
    await mgr.handleVerdict('allow', 'abcde')
    expect(sendVerdict).toHaveBeenCalledWith('abcde', 'allow')
    expect(mgr.hasPending()).toBe(false)
  })

  test('sends unknown-ID SMS for stale nonce, does not call sendVerdict', async () => {
    const { sendSms, sendVerdict, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    await mgr.handleVerdict('allow', 'zzzzz')
    expect(sendVerdict).not.toHaveBeenCalled()
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendSms.mock.calls[0][0]).toContain('Unknown permission ID')
  })

  test('sweepExpired removes timed-out entry and sends expiry SMS', async () => {
    const { sendSms, ctx } = makeCtx()
    const mgr = new PermissionManager(ctx, -1) // timeout of -1ms = already expired
    await mgr.handleRequest('abcde', 'Bash', 'some command', '')
    await mgr.sweepExpired()
    expect(mgr.hasPending()).toBe(false)
    expect(sendSms).toHaveBeenCalledTimes(2) // once for request, once for expiry
    const expirySms: string = sendSms.mock.calls[1][0]
    expect(expirySms).toContain('abcde')
    expect(expirySms).toContain('expired')
  })

  test('sweepExpired does not remove non-expired entries', async () => {
    const { ctx } = makeCtx()
    const mgr = new PermissionManager(ctx, 10 * 60 * 1000) // 10 min timeout
    await mgr.handleRequest('abcde', 'Bash', 'some command', '')
    await mgr.sweepExpired()
    expect(mgr.hasPending()).toBe(true)
  })

  test('hasPending returns false when map is empty', () => {
    const { ctx } = makeCtx()
    const mgr = new PermissionManager(ctx)
    expect(mgr.hasPending()).toBe(false)
  })
})
