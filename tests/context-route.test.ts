import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { contextHandler } from '../src/context-route.ts'

async function post(body: unknown, { rejection, method = 'POST' }: { rejection?: 401; method?: string } = {}) {
  const usageFor = vi.fn((sessionId: string, provider: string) =>
    sessionId === 'dsh-1' && provider === 'cli-codex' ? { used: 90_000, size: 200_000 } : undefined,
  )
  const captured = { status: 0, body: '' }
  const res = {
    writeHead: (status: number) => {
      captured.status = status
    },
    end: (chunk?: string) => {
      captured.body = chunk ?? ''
    },
  } as unknown as ServerResponse
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign(Readable.from([Buffer.from(text)]), { method, headers: {} }) as unknown as IncomingMessage
  await contextHandler({ usageFor }, { requestRejection: () => rejection })(req, res)
  return { status: captured.status, json: JSON.parse(captured.body) as unknown, usageFor }
}

describe('context route', () => {
  it('answers with what the CLI reported for the session', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-codex' })
    expect(result.json).toEqual({ success: true, data: { usage: { used: 90_000, size: 200_000 } } })
  })

  it('answers null while the CLI has reported nothing', async () => {
    const result = await post({ sessionId: 'dsh-2', provider: 'cli-codex' })
    expect(result.json).toEqual({ success: true, data: { usage: null } })
  })

  it('refuses a request the connection rejects', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-codex' }, { rejection: 401 })
    expect(result.status).toBe(401)
    expect(result.usageFor).not.toHaveBeenCalled()
  })

  it('takes POST only', async () => {
    expect((await post({}, { method: 'GET' })).status).toBe(405)
  })

  it.each([
    ['a body without a session', { provider: 'cli-codex' }],
    ['a body that is not JSON', '{nope'],
  ])('rejects %s', async (_name, body) => {
    expect((await post(body)).status).toBe(400)
  })
})
