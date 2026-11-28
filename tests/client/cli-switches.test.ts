import { describe, expect, it, vi } from 'vitest'
import { createCliSwitchApi } from '../../src/client/cli-switch-api.ts'
import type { CliSwitchApi, CliSwitchReply } from '../../src/client/cli-switch-api.ts'
import { createCliSwitches } from '../../src/client/cli-switches.ts'
import type { PostJson } from '../../src/client/mode-api.ts'
import { CLI_SWITCH_ROUTE } from '../../src/constants.ts'

const REPLY: CliSwitchReply = {
  clis: [
    { id: 'cli-claude', label: 'Claude Code', enabled: true },
    { id: 'cli-kimi', label: 'Kimi CLI', enabled: false },
  ],
  saved: true,
}

function poster(body: unknown, status = 200): PostJson {
  return vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as unknown as Response),
  )
}

const sentBody = (post: PostJson, call = 0): unknown => {
  const init = vi.mocked(post).mock.calls[call]?.[1]
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
}

describe('CLI switch API', () => {
  it('reads, switches and hands over on the switch route', async () => {
    const post = poster({ success: true, data: REPLY })
    const api = createCliSwitchApi(post)
    await expect(api.read()).resolves.toEqual(REPLY)
    await api.set('cli-kimi', true, ['deepseek-official', 'cli-kimi'])
    await api.adopt(['cli-kimi'])
    expect(vi.mocked(post).mock.calls[0]?.[0]).toBe(CLI_SWITCH_ROUTE)
    expect(sentBody(post, 0)).toEqual({})
    expect(sentBody(post, 1)).toEqual({ provider: 'cli-kimi', enabled: true, order: ['deepseek-official', 'cli-kimi'] })
    expect(sentBody(post, 2)).toEqual({ adopt: ['cli-kimi'] })
  })

  it('passes on the reason the route gave', async () => {
    const api = createCliSwitchApi(poster({ success: false, error: '未知的 CLI：cli-x' }, 400))
    await expect(api.set('cli-x', false, [])).rejects.toThrow('未知的 CLI：cli-x')
  })

  it('reports a failure without a readable body by its status', async () => {
    const post: PostJson = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) } as unknown as Response),
    )
    await expect(createCliSwitchApi(post).read()).rejects.toThrow('HTTP 502')
  })

  it('refuses a reply it cannot read, and drops malformed rows', async () => {
    await expect(createCliSwitchApi(poster({ success: true, data: { clis: 'x' } })).read()).rejects.toThrow('无法识别')
    const rows = { success: true, data: { clis: [null, { id: 'cli-a' }, REPLY.clis[0]], saved: false } }
    await expect(createCliSwitchApi(poster(rows)).read()).resolves.toEqual({ clis: [REPLY.clis[0]], saved: false })
  })
})

function fakeApi(overrides: Partial<CliSwitchApi> = {}): CliSwitchApi {
  return {
    read: vi.fn(() => Promise.resolve(REPLY)),
    set: vi.fn(() => Promise.resolve(REPLY)),
    adopt: vi.fn(() => Promise.resolve(REPLY)),
    ...overrides,
  }
}

describe('createCliSwitches', () => {
  it('loads the list from the plugin', async () => {
    const switches = createCliSwitches(fakeApi(), () => [])
    expect(switches.getSnapshot().clis).toBeUndefined()
    switches.load()
    await vi.waitFor(() => {
      expect(switches.getSnapshot().clis).toEqual(REPLY.clis)
    })
  })

  // The CLIs a user turned off in this browser stay off once the plugin owns the switches.
  it('hands over the list this browser kept, only while nothing is saved', async () => {
    const api = fakeApi({ read: vi.fn(() => Promise.resolve({ ...REPLY, saved: false })) })
    const switches = createCliSwitches(api, () => ['cli-kimi'])
    switches.load()
    await vi.waitFor(() => {
      expect(api.adopt).toHaveBeenCalledWith(['cli-kimi'])
    })
    const saved = fakeApi()
    createCliSwitches(saved, () => ['cli-kimi']).load()
    await vi.waitFor(() => {
      expect(saved.read).toHaveBeenCalled()
    })
    expect(saved.adopt).not.toHaveBeenCalled()
  })

  it('marks a switch as on its way until the plugin answers', async () => {
    let answer: (reply: CliSwitchReply) => void = () => undefined
    const api = fakeApi({
      set: vi.fn(
        () =>
          new Promise<CliSwitchReply>((resolve) => {
            answer = resolve
          }),
      ),
    })
    const switches = createCliSwitches(api, () => [])
    const listener = vi.fn()
    switches.subscribe(listener)
    switches.set('cli-kimi', true, ['cli-kimi'])
    expect(switches.getSnapshot().pending).toEqual(['cli-kimi'])
    answer({ ...REPLY, clis: [{ id: 'cli-kimi', label: 'Kimi CLI', enabled: true }] })
    await vi.waitFor(() => {
      expect(switches.getSnapshot().pending).toEqual([])
    })
    expect(switches.getSnapshot().clis).toEqual([{ id: 'cli-kimi', label: 'Kimi CLI', enabled: true }])
    expect(listener).toHaveBeenCalled()
  })

  it('keeps the reason a switch or a read failed, until one succeeds', async () => {
    const api = fakeApi({
      set: vi.fn(() => Promise.reject(new Error('disk full'))),
      read: vi.fn(() => Promise.reject(new Error('offline'))),
    })
    const switches = createCliSwitches(api, () => [])
    switches.load()
    await vi.waitFor(() => {
      expect(switches.getSnapshot().failure).toBe('offline')
    })
    switches.set('cli-kimi', true, [])
    await vi.waitFor(() => {
      expect(switches.getSnapshot().failure).toBe('disk full')
    })
    expect(switches.getSnapshot().pending).toEqual([])
  })

  it('stops notifying after unsubscribe', () => {
    const switches = createCliSwitches(fakeApi(), () => [])
    const listener = vi.fn()
    switches.subscribe(listener)()
    switches.set('cli-kimi', true, [])
    expect(listener).not.toHaveBeenCalled()
  })
})
