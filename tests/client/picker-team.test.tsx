// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The picker's teamwork switch on a session the harness runs, and how the picker is put into
 * the composer: its slot, its shortcut, and the harness's teamwork remote it writes through.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCliPrefs } from '../../src/client/cli-prefs.ts'
import { createLastSelections } from '../../src/client/last-selections.ts'
import type { ModeApi } from '../../src/client/mode-api.ts'
import { registerPicker } from '../../src/client/picker/picker-register.ts'
import type { PickerContext } from '../../src/client/picker/picker-register.ts'
import { registerPickerShortcut } from '../../src/client/picker/picker-shortcut.ts'
import type { ShortcutRegistry } from '../../src/client/picker/picker-shortcut.ts'
import type { TeamApi } from '../../src/client/picker/use-picker-actions.ts'
import { createStore } from '../fixtures/client-store.ts'
import { CODEX_STATE, HARNESS_STATE, openPicker, renderPicker } from '../fixtures/picker-harness.tsx'

afterEach(cleanup)

const ON = { agentTeam: { enabled: true }, modelSelection: { lastUsed: null } }
const switchOf = (): HTMLElement => screen.getByRole('switch', { name: '智能体团队协作' })

describe('the teamwork switch', () => {
  it('shows on a session the harness runs, as the harness reports it', async () => {
    const h = renderPicker({ state: HARNESS_STATE, projections: ON })
    await openPicker(h)
    expect(switchOf().getAttribute('aria-checked')).toBe('true')
    h.projections.set({ ...ON, agentTeam: { enabled: false } })
    expect(switchOf().getAttribute('aria-checked')).toBe('false')
  })

  it.each([
    ['a CLI session', { state: CODEX_STATE, projections: ON }],
    ['a harness that reports no teamwork', { state: HARNESS_STATE, projections: {} }],
    ['a harness with no teamwork remote', { state: HARNESS_STATE, projections: ON, overrides: { team: undefined } }],
  ])('is left out on %s', async (_case, options) => {
    const h = renderPicker(options)
    await openPicker(h)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('turns teamwork on, and off at once before the conversation has run', async () => {
    const h = renderPicker({ state: HARNESS_STATE, projections: { agentTeam: { enabled: false } } })
    await openPicker(h)
    await h.user.click(switchOf())
    expect(h.team).toHaveBeenLastCalledWith(true)
    h.projections.set(ON)
    await h.user.click(switchOf())
    expect(h.team).toHaveBeenLastCalledWith(false)
  })

  it('asks before turning it off mid-conversation, and keeps the picker open meanwhile', async () => {
    const running = { ...ON, modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-chat' } } }
    const h = renderPicker({ state: HARNESS_STATE, projections: running })
    await openPicker(h)
    await h.user.click(switchOf())
    const confirm = screen.getByRole('dialog', { name: '确认停用智能体团队协作？' })
    // Escape there is the confirmation's own, and leaves the picker open behind it.
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).not.toBeNull()
    await h.user.click(screen.getByRole('button', { name: '取消' }))
    expect(h.team).not.toHaveBeenCalled()
    await h.user.click(switchOf())
    await h.user.click(screen.getByRole('button', { name: '确认停用' }))
    expect(h.team).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).not.toBeNull()
  })

  it.each([
    ['a refusal', () => Promise.resolve('no permission'), 'no permission'],
    ['a rejection', () => Promise.reject(new Error('offline')), 'offline'],
  ])('reports %s in a toast', async (_case, team: TeamApi['set'], text) => {
    const h = renderPicker({ state: HARNESS_STATE, projections: { agentTeam: { enabled: false } }, team })
    await openPicker(h)
    await h.user.click(switchOf())
    expect((await screen.findByRole('alert')).textContent).toContain(
      `切换失败：无法确认智能体团队协作设置已保存，请重试：${text}`,
    )
  })
})

interface Registered {
  readonly options: { name: string; id: string; order?: number; inject(sessionId: string): unknown }
  readonly component: unknown
}

type Child = Parameters<Parameters<PickerContext['inject']>[1]>[0]

function context(services: Omit<Child, keyof PickerContext>) {
  const registered: Registered[] = []
  const effects: (() => () => void)[] = []
  const ctx: PickerContext = {
    slots: {
      inject: (_name, add) => {
        add()
      },
      register: (options, component) => {
        registered.push({ options, component })
        return undefined
      },
    },
    effect: (run) => {
      effects.push(run)
    },
    inject: (_deps, apply) => {
      apply({ ...ctx, ...services })
      return undefined
    },
  }
  const memory = { getItem: () => null, setItem: () => undefined }
  const modes: ModeApi = { read: vi.fn<ModeApi['read']>(), write: vi.fn<ModeApi['write']>() }
  registerPicker(ctx, {
    face: () => ({ directory: createStore(CODEX_STATE), load: vi.fn(), select: vi.fn(), session: undefined }),
    available: (sessionId) => sessionId !== 'subagent',
    modes: () => modes,
    prefs: createCliPrefs(memory),
    lastSelections: createLastSelections(memory),
  })
  const teamOf = (sessionId: string): TeamApi => {
    const injected = registered[0]?.options.inject(sessionId) as { team: TeamApi }
    return injected.team
  }
  return { registered, effects, teamOf, modes }
}

describe('registerPicker', () => {
  it("puts the picker last in the composer's right-hand seat, with what each session needs", () => {
    const { registered, modes } = context({})
    expect(registered.map(({ options }) => [options.id, options.name, options.order])).toEqual([
      ['dsh-ccgui.picker', 'conversation.input.right', 1000],
    ])
    // The registry goes along, so the picker can show what other plugins add to the model menu.
    const injected = registered[0]?.options.inject('s1')
    expect(injected).toMatchObject({ available: true, modes })
    expect(injected).toHaveProperty('slots')
    expect(registered[0]?.options.inject('subagent')).toMatchObject({ available: false })
  })

  it("writes teamwork through the harness's remote while it is there", async () => {
    const setEnabled = vi.fn((_id: string, enabled: boolean) =>
      Promise.resolve(enabled ? { ok: true as const } : { ok: false as const, error: { message: 'locked' } }),
    )
    const { effects, teamOf } = context({ remote: { agentTeams: { setEnabled } } })
    const team = teamOf('s1')
    await expect(team.set(true)).resolves.toBe('当前环境不支持修改智能体团队协作')
    const stops = effects.map((run) => run())
    await expect(team.set(true)).resolves.toBeNull()
    await expect(team.set(false)).resolves.toBe('locked')
    expect(setEnabled).toHaveBeenCalledWith('s1', true)
    for (const stop of stops) stop()
    await expect(team.set(true)).resolves.toBe('当前环境不支持修改智能体团队协作')
  })

  it('registers its shortcut when the harness has a registry', () => {
    const remove = vi.fn()
    const register = vi.fn<ShortcutRegistry['register']>(() => remove)
    const { effects } = context({ shortcuts: { register } })
    const stops = effects.map((run) => run())
    expect(register).toHaveBeenCalledTimes(1)
    for (const stop of stops) stop()
    expect(remove).toHaveBeenCalled()
  })
})

describe('the shortcut', () => {
  it('binds Control+Shift+M on macOS and Ctrl+Shift+M elsewhere, on the desktop only', () => {
    const register = vi.fn<ShortcutRegistry['register']>(() => () => undefined)
    registerPickerShortcut({ register })
    const command = register.mock.calls[0]?.[0]
    expect(command?.id).toBe('dsh-ccgui.picker.toggle')
    expect(command?.label()).toBe('选择模型和思考深度')
    expect(command?.defaults).toEqual({
      'desktop:macos': { code: 'KeyM', modifiers: ['control', 'shift'] },
      'desktop:windows': { code: 'KeyM', modifiers: ['primary', 'shift'] },
      'desktop:linux': { code: 'KeyM', modifiers: ['primary', 'shift'] },
    })
    // No picker is on screen in this test, so the key is left to others.
    expect(command?.resolve({})).toEqual({ status: 'pass' })
  })

  it('toggles the picker on screen', () => {
    const register = vi.fn<ShortcutRegistry['register']>(() => () => undefined)
    registerPickerShortcut({ register })
    renderPicker()
    const button = screen.getByRole('button', { name: /^选择模型和思考深度/ })
    button.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList
    const answer = register.mock.calls[0]?.[0].resolve({})
    expect(answer?.status).toBe('handled')
    if (answer?.status === 'handled') act(answer.run)
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})
