// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCliPrefs } from '../../src/client/cli-prefs.ts'
import type { CliPrefsStorage } from '../../src/client/cli-prefs.ts'
import { CLI_PREFS_STYLES, CliPrefsSection } from '../../src/client/cli-prefs-section.tsx'
import type { CliSwitchApi, CliSwitchEntry, CliSwitchReply } from '../../src/client/cli-switch-api.ts'
import { createCliSwitches } from '../../src/client/cli-switches.ts'

function memoryStorage(): CliPrefsStorage {
  let items: Readonly<Record<string, string>> = {}
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items = { ...items, [key]: value }
    },
  }
}

const CLAUDE: CliSwitchEntry = { id: 'cli-claude', label: 'Claude Code', enabled: true }
const CODEX: CliSwitchEntry = { id: 'cli-codex', label: 'Codex CLI', enabled: true }

/** The harness's entry comes from what the switcher saw; the CLIs come from the plugin. */
function seeded() {
  const prefs = createCliPrefs(memoryStorage())
  prefs.remember([{ id: 'deepseek-official', label: 'DeepSeek' }, CLAUDE])
  return prefs
}

/** A plugin that keeps its switches in memory and answers like the route. */
function plugin(clis: readonly CliSwitchEntry[] = [CLAUDE, CODEX]) {
  let current = clis
  const reply = (): CliSwitchReply => ({ clis: current, saved: true })
  const api: CliSwitchApi = {
    read: vi.fn(() => Promise.resolve(reply())),
    set: vi.fn((id: string, enabled: boolean) => {
      current = current.map((entry) => (entry.id === id ? { ...entry, enabled } : entry))
      return Promise.resolve(reply())
    }),
    adopt: vi.fn(() => Promise.resolve(reply())),
  }
  return { api, switches: createCliSwitches(api, () => []) }
}

function rowNames(): readonly string[] {
  return screen.getAllByRole('listitem').map((row) => row.getAttribute('aria-label') ?? '')
}

async function renderLoaded(prefs = seeded(), { switches, api } = plugin()) {
  render(<CliPrefsSection prefs={prefs} switches={switches} />)
  await screen.findByRole('listitem', { name: 'Codex CLI' })
  return { prefs, switches, api }
}

afterEach(() => {
  cleanup()
})

describe('CliPrefsSection', () => {
  it('says it is reading until the plugin answers', () => {
    const api: CliSwitchApi = {
      read: () => new Promise(() => undefined),
      set: vi.fn(),
      adopt: vi.fn(),
    }
    render(<CliPrefsSection prefs={createCliPrefs(memoryStorage())} switches={createCliSwitches(api, () => [])} />)
    expect(screen.getByText('正在读取 CLI 列表…')).toBeDefined()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists providers with their marks, disabling moves past either end', async () => {
    await renderLoaded()
    expect(rowNames()).toEqual(['DeepSeek', 'Claude Code', 'Codex CLI'])
    const [first, , last] = screen.getAllByRole('listitem')
    expect(first?.querySelector('svg')).not.toBeNull()
    expect(within(first ?? document.body).getByRole('button', { name: '上移 DeepSeek' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(within(last ?? document.body).getByRole('button', { name: '下移 Codex CLI' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(CLI_PREFS_STYLES).toContain('.dsh-ccgui-cli-prefs')
    expect(screen.getByText(/关闭的 CLI 不再作为提供方出现/)).toBeDefined()
    expect(screen.getByText('更多 CLI 适配中…')).toBeDefined()
  })

  it('reorders providers with the arrow buttons', async () => {
    const { prefs } = await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: '上移 Codex CLI' }))
    expect(rowNames()).toEqual(['DeepSeek', 'Codex CLI', 'Claude Code'])
    await userEvent.click(screen.getByRole('button', { name: '下移 DeepSeek' }))
    expect(rowNames()).toEqual(['Codex CLI', 'DeepSeek', 'Claude Code'])
    expect(prefs.getSnapshot().order).toEqual(['cli-codex', 'deepseek-official', 'cli-claude'])
  })

  // A CLI switched off is no provider, so the switcher stops listing it; settings must not.
  it('keeps listing a CLI the switcher no longer offers', async () => {
    const prefs = seeded()
    await renderLoaded(prefs)
    act(() => {
      prefs.remember([{ id: 'deepseek-official', label: 'DeepSeek' }])
    })
    expect(rowNames()).toEqual(['DeepSeek', 'Claude Code', 'Codex CLI'])
  })

  it('shows the built-in provider without a switch', async () => {
    await renderLoaded()
    expect(screen.queryByRole('switch', { name: '启用 DeepSeek' })).toBeNull()
    expect(screen.getByText('内置提供方，始终显示')).toBeDefined()
    expect(screen.getByRole('switch', { name: '启用 Claude Code' })).toBeDefined()
  })

  it('switches a CLI off in the plugin, with the switcher order, and back on', async () => {
    const { api } = await renderLoaded()
    const codex = screen.getByRole('switch', { name: '启用 Codex CLI' })
    expect(codex.getAttribute('title')).toBe('关闭后不再作为提供方出现，正在运行的会话会被停止')
    await userEvent.click(codex)
    expect(api.set).toHaveBeenCalledWith('cli-codex', false, ['deepseek-official', 'cli-claude', 'cli-codex'])
    await vi.waitFor(() => {
      expect(codex.getAttribute('aria-checked')).toBe('false')
    })
    expect(codex.getAttribute('title')).toBe('开启后重新作为提供方出现')
    expect(screen.getByText('已关闭，不作为提供方出现')).toBeDefined()
    await userEvent.click(codex)
    expect(api.set).toHaveBeenLastCalledWith('cli-codex', true, ['deepseek-official', 'cli-claude', 'cli-codex'])
  })

  it('says why a switch failed', async () => {
    const { api, switches } = plugin()
    vi.mocked(api.set).mockRejectedValueOnce(new Error('disk full'))
    await renderLoaded(seeded(), { api, switches })
    await userEvent.click(screen.getByRole('switch', { name: '启用 Codex CLI' }))
    expect((await screen.findByRole('alert')).textContent).toBe('CLI 开关出错：disk full')
  })
})
