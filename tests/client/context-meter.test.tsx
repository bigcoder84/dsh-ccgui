// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryState } from '../../src/client/choices.ts'
import { contextApiFor, createContextApi } from '../../src/client/context-api.ts'
import type { ContextApi, ContextUsage } from '../../src/client/context-api.ts'
import { CONTEXT_POLL_MS, CliContextMeter, formatTokens } from '../../src/client/context-meter.tsx'
import * as styles from '../../src/client/context-meter-styles.ts'
import type { PostJson } from '../../src/client/mode-api.ts'
import { CONTEXT_ROUTE } from '../../src/constants.ts'
import { createStore } from '../fixtures/client-store.ts'

const CODEX: DirectoryState = {
  groups: [{ id: 'cli-codex', name: 'Codex CLI', models: [{ id: 'default', name: '6 Sol' }] }],
  current: { provider: 'cli-codex', model: 'default' },
}
const DEEPSEEK: DirectoryState = {
  groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }],
  current: { provider: 'deepseek-official', model: 'chat' },
}
const HALF: ContextUsage = { used: 90_000, size: 200_000 }

function meter({
  state = CODEX,
  usage = HALF,
  running = false,
}: { state?: DirectoryState; usage?: ContextUsage | undefined; running?: boolean } = {}) {
  const read = vi.fn<ContextApi['read']>(() => Promise.resolve(usage))
  const session = createStore({ blank: false, running })
  render(<CliContextMeter directory={createStore(state)} session={session} context={{ read }} />)
  return { read, session }
}

const trigger = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^上下文已用/ })

afterEach(cleanup)

describe('formatTokens', () => {
  it.each([
    [999, '999'],
    [1_234, '1.2K'],
    [90_000, '90K'],
    [123_456, '123K'],
    [1_500_000, '1.5M'],
  ])('writes %d as %s, as the harness does', (value, text) => {
    expect(formatTokens(value)).toBe(text)
  })
})

describe('CliContextMeter', () => {
  it('shows the ring and the share of the context in use', async () => {
    meter()
    const button = await trigger()
    expect(button.getAttribute('aria-label')).toBe('上下文已用 45%')
    expect(button.textContent).toBe('45%')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('opens the panel with the token counts, and closes on Escape or a press outside', async () => {
    meter()
    const user = userEvent.setup()
    await user.click(await trigger())
    const panel = screen.getByRole('dialog', { name: '上下文已用' })
    expect(panel.textContent).toBe('上下文已用45%90K / 200K')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(await trigger())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('caps a context reported past its window at 100%', async () => {
    meter({ usage: { used: 250_000, size: 200_000 } })
    expect((await trigger()).textContent).toBe('100%')
  })

  it('shows nothing on a session the harness runs', async () => {
    const { read } = meter({ state: DEEPSEEK })
    await act(async () => {
      await Promise.resolve()
    })
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing until the CLI has reported its context', async () => {
    const { read } = meter({ usage: undefined })
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledWith('cli-codex')
    })
    expect(screen.queryByRole('button')).toBeNull()
  })

  // The harness's ring moves while its model works; this one asks the CLI as often.
  it('asks again while a turn runs and once it ends, and not while idle', async () => {
    vi.useFakeTimers()
    try {
      const { read, session } = meter({ running: true })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTEXT_POLL_MS * 2)
      })
      expect(read).toHaveBeenCalledTimes(3)
      session.set({ blank: false, running: false })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTEXT_POLL_MS * 3)
      })
      expect(read).toHaveBeenCalledTimes(4)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('styles every class it renders', () => {
    const { CONTEXT_METER_STYLES, ...classes } = styles
    for (const name of Object.values(classes)) expect(CONTEXT_METER_STYLES).toContain(`.${name}`)
  })
})

describe('context API', () => {
  function poster(body: unknown, status = 200): PostJson {
    return vi.fn(() =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as unknown as Response),
    )
  }

  it('reads the figures for the session and CLI', async () => {
    const post = poster({ success: true, data: { usage: HALF } })
    await expect(createContextApi(post, 'dsh-1').read('cli-codex')).resolves.toEqual(HALF)
    const [url, init] = vi.mocked(post).mock.calls[0] ?? ['', {}]
    expect(url).toBe(CONTEXT_ROUTE)
    expect(typeof init.body === 'string' ? JSON.parse(init.body) : undefined).toEqual({
      sessionId: 'dsh-1',
      provider: 'cli-codex',
    })
  })

  it('reads no figures as none, and a failure as an error', async () => {
    await expect(createContextApi(poster({ success: true, data: { usage: null } }), 'dsh-1').read('x')).resolves.toBe(
      undefined,
    )
    await expect(createContextApi(poster({ success: false }, 500), 'dsh-1').read('x')).rejects.toThrow('HTTP 500')
    const broken: PostJson = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) } as unknown as Response),
    )
    await expect(createContextApi(broken, 'dsh-1').read('x')).rejects.toThrow('HTTP 502')
  })

  it('hands the same session the same API', () => {
    const post = poster({})
    expect(contextApiFor(post, 'dsh-9')).toBe(contextApiFor(post, 'dsh-9'))
  })
})
