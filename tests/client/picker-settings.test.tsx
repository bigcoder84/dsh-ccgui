// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The picker's reasoning slider, its fast-mode bolt and the CLI's own mode row. The mode and
 * the fast mode are the CLI's own: these tests check that its ids pass through untouched and
 * that the picker reads them again whenever they may have moved.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModeApi, ModeReply } from '../../src/client/mode-api.ts'
import { SETTINGS_POLL_MS, SETTINGS_POLL_TRIES } from '../../src/client/picker/use-cli-settings.ts'
import {
  CODEX_SELECTION,
  CODEX_STATE,
  HARNESS_SELECTION,
  HARNESS_STATE,
  MODES,
  NO_SETTINGS,
  fast,
  openPicker,
  renderPicker,
  trigger,
} from '../fixtures/picker-harness.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SETTINGS: ModeReply = { modes: MODES, pending: undefined, speed: fast('off') }
const slider = (): HTMLElement => screen.getByRole('slider', { name: '思考深度' })
const BOLT_NAME = /^(开启快速模式|快速模式已开启)/
const bolt = (): HTMLElement => screen.getByRole('button', { name: BOLT_NAME })
const modeRow = (): HTMLElement => screen.getByRole('button', { name: /CLI 模式/ })
/** The host tooltip a control sits in; the stub keeps its label on the wrapper. */
const tipOf = (control: HTMLElement): string | null | undefined =>
  control.closest('[data-tooltip]')?.getAttribute('data-tooltip')

