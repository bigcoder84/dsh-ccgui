// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * Codex's fast mode, as the toggle beside the CLI mode control. Exercised through
 * `ModeMenu`, which reads both from one answer of the mode route.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModeApi, ModeReply } from '../../src/client/mode-api.ts'
import { MODE_POLL_MS, ModeMenu } from '../../src/client/mode-menu.tsx'

const MODES = {
  configId: 'mode',
  current: 'agent',
  options: [
    { value: 'read-only', name: 'Read Only' },
    { value: 'agent', name: 'Agent' },
  ],
}

const fast = (current: string) => ({
  configId: 'fast-mode',
  current,
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
})

const OFF: ModeReply = { modes: MODES, pending: undefined, speed: fast('off') }
const ON: ModeReply = { modes: MODES, pending: undefined, speed: fast('on') }

function setup({
  reply = OFF,
  write = () => Promise.resolve(ON),
  locked = false,
}: {
  reply?: ModeReply
  write?: ModeApi['write']
  locked?: boolean
} = {}) {
  const read = vi.fn<ModeApi['read']>(() => Promise.resolve(reply))
  const written = vi.fn<ModeApi['write']>(write)
  render(
    <div data-composer-card>
      <ModeMenu provider="cli-codex" api={{ read, write: written }} locked={locked} started />
    </div>,
  )
  return { read, write: written, user: userEvent.setup() }
}

const toggle = async (): Promise<HTMLElement> => screen.findByRole('button', { name: /^快速模式/ })

afterEach(cleanup)

describe('fast-mode toggle', () => {
  it('is left out when the CLI reports no fast mode', async () => {
    const { read } = setup({ reply: { modes: MODES, pending: undefined } })
    await screen.findByRole('button', { name: /CLI 模式/ })
    expect(read).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^快速模式/ })).toBeNull()
  })

  it('shows whether fast mode is on', async () => {
    setup({ reply: ON })
    const button = await toggle()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('快速模式，已开启')
  })

  it('turns it on with the value the CLI reported, and shows what the CLI answers', async () => {
    const { write, user } = setup()
    const button = await toggle()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await user.click(button)
    expect(write).toHaveBeenCalledWith('cli-codex', 'on', 'speed')
    await vi.waitFor(() => {
      expect(button.getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('turns it off again', async () => {
    const { write, user } = setup({ reply: ON, write: () => Promise.resolve(OFF) })
    await user.click(await toggle())
    expect(write).toHaveBeenCalledWith('cli-codex', 'off', 'speed')
  })

  // Before the CLI starts the pick only waits; the toggle shows it, and when it applies.
  it('shows a pick the CLI has not confirmed yet, with when it applies', async () => {
    setup({ reply: { ...OFF, speedPending: 'on' } })
    const button = await toggle()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('title')).toContain('下一条消息发送时生效')
  })

  // Turned on and back off before the CLI starts: the pick left waiting changes nothing.
  it('does not call a pick pending when it is what the CLI already has', async () => {
    setup({ reply: { ...OFF, speedPending: 'off' } })
    const button = await toggle()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('title')).not.toContain('下一条消息发送时生效')
  })

  it('reports a refused switch', async () => {
    const { user } = setup({ write: () => Promise.reject(new Error('当前模型不支持快速模式')) })
    await user.click(await toggle())
    expect((await screen.findByRole('alert')).textContent).toContain('切换快速模式失败：当前模型不支持快速模式')
    await user.click(screen.getByRole('button', { name: 'stub-toast-done' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cannot be used while the session is gone', async () => {
    const { write, user } = setup({ locked: true })
    const button = await toggle()
    expect(button).toHaveProperty('disabled', true)
    await user.click(button)
    expect(write).not.toHaveBeenCalled()
  })

  it('shows on its own for a CLI that reports a fast mode but no modes', async () => {
    setup({ reply: { modes: undefined, pending: undefined, speed: fast('off') } })
    expect(await toggle()).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
  })

  it('asks again while a fast-mode pick waits for a running session', async () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn<ModeApi['read']>(() => Promise.resolve({ ...OFF, speedPending: 'on' }))
      render(
        <div data-composer-card>
          <ModeMenu provider="cli-codex" api={{ read, write: vi.fn<ModeApi['write']>() }} locked={false} started />
        </div>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const initial = read.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MODE_POLL_MS * 2)
      })
      expect(read.mock.calls.length).toBe(initial + 2)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  // A turn can move the CLI to a model without a fast tier, and nothing else would tell
  // the toggle: it reads again once the turn is over.
  it('reads again when a turn ends, and goes once the model has no fast mode', async () => {
    let answer: ModeReply = ON
    const read = vi.fn<ModeApi['read']>(() => Promise.resolve(answer))
    const api = { read, write: vi.fn<ModeApi['write']>() }
    const view = (running: boolean) => (
      <div data-composer-card>
        <ModeMenu provider="cli-codex" api={api} locked={false} started running={running} />
      </div>
    )
    const { rerender } = render(view(true))
    await toggle()
    answer = { modes: MODES, pending: undefined }
    rerender(view(false))
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /^快速模式/ })).toBeNull()
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not read again while nothing has run', async () => {
    const read = vi.fn<ModeApi['read']>(() => Promise.resolve(OFF))
    const api = { read, write: vi.fn<ModeApi['write']>() }
    const view = (running: boolean) => (
      <div data-composer-card>
        <ModeMenu provider="cli-codex" api={api} locked={false} started running={running} />
      </div>
    )
    const { rerender } = render(view(false))
    await toggle()
    rerender(view(false))
    rerender(view(true))
    expect(read).toHaveBeenCalledTimes(1)
  })

  // Before the CLI starts, the fast mode shown depends on the model picked for the session.
  it('reads again when the session picks another model', async () => {
    const read = vi.fn<ModeApi['read']>(() => Promise.resolve(OFF))
    const api = { read, write: vi.fn<ModeApi['write']>() }
    const view = (model: string) => (
      <div data-composer-card>
        <ModeMenu provider="cli-codex" api={api} locked={false} started={false} model={model} />
      </div>
    )
    const { rerender } = render(view('default'))
    await toggle()
    rerender(view('default'))
    expect(read).toHaveBeenCalledTimes(1)
    rerender(view('gpt-slow'))
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })
  })
})
