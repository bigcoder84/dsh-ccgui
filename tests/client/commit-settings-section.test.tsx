// @vitest-environment jsdom
/// <reference lib="dom" />

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommitSettingsApi } from '../../src/client/commit-settings-api.ts'
import type { CommitSettingsApi, CommitSettingsView } from '../../src/client/commit-settings-api.ts'
import { CommitSettingsSection } from '../../src/client/commit-settings-section.tsx'
import type { Fetch } from '../../src/client/git-post.ts'
import { SettingsPage } from '../../src/client/settings-page.tsx'
import { createFeatureSettings } from '../../src/client/feature-settings.ts'
import { createCliPrefs } from '../../src/client/cli-prefs.ts'
import { createCliSwitches } from '../../src/client/cli-switches.ts'

const VIEW: CommitSettingsView = {
  model: null,
  prompt: '',
  defaultPrompt: '内置提示词',
  fallback: { provider: 'deepseek', model: 'chat' },
  models: [
    { provider: 'deepseek', providerName: 'DeepSeek', id: 'chat', name: 'DeepSeek Chat' },
    { provider: 'deepseek', providerName: 'DeepSeek', id: 'flash', name: 'Flash' },
    { provider: 'kimi', providerName: 'Kimi', id: 'k2', name: 'K2' },
  ],
  errors: [],
}

function fakeApi(view: CommitSettingsView = VIEW, save?: CommitSettingsApi['save']): CommitSettingsApi {
  const saveAs: CommitSettingsApi['save'] = save ?? (async (value) => ({ ...view, ...value }))
  return { read: vi.fn(async () => view), save: vi.fn(saveAs) }
}

const select = (): HTMLSelectElement => screen.getByRole('combobox')

afterEach(() => {
  cleanup()
})

describe('CommitSettingsSection', () => {
  it('offers following the default, named after the model it falls back on, and every listed model', async () => {
    render(<CommitSettingsSection api={fakeApi()} />)
    await screen.findByRole('combobox')
    const options = Array.from(select().options).map((option) => option.textContent)
    expect(options).toEqual(['跟随默认（DeepSeek · DeepSeek Chat）', 'DeepSeek Chat', 'Flash', 'K2'])
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    expect(screen.getByPlaceholderText('内置提示词')).toBeTruthy()
  })

  it('saves the chosen model and prompt', async () => {
    const api = fakeApi()
    const user = userEvent.setup()
    render(<CommitSettingsSection api={api} />)
    await user.selectOptions(await screen.findByRole('combobox'), 'K2')
    await user.type(screen.getByRole('textbox'), '写英文')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(api.save).toHaveBeenCalledWith({ model: { provider: 'kimi', model: 'k2' }, prompt: '写英文' })
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
  })

  it('goes back to the built-in prompt, saving a blank one as empty', async () => {
    const api = fakeApi({ ...VIEW, prompt: '旧的' })
    const user = userEvent.setup()
    render(<CommitSettingsSection api={api} />)
    await user.click(await screen.findByRole('button', { name: '恢复内置提示词' }))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(api.save).toHaveBeenCalledWith({ model: null, prompt: '' })
  })

  it('says when there is no model to fall back on, and keeps a saved model no longer listed', async () => {
    render(
      <CommitSettingsSection
        api={fakeApi({ ...VIEW, fallback: null, model: { provider: 'gone', model: 'm' }, errors: ['Kimi：密钥无效'] })}
      />,
    )
    await screen.findByRole('combobox')
    const options = Array.from(select().options).map((option) => option.textContent)
    expect(options[0]).toBe('跟随默认（当前没有可用模型，请选一个）')
    expect(options.at(-1)).toBe('gone/m（当前不可用）')
    expect(select().value).toBe(JSON.stringify(['gone', 'm']))
    expect(screen.getByText('这些提供方的模型没读到：Kimi：密钥无效')).toBeTruthy()
  })

  it('names a fallback the directory does not list by its route', async () => {
    render(<CommitSettingsSection api={fakeApi({ ...VIEW, models: [] })} />)
    await screen.findByRole('combobox')
    expect(select().options[0]?.textContent).toBe('跟随默认（deepseek/chat）')
  })

  it('shows why reading or saving failed', async () => {
    const failing: CommitSettingsApi = { read: () => Promise.reject(new Error('读不到')), save: vi.fn() }
    render(<CommitSettingsSection api={failing} />)
    expect((await screen.findByRole('alert')).textContent).toBe('读不到')
    cleanup()
    const user = userEvent.setup()
    render(<CommitSettingsSection api={fakeApi(VIEW, () => Promise.reject(new Error('写不进')))} />)
    await user.selectOptions(await screen.findByRole('combobox'), 'Flash')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect((await screen.findByRole('alert')).textContent).toBe('写不进')
  })

  it('is a tab of the settings page when the page is given the settings', async () => {
    const switches = createCliSwitches(
      { read: () => new Promise(() => undefined), set: vi.fn(), adopt: vi.fn() },
      () => [],
    )
    const storage = new Map<string, string>()
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    }
    render(
      <SettingsPage
        settings={createFeatureSettings(memory)}
        cliPrefs={createCliPrefs(memory)}
        cliSwitches={switches}
        commitSettings={fakeApi()}
      />,
    )
    await userEvent.click(screen.getByRole('tab', { name: '提交信息' }))
    expect(await screen.findByRole('combobox')).toBeTruthy()
  })
})

describe('createCommitSettingsApi', () => {
  it('reads and saves under the commit message route', async () => {
    const fetchFn = vi.fn<Fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: VIEW }), { status: 200 })),
    )
    const api = createCommitSettingsApi(fetchFn)
    expect(await api.read()).toEqual(VIEW)
    await api.save({ model: null, prompt: 'p' })
    await waitFor(() => {
      expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
        '/dsh-ccgui/commit-message/settings',
        '/dsh-ccgui/commit-message/save',
      ])
    })
    expect(fetchFn.mock.calls[1]?.[1].body).toBe(JSON.stringify({ model: null, prompt: 'p' }))
  })
})
