import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { cliSwitchHandler } from '../src/cli-switch-routes.ts'
import type { CliSwitchList, CliSwitchRoutes } from '../src/cli-switch-routes.ts'

const LIST: CliSwitchList = {
  clis: [
    { id: 'cli-claude', label: 'Claude Code', enabled: true },
    { id: 'cli-kimi', label: 'Kimi CLI', enabled: false },
  ],
  saved: true,
}

interface Captured {
  status: number
  body: string
}

function requestOf(body: unknown, method = 'POST'): IncomingMessage {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return Object.assign(Readable.from([Buffer.from(text)]), { method, headers: {} }) as unknown as IncomingMessage
}

async function post(
  body: unknown,
  { routes = {}, rejection, method }: { routes?: Partial<CliSwitchRoutes>; rejection?: 401; method?: string } = {},
) {
  const all: CliSwitchRoutes = {
    list: vi.fn(() => LIST),
    set: vi.fn(() => Promise.resolve()),
    adopt: vi.fn(() => Promise.resolve()),
    ...routes,
  }
  const warn = vi.fn()
  const captured: Captured = { status: 0, body: '' }
  const res = {
    writeHead: (status: number) => {
      captured.status = status
    },
    end: (chunk?: string) => {
      captured.body = chunk ?? ''
    },
  } as unknown as ServerResponse
  await cliSwitchHandler(all, { requestRejection: () => rejection }, warn)(requestOf(body, method), res)
  return { ...captured, json: JSON.parse(captured.body) as unknown, routes: all, warn }
}

describe('CLI switch route', () => {
  it('refuses a request the connection rejects', async () => {
    const result = await post({}, { rejection: 401 })
    expect(result.status).toBe(401)
    expect(result.routes.list).not.toHaveBeenCalled()
  })

  it('takes POST only', async () => {
    expect((await post({}, { method: 'GET' })).status).toBe(405)
  })

  it('lists every configured CLI with its switch', async () => {
    const result = await post({})
    expect(result.json).toEqual({ success: true, data: LIST })
  })

  it('switches a CLI, passing the switcher order on', async () => {
    const order = ['deepseek-official', 'cli-claude', 'cli-kimi']
    const result = await post({ provider: 'cli-claude', enabled: false, order })
    expect(result.routes.set).toHaveBeenCalledWith('cli-claude', false, order)
    expect(result.json).toEqual({ success: true, data: LIST })
  })

  it('switches without an order', async () => {
    const result = await post({ provider: 'cli-kimi', enabled: true })
    expect(result.routes.set).toHaveBeenCalledWith('cli-kimi', true, [])
  })

  it('adopts a list a browser kept', async () => {
    const result = await post({ adopt: ['cli-kimi'] })
    expect(result.routes.adopt).toHaveBeenCalledWith(['cli-kimi'])
  })

  it.each([
    ['a switch without a provider', { enabled: true }],
    ['a switch that is not a boolean', { provider: 'cli-kimi', enabled: 'yes' }],
    ['an order that is not a list of ids', { provider: 'cli-kimi', enabled: true, order: [1] }],
    ['an adopted list that is not a list of ids', { adopt: 'cli-kimi' }],
    ['a body that is not JSON', '{nope'],
  ])('rejects %s', async (_name, body) => {
    const result = await post(body)
    expect(result.status).toBe(400)
    expect(result.routes.set).not.toHaveBeenCalled()
  })

  it('passes a refusal the user can act on', async () => {
    const refusal = new LlmError('未知的 CLI：cli-nope', 'CLI_SWITCH_FAILED')
    const result = await post(
      { provider: 'cli-nope', enabled: false },
      { routes: { set: () => Promise.reject(refusal) } },
    )
    expect(result.status).toBe(400)
    expect(result.json).toEqual({ success: false, error: '未知的 CLI：cli-nope' })
  })

  it('keeps an unexpected failure out of the answer and logs it', async () => {
    const failed = await post(
      { provider: 'cli-kimi', enabled: false },
      { routes: { set: () => Promise.reject(new Error('EACCES')) } },
    )
    expect(failed.status).toBe(500)
    expect(failed.json).toEqual({ success: false, error: '切换 CLI 失败，请查看日志' })
    expect(failed.warn).toHaveBeenCalledWith('ccgui: CLI switch failed: EACCES')
  })
})
