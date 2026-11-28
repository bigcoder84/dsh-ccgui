// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The model picker's button, its popover, the provider tabs and the model rows. The reasoning
 * slider, the CLI's own settings and teamwork have tests of their own.
 */

import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_PREFS_STORAGE_KEY, parseCliPrefs } from '../../src/client/cli-prefs.ts'
import { LAST_SELECTIONS_STORAGE_KEY, parseLastSelections } from '../../src/client/last-selections.ts'
import { togglePicker } from '../../src/client/picker/picker-shortcut.ts'
import { PICKER_ROW_NAME_CLASS } from '../../src/client/picker/picker-styles.ts'
import {
  CLAUDE_GROUP,
  CODEX_STATE,
  DEEPSEEK_GROUP,
  HARNESS_STATE,
  openPicker,
  renderPicker,
  trigger,
} from '../fixtures/picker-harness.tsx'

afterEach(cleanup)

const rows = (): HTMLElement[] => screen.getAllByRole('menuitemradio')
const rowNames = (): string[] => rows().map((row) => row.querySelector(`.${PICKER_ROW_NAME_CLASS}`)?.textContent ?? '')
const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })

describe('the picker button', () => {
  it('shows the provider mark, the model and the level in effect, and loads the catalog', () => {
    const h = renderPicker()
    expect(trigger().querySelector('[data-cli-mark="codex"]')).not.toBeNull()
    expect(trigger().textContent).toContain('GPT-6 Sol')
    expect(trigger().textContent).toContain('高')
    expect(trigger().getAttribute('aria-label')).toBe('选择模型和思考深度，当前 GPT-6 Sol，高')
    expect(h.load).toHaveBeenCalled()
  })

  it('says it is loading before the catalog arrives, and asks for a model when none is in it', () => {
    const h = renderPicker({ state: { groups: [], current: null, status: 'loading' } })
    expect(trigger().textContent).toContain('正在加载模型…')
    h.directory.set({ groups: [], current: null })
    expect(trigger().textContent).toContain('请选择模型')
  })

  it.each([
    ['an addressed subagent', { overrides: { available: false } }],
    ['a removed session', { session: { removed: true } }],
  ])('is disabled for %s', async (_case, options) => {
    const h = renderPicker(options)
    expect(trigger()).toHaveProperty('disabled', true)
    await h.user.click(trigger())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('follows directory updates', () => {
    const h = renderPicker()
    h.directory.set({ ...CODEX_STATE, current: { provider: 'cli-codex', model: 'gpt-6-luna' } })
    expect(trigger().textContent).toContain('GPT-6 Luna')
    expect(trigger().textContent).toContain('中')
  })
})

describe('opening and closing', () => {
  it('opens on the button, loading the catalog again, and closes on it', async () => {
    const h = renderPicker()
    const calls = h.load.mock.calls.length
    await openPicker(h)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(h.load.mock.calls.length).toBe(calls + 1)
    await h.user.click(trigger())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes with Escape and on a press outside, not on one inside or in a dialog it opened', async () => {
    const h = renderPicker()
    const popover = await openPicker(h)
    fireEvent.pointerDown(popover)
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).not.toBeNull()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.pointerDown(dialog)
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).not.toBeNull()
    dialog.remove()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).toBeNull()
    await openPicker(h)
    await h.user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '选择模型和思考深度' })).toBeNull()
    // Escape hands the keyboard back to the button.
    expect(document.activeElement).toBe(trigger())
  })

  it('answers the shortcut only while its button is on screen', () => {
    renderPicker()
    // jsdom lays nothing out, so a button counts as on screen once it reports a box.
    expect(togglePicker()).toBe(false)
    const button = trigger()
    button.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList
    act(() => {
      expect(togglePicker()).toBe(true)
    })
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

describe('provider tabs', () => {
  // Providers the user added in the harness's model settings are listed under its one tab,
  // which takes the place of the first of them.
  it('lists every provider once, the harness as one, and selects the one in use', async () => {
    const custom = { id: 'teamo', name: 'Teamo', models: [{ id: 'm1', name: 'M1' }] }
    const h = renderPicker({ state: { ...CODEX_STATE, groups: [custom, ...CODEX_STATE.groups] } })
    await openPicker(h)
    expect(screen.getAllByRole('tab').map((item) => item.getAttribute('aria-label'))).toEqual([
      'DeepSeek',
      'Claude Code',
      'Codex CLI',
    ])
    expect(tab('Codex CLI').getAttribute('aria-selected')).toBe('true')
  })

  it('follows the saved order, and remembers the providers for the settings page', async () => {
    const order = JSON.stringify({ known: [], order: ['deepseek-official', 'cli-codex'], hidden: [] })
    const h = renderPicker({ storage: { [CLI_PREFS_STORAGE_KEY]: order } })
    await openPicker(h)
    expect(screen.getAllByRole('tab').map((item) => item.getAttribute('aria-label'))).toEqual([
      'DeepSeek',
      'Codex CLI',
      'Claude Code',
    ])
    expect(parseCliPrefs(h.storage.get(CLI_PREFS_STORAGE_KEY) ?? null).known.map(({ id }) => id)).toEqual([
      'cli-claude',
      'cli-codex',
      'deepseek-official',
    ])
  })

  it.each([
    ['a CLI on its default model', 'Claude Code', { provider: 'cli-claude', model: 'default' }],
    ['the harness on its first model', 'DeepSeek', { provider: 'deepseek-official', model: 'deepseek-chat' }],
  ])('switches a new session to %s', async (_case, name, selection) => {
    const h = renderPicker({ session: { blank: true } })
    await openPicker(h)
    await h.user.click(tab(name))
    expect(h.select).toHaveBeenCalledWith(selection)
  })

  it('starts a provider on the model and level last used there', async () => {
    const flash = { provider: 'deepseek-official', model: 'deepseek-flash' }
    const h = renderPicker({
      session: { blank: true },
      storage: { [LAST_SELECTIONS_STORAGE_KEY]: JSON.stringify({ 'deepseek-official': flash }) },
    })
    await openPicker(h)
    await h.user.click(tab('DeepSeek'))
    expect(h.select).toHaveBeenCalledWith(flash)
  })

  it('does nothing for the tab in use', async () => {
    const h = renderPicker({ session: { blank: true } })
    await openPicker(h)
    await h.user.click(tab('Codex CLI'))
    expect(h.select).not.toHaveBeenCalled()
  })

  it('keeps a started session on its provider, saying how to change it', async () => {
    const h = renderPicker()
    await openPicker(h)
    expect(tab('Claude Code')).toHaveProperty('disabled', true)
    expect(tab('Claude Code').getAttribute('title')).toBe('要换 CLI，请新建会话')
    expect(tab('Codex CLI')).toHaveProperty('disabled', false)
  })

  it("remembers the session's selection under its tab as it changes", () => {
    const h = renderPicker()
    const recalled = () => parseLastSelections(h.storage.get(LAST_SELECTIONS_STORAGE_KEY) ?? null)
    expect(recalled()['cli-codex']).toEqual(CODEX_STATE.current)
    h.directory.set(HARNESS_STATE)
    expect(recalled()['deepseek-official']).toEqual(HARNESS_STATE.current)
  })
})

describe('model rows', () => {
  it("lists only the provider's own models, with the selected one checked", async () => {
    const h = renderPicker()
    await openPicker(h)
    // The row standing for the CLI's own setting is the first; its name drops the suffix.
    expect(rowNames()).toEqual(['GPT-6 Terra', 'GPT-6 Sol', 'GPT-6 Luna'])
    expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('lists every provider the harness runs on a harness session, under headings', async () => {
    const account = { id: 'deepseek-account', name: 'deepseek-account', models: [{ id: 'v4', name: 'V4' }] }
    const h = renderPicker({ state: { ...HARNESS_STATE, groups: [CLAUDE_GROUP, DEEPSEEK_GROUP, account] } })
    const popover = await openPicker(h)
    expect(
      within(popover)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['DeepSeek 账号', 'DeepSeek'])
    expect(rowNames()).toEqual(['V4', 'DeepSeek Chat', 'DeepSeek Flash'])
  })

  // A CLI's own logo names the CLI, not the maker of every model it happens to list.
  it("marks each row with the model's maker, and a neutral mark where it is unknown", async () => {
    const h = renderPicker({ state: { ...CODEX_STATE, current: { provider: 'cli-claude', model: 'default' } } })
    await openPicker(h)
    expect(rows().map((row) => row.querySelector('[data-cli-mark]')?.getAttribute('data-cli-mark'))).toEqual(['claude'])
    h.directory.set(CODEX_STATE)
    expect(rows().map((row) => row.querySelector('[data-cli-mark]')?.getAttribute('data-cli-mark'))).toEqual([
      'codex',
      'codex',
      'codex',
    ])
  })

  it('shows the cost note, the badge, and the level each row runs at', async () => {
    const h = renderPicker()
    await openPicker(h)
    const luna = rows()[2]
    expect(luna?.textContent).toContain('0.5x')
    expect(luna?.querySelector('[data-tone="brand"]')?.textContent).toBe('New')
    // The selected row runs at the level in effect, the others at their own default.
    expect(rows()[1]?.textContent).toContain('高')
    expect(luna?.textContent).toContain('中')
  })

  it('selects a clicked model at its own default level, staying open', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.click(rows()[2] ?? document.body)
    expect(h.select).toHaveBeenCalledWith({ provider: 'cli-codex', model: 'gpt-6-luna' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('leaves the session alone when the selected model is clicked', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.click(rows()[1] ?? document.body)
    expect(h.select).not.toHaveBeenCalled()
  })

  it.each([
    ['an error answer', () => Promise.resolve({ error: { message: 'no such model' } }), '切换失败：no such model'],
    ['an error without a message', () => Promise.resolve({ error: {} }), '切换失败：未知错误'],
    ['a rejection', () => Promise.reject(new Error('down')), '切换失败：down'],
  ])('reports %s in a toast, until it is done', async (_case, select, text) => {
    const h = renderPicker({ select })
    await openPicker(h)
    await h.user.click(rows()[2] ?? document.body)
    expect((await screen.findByRole('alert')).textContent).toContain(text)
    await h.user.click(screen.getByRole('button', { name: 'stub-toast-done' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the empty list', () => {
  it.each([
    ['while the catalog loads', { groups: [], current: null, status: 'loading' }, '正在加载模型…'],
    ['when the provider has no models', { groups: [], current: null }, '暂无可用模型'],
  ])('says so %s', async (_case, state, text) => {
    const h = renderPicker({ state })
    const popover = await openPicker(h)
    expect(popover.textContent).toContain(text)
  })

  it('offers a retry when the catalog failed', async () => {
    const h = renderPicker({ state: { groups: [], current: null, error: '网络错误' } })
    await openPicker(h)
    const calls = h.load.mock.calls.length
    await h.user.click(screen.getByRole('button', { name: '重试' }))
    expect(h.load.mock.calls.length).toBe(calls + 1)
  })

  it('names the providers whose models did not load', async () => {
    const failures = [{ id: 'teamo', name: 'Teamo', message: 'timeout' }]
    const h = renderPicker({ state: { ...CODEX_STATE, failures } })
    const popover = await openPicker(h)
    expect(popover.textContent).toContain('Teamo 的模型没有加载出来')
  })
})

describe('search and keys', () => {
  const search = (): HTMLElement => screen.getByRole('textbox', { name: '搜索模型…' })

  it('takes the focus on open and filters the rows as you type', async () => {
    const h = renderPicker()
    await openPicker(h)
    expect(document.activeElement).toBe(search())
    await h.user.keyboard('luna')
    expect(rowNames()).toEqual(['GPT-6 Luna'])
  })

  it('chooses the first match with Enter', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.keyboard('luna{Enter}')
    expect(h.select).toHaveBeenCalledWith({ provider: 'cli-codex', model: 'gpt-6-luna' })
  })

  it('says when nothing matches, and Enter then does nothing', async () => {
    const h = renderPicker()
    const popover = await openPicker(h)
    await h.user.keyboard('zzz{Enter}')
    expect(popover.textContent).toContain('没有匹配的模型。')
    expect(h.select).not.toHaveBeenCalled()
  })

  it('moves between the field and the rows with the arrows, wrapping through the field', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows()[0])
    await h.user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(rows()[2])
    await h.user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(search())
    await h.user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(rows()[2])
  })

  it('leaves a pinyin Enter to the input method', async () => {
    const h = renderPicker()
    await openPicker(h)
    fireEvent.keyDown(search(), { key: 'Enter', isComposing: true })
    expect(h.select).not.toHaveBeenCalled()
  })

  it('ignores other keys', async () => {
    const h = renderPicker()
    await openPicker(h)
    await h.user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(search())
    vi.clearAllMocks()
  })
})