describe('the reasoning slider', () => {
  it('shows the levels of the model in use, at the one in effect', async () => {
    const h = renderPicker()
    await openPicker(h)
    expect(slider().getAttribute('aria-valuemax')).toBe('3')
    expect(slider().getAttribute('aria-valuenow')).toBe('2')
    expect(slider().getAttribute('aria-valuetext')).toBe('高')
  })

  it('is left out for a model without levels', async () => {
    const h = renderPicker({ state: { ...CODEX_STATE, current: { provider: 'cli-codex', model: 'default' } } })
    await openPicker(h)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it.each([
    ['{ArrowRight}', 'xhigh'],
    ['{ArrowLeft}', 'medium'],
    ['{Home}', 'low'],
  ])('steps with %s', async (key, effort) => {
    const h = renderPicker()
    await openPicker(h)
    slider().focus()
    await h.user.keyboard(key)
    expect(h.select).toHaveBeenCalledWith({ provider: 'cli-codex', model: 'gpt-6-sol', reasoningEffort: effort })
  })

  it('leaves the session alone for a key that does not move it', async () => {
    const h = renderPicker({ state: { ...CODEX_STATE, current: { ...CODEX_SELECTION, reasoningEffort: 'xhigh' } } })
    await openPicker(h)
    slider().focus()
    await h.user.keyboard('{End}{a}')
    expect(h.select).not.toHaveBeenCalled()
  })

  it('marks the top level as costlier', async () => {
    const h = renderPicker({ state: { ...CODEX_STATE, current: { ...CODEX_SELECTION, reasoningEffort: 'xhigh' } } })
    const popover = await openPicker(h)
    expect(popover.textContent).toContain('用量消耗更快')
    expect(popover.querySelector('[data-top="true"]')).not.toBeNull()
  })

  // The track is 218px wide: 9px of thumb at either end and 200px between the first and last level.
  it('follows a drag freely and sends only the level it is let go at', async () => {
    const h = renderPicker()
    await openPicker(h)
    const track = slider()
    track.getBoundingClientRect = () => new DOMRect(0, 0, 218, 18)
    track.setPointerCapture = vi.fn<(id: number) => void>()
    fireEvent.pointerDown(track, { clientX: 9, pointerId: 1 })
    expect(track.getAttribute('aria-valuetext')).toBe('低')
    fireEvent.pointerMove(track, { clientX: 142, pointerId: 1 })
    expect(track.getAttribute('aria-valuetext')).toBe('高')
    expect(track.hasAttribute('data-dragging')).toBe(true)
    expect(h.select).not.toHaveBeenCalled()
    fireEvent.pointerUp(track, { clientX: 212, pointerId: 1 })
    expect(h.select).toHaveBeenCalledWith({ provider: 'cli-codex', model: 'gpt-6-sol', reasoningEffort: 'xhigh' })
    fireEvent.pointerMove(track, { clientX: 9, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 9, pointerId: 1 })
    expect(h.select).toHaveBeenCalledTimes(1)
  })

  it('goes back to the model default with the reset arrow', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.click(screen.getByRole('button', { name: '恢复这个模型的默认深度' }))
    expect(h.select).toHaveBeenCalledWith({ provider: 'cli-codex', model: 'gpt-6-sol', reasoningEffort: 'medium' })
  })

  // A model naming no default leaves the level to its provider, the leftmost stop.
  it('goes back to the provider choice for a model naming no default, sending no level', async () => {
    const h = renderPicker({
      state: { ...HARNESS_STATE, current: { ...HARNESS_SELECTION, reasoningEffort: 'high' } },
    })
    await openPicker(h)
    expect(slider().getAttribute('aria-valuemax')).toBe('4')
    await h.user.click(screen.getByRole('button', { name: '恢复这个模型的默认深度' }))
    expect(h.select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-chat' })
  })

  // Showing the old selection until the harness settles the new one made the picker flash.
  it('shows a selection the harness is settling, without dimming anything', async () => {
    const pending = { ...CODEX_SELECTION, reasoningEffort: 'xhigh' }
    const h = renderPicker({ state: { ...CODEX_STATE, pending } })
    await openPicker(h)
    expect(slider().getAttribute('aria-valuetext')).toBe('极高')
    expect(slider().getAttribute('aria-disabled')).toBe('false')
    expect(screen.getAllByRole('menuitemradio').some((row) => row.hasAttribute('disabled'))).toBe(false)
    expect(trigger().textContent).toContain('极高')
  })

  it('sends a change made while another settles once it has, the last one only', async () => {
    const h = renderPicker({ state: { ...CODEX_STATE, pending: { ...CODEX_SELECTION, reasoningEffort: 'xhigh' } } })
    await openPicker(h)
    slider().focus()
    await h.user.keyboard('{Home}{ArrowRight}')
    expect(h.select).not.toHaveBeenCalled()
    h.directory.set({ ...CODEX_STATE, current: { ...CODEX_SELECTION, reasoningEffort: 'xhigh' }, pending: null })
    expect(h.select).toHaveBeenCalledTimes(1)
    expect(h.select).toHaveBeenCalledWith({ ...CODEX_SELECTION, reasoningEffort: 'medium' })
  })

  // The harness may mark the change pending a moment after the slider lets go.
  it('holds the level let go at until the harness reports it, and lets go if it never does', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const h = renderPicker()
    await openPicker(h)
    act(() => {
      slider().focus()
    })
    fireEvent.keyDown(slider(), { key: 'End' })
    expect(slider().getAttribute('aria-valuetext')).toBe('极高')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(slider().getAttribute('aria-valuetext')).toBe('高')
  })
})

describe('the fast-mode bolt', () => {
  it('is hidden while the model has no fast mode', async () => {
    const h = renderPicker({ reply: { modes: MODES, pending: undefined } })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledWith('cli-codex')
    })
    // The bolt keeps its place in the row, so the level's name does not move, but is hidden.
    expect(screen.queryByRole('button', { name: BOLT_NAME })).toBeNull()
    expect(document.querySelector<HTMLElement>('[aria-pressed]')?.hidden).toBe(true)
  })

  it('turns fast mode on with the value the CLI reported, and shows what it answers', async () => {
    const on: ModeReply = { ...SETTINGS, speed: fast('on') }
    const h = renderPicker({ reply: SETTINGS, write: () => Promise.resolve(on) })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(bolt().hidden).toBe(false)
    })
    expect(bolt().getAttribute('aria-pressed')).toBe('false')
    await h.user.click(bolt())
    expect(h.write).toHaveBeenCalledWith('cli-codex', 'on', 'speed')
    await vi.waitFor(() => {
      expect(bolt().getAttribute('aria-pressed')).toBe('true')
    })
    // The button keeps the provider's mark and adds the bolt after the level.
    expect(trigger().querySelector('[data-cli-mark="codex"]')).not.toBeNull()
    expect(trigger().getAttribute('aria-label')).toContain('快速模式')
  })

  it('turns it off again', async () => {
    const h = renderPicker({ reply: { ...SETTINGS, speed: fast('on') } })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(bolt().getAttribute('aria-pressed')).toBe('true')
    })
    await h.user.click(bolt())
    expect(h.write).toHaveBeenCalledWith('cli-codex', 'off', 'speed')
  })

  it('counts a pick the CLI has not taken yet as on, saying when it applies', async () => {
    const h = renderPicker({ reply: { ...SETTINGS, speedPending: 'on' } })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(bolt().getAttribute('aria-pressed')).toBe('true')
    })
    expect(tipOf(bolt())).toBe('快速模式已开启：响应更快，用量更高，下一条消息发送时生效')
  })

  // The fake CLI's default model is one: a fast tier, no reasoning levels.
  it('keeps the bolt alone for a model with a fast tier but no levels', async () => {
    const h = renderPicker({
      state: { ...CODEX_STATE, current: { provider: 'cli-codex', model: 'default' } },
      reply: SETTINGS,
    })
    const popover = await openPicker(h)
    await vi.waitFor(() => {
      expect(bolt().hidden).toBe(false)
    })
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('button', { name: '恢复这个模型的默认深度' })).toBeNull()
    expect(popover.textContent).toContain('快速模式')
    expect(tipOf(bolt())).toBe('开启快速模式：响应更快，用量更高')
    // The host tooltip says it; a native one as well would show the same words twice.
    expect(bolt().hasAttribute('title')).toBe(false)
  })

  it('reports a refused switch in a toast', async () => {
    const h = renderPicker({ reply: SETTINGS, write: () => Promise.reject(new Error('busy')) })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(bolt().hidden).toBe(false)
    })
    await h.user.click(bolt())
    expect((await screen.findByRole('alert')).textContent).toContain('切换失败：busy')
    await h.user.click(screen.getByRole('button', { name: 'stub-toast-done' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe("the CLI's own mode", () => {
  it('shows the mode in the footer and claims the access control seat from the button', async () => {
    const h = renderPicker({ reply: SETTINGS })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(modeRow().textContent).toContain('Agent')
    })
    expect(trigger().hasAttribute('data-cli-modes')).toBe(true)
  })

  it('lists the modes in the CLI order and sends the id the CLI reported', async () => {
    const h = renderPicker({ reply: SETTINGS, write: () => Promise.resolve({ ...SETTINGS, pending: 'read-only' }) })
    await openPicker(h)
    await h.user.click(await screen.findByRole('button', { name: /CLI 模式/ }))
    const options = screen.getAllByRole('menuitemradio').filter((item) => item.closest('[aria-label="CLI 模式"]'))
    expect(options.map((option) => option.textContent)).toEqual(['Read Only', 'Agent', 'Full Access'])
    expect(options[1]?.getAttribute('aria-checked')).toBe('true')
    await h.user.click(options[0] ?? document.body)
    expect(h.write).toHaveBeenCalledWith('cli-codex', 'read-only', 'mode')
    await vi.waitFor(() => {
      expect(modeRow().getAttribute('title')).toBe('CLI 模式：Read Only，下一条消息发送时生效')
    })
  })

  it('leaves the CLI alone when its mode is chosen again', async () => {
    const h = renderPicker({ reply: SETTINGS })
    await openPicker(h)
    await h.user.click(await screen.findByRole('button', { name: /CLI 模式/ }))
    await h.user.click(screen.getByRole('menuitemradio', { name: 'Agent' }))
    expect(h.write).not.toHaveBeenCalled()
  })

  it('flags a mode without the usual approvals on the button', async () => {
    renderPicker({ reply: { ...SETTINGS, modes: { ...MODES, current: 'full-access' } } })
    await vi.waitFor(() => {
      expect(trigger().getAttribute('title')).toBe('选择模型和思考深度（当前 CLI 模式：Full Access）')
    })
    expect(trigger().getAttribute('aria-label')).toContain('Full Access')
  })

  it.each([
    ['the CLI reports no modes', { reply: NO_SETTINGS }],
    ['the route cannot be read', { read: () => Promise.reject(new Error('gone')) }],
    ['the harness offers no route', { overrides: { modes: undefined } }],
  ])('is left out when %s', async (_case, options) => {
    const h = renderPicker(options)
    await openPicker(h)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
    expect(trigger().hasAttribute('data-cli-modes')).toBe(false)
  })

  it('is not read on a session the harness runs', async () => {
    const h = renderPicker({ state: HARNESS_STATE, reply: SETTINGS })
    await openPicker(h)
    expect(h.read).not.toHaveBeenCalled()
  })
})

describe('reading the settings again', () => {
  it('reads again once a turn ends, not while nothing has run', async () => {
    const h = renderPicker({ reply: SETTINGS, session: { blank: false, running: false } })
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledTimes(1)
    })
    h.session.set({ blank: false, running: true })
    expect(h.read).toHaveBeenCalledTimes(1)
    h.session.set({ blank: false, running: false })
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledTimes(2)
    })
  })

  it('reads again when the session picks another model', async () => {
    const h = renderPicker({ reply: SETTINGS })
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledTimes(1)
    })
    h.directory.set({ ...CODEX_STATE, current: { provider: 'cli-codex', model: 'gpt-6-luna' } })
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledTimes(2)
    })
  })

  // Nothing tells the picker when a pick is taken: it asks for a while, then stops.
  it('asks again while a pick waits, and stops once its budget runs out', async () => {
    vi.useFakeTimers()
    const h = renderPicker({ reply: { ...SETTINGS, pending: 'read-only' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initial = h.read.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTINGS_POLL_MS * (SETTINGS_POLL_TRIES + 2))
    })
    expect(h.read.mock.calls.length).toBe(initial + SETTINGS_POLL_TRIES)
  })

  it('does not ask again before the session has a CLI to take the pick', async () => {
    vi.useFakeTimers()
    const h = renderPicker({ reply: { ...SETTINGS, speedPending: 'on' }, session: { blank: true } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTINGS_POLL_MS * 3)
    })
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('keeps the last answer when a read after a turn fails', async () => {
    let fail = false
    const read: ModeApi['read'] = () => (fail ? Promise.reject(new Error('gone')) : Promise.resolve(SETTINGS))
    const h = renderPicker({ read, session: { blank: false, running: true } })
    await openPicker(h)
    await vi.waitFor(() => {
      expect(modeRow().textContent).toContain('Agent')
    })
    fail = true
    h.session.set({ blank: false, running: false })
    await vi.waitFor(() => {
      expect(h.read).toHaveBeenCalledTimes(2)
    })
    expect(modeRow().textContent).toContain('Agent')
  })
})
