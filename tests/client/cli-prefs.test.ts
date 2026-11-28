import { describe, expect, it } from 'vitest'
import {
  CLI_PREFS_STORAGE_KEY,
  arrangeChoices,
  createCliPrefs,
  parseCliPrefs,
  settingsEntries,
} from '../../src/client/cli-prefs.ts'
import type { CliPrefsSnapshot, CliPrefsStorage } from '../../src/client/cli-prefs.ts'

function memoryStorage(initial: Readonly<Record<string, string>> = {}): CliPrefsStorage & {
  read(key: string): string | undefined
} {
  let items = initial
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items = { ...items, [key]: value }
    },
    read: (key) => items[key],
  }
}

const DEEPSEEK = { id: 'deepseek-official', label: 'DeepSeek' }
const CLAUDE = { id: 'cli-claude', label: 'Claude Code' }
const CODEX = { id: 'cli-codex', label: 'Codex CLI' }
const PI = { id: 'cli-pi', label: 'PI CLI' }

function snapshot(partial: Partial<CliPrefsSnapshot>): CliPrefsSnapshot {
  return { known: [], order: [], hidden: [], ...partial }
}

describe('parseCliPrefs', () => {
  it('falls back to empty preferences for missing, corrupt or malformed entries', () => {
    const empty = snapshot({})
    expect(parseCliPrefs(null)).toEqual(empty)
    expect(parseCliPrefs('{')).toEqual(empty)
    expect(parseCliPrefs('[]')).toEqual(empty)
    expect(parseCliPrefs('{"order":"x","hidden":[1],"known":[{"id":2}]}')).toEqual(empty)
  })

  it('keeps well-formed fields and drops malformed items', () => {
    const raw = JSON.stringify({
      order: ['cli-codex', 3, 'cli-claude'],
      hidden: ['cli-pi', 'deepseek-official'],
      known: [CLAUDE, { id: 'x' }, CODEX],
    })
    expect(parseCliPrefs(raw)).toEqual(
      snapshot({ order: ['cli-codex', 'cli-claude'], hidden: ['cli-pi'], known: [CLAUDE, CODEX] }),
    )
  })
})

describe('arrangeChoices', () => {
  it('leaves the directory order alone without preferences', () => {
    expect(arrangeChoices([DEEPSEEK, CLAUDE, CODEX], snapshot({}))).toEqual([DEEPSEEK, CLAUDE, CODEX])
  })

  it('sorts by the saved order and keeps unordered entries after it', () => {
    const prefs = snapshot({ order: ['cli-codex', 'deepseek-official'] })
    expect(arrangeChoices([DEEPSEEK, CLAUDE, CODEX, PI], prefs)).toEqual([CODEX, DEEPSEEK, CLAUDE, PI])
  })

  // Older versions listed the harness's own providers one by one and let users hide them.
  it('drops stored hidden ids that are not CLIs', () => {
    const raw = JSON.stringify({ hidden: ['deepseek-account', 'teamo', 'cli-pi'] })
    expect(parseCliPrefs(raw).hidden).toEqual(['cli-pi'])
  })

  // The plugin decides which CLIs exist: one switched off is never offered in the first place.
  it('leaves out nothing, whatever this browser once hid', () => {
    const prefs = snapshot({ hidden: ['deepseek-official', 'cli-claude', 'cli-codex', 'cli-pi'] })
    expect(arrangeChoices([DEEPSEEK, CLAUDE, CODEX, PI], prefs)).toEqual([DEEPSEEK, CLAUDE, CODEX, PI])
  })
})

describe('settingsEntries', () => {
  // The CLIs come from the plugin, switched off ones included; the harness's entry from the switcher.
  it("lists the harness's entry and every CLI the plugin reports, in the saved order", () => {
    const prefs = snapshot({ known: [DEEPSEEK, CLAUDE], order: ['cli-codex'], hidden: ['cli-codex'] })
    const clis = [
      { ...CLAUDE, enabled: false },
      { ...CODEX, enabled: true },
    ]
    expect(settingsEntries(prefs, clis)).toEqual([
      { ...CODEX, enabled: true },
      { ...DEEPSEEK, enabled: true },
      { ...CLAUDE, enabled: false },
    ])
  })

  it("lists only the harness's entry before the plugin answers", () => {
    expect(settingsEntries(snapshot({ known: [DEEPSEEK, CLAUDE] }), undefined)).toEqual([
      { ...DEEPSEEK, enabled: true },
    ])
  })
})

describe('createCliPrefs', () => {
  it('remembers providers it is shown, updating names and persisting only on change', () => {
    const storage = memoryStorage()
    const prefs = createCliPrefs(storage)
    let calls = 0
    prefs.subscribe(() => {
      calls += 1
    })
    prefs.remember([DEEPSEEK, CLAUDE])
    const first = prefs.getSnapshot()
    prefs.remember([CLAUDE, DEEPSEEK])
    expect(prefs.getSnapshot()).toBe(first)
    prefs.remember([DEEPSEEK, { id: 'cli-claude', label: 'Claude' }, CODEX])
    expect(prefs.getSnapshot().known).toEqual([DEEPSEEK, { id: 'cli-claude', label: 'Claude' }, CODEX])
    expect(calls).toBe(2)
    expect(parseCliPrefs(storage.read(CLI_PREFS_STORAGE_KEY) ?? null)).toEqual(prefs.getSnapshot())
  })

  // Older versions listed the harness's own providers one by one; once the switcher reports
  // only the harness entry, those rows leave the settings page.
  it('forgets harness providers the switcher no longer reports', () => {
    const stored = snapshot({ known: [{ id: 'teamo', label: 'Teamo' }, DEEPSEEK, CLAUDE] })
    const prefs = createCliPrefs(memoryStorage({ [CLI_PREFS_STORAGE_KEY]: JSON.stringify(stored) }))
    prefs.remember([DEEPSEEK, CLAUDE])
    expect(prefs.getSnapshot().known).toEqual([DEEPSEEK, CLAUDE])
  })

  it('loads what was stored', () => {
    const stored = snapshot({ known: [CLAUDE], hidden: ['cli-claude'] })
    const prefs = createCliPrefs(memoryStorage({ [CLI_PREFS_STORAGE_KEY]: JSON.stringify(stored) }))
    expect(prefs.getSnapshot()).toEqual(stored)
  })

  it('moves a provider up or down, ignoring moves past either end', () => {
    const prefs = createCliPrefs(memoryStorage())
    // A CLI switched off is listed on the settings page too, though the switcher never saw it.
    const listed = ['deepseek-official', 'cli-claude', 'cli-codex']
    prefs.remember([DEEPSEEK, CLAUDE])
    prefs.move('cli-codex', -1, listed)
    expect(prefs.getSnapshot().order).toEqual(['deepseek-official', 'cli-codex', 'cli-claude'])
    const before = prefs.getSnapshot()
    prefs.move('deepseek-official', -1, listed)
    prefs.move('cli-codex', 1, listed)
    prefs.move('unknown', 1, listed)
    expect(prefs.getSnapshot()).toBe(before)
  })

  // The plugin hands this list over once; the switcher itself no longer reads it.
  it('keeps the list of CLIs this browser once left out, without adding to it', () => {
    const stored = snapshot({ known: [DEEPSEEK], hidden: ['cli-claude'] })
    const prefs = createCliPrefs(memoryStorage({ [CLI_PREFS_STORAGE_KEY]: JSON.stringify(stored) }))
    prefs.remember([DEEPSEEK, CLAUDE, { id: 'cli-codebuddy', label: 'CodeBuddy CLI' }])
    expect(prefs.getSnapshot().hidden).toEqual(['cli-claude'])
  })

  // Kimi has been verified with a real account, so it shows from the start.
  it('shows a verified CLI when first seen', () => {
    const prefs = createCliPrefs(memoryStorage())
    prefs.remember([DEEPSEEK, CLAUDE, { id: 'cli-kimi', label: 'Kimi CLI' }])
    expect(prefs.getSnapshot().hidden).toEqual([])
  })

  it('forgets a provider the switcher stops offering, keeping the stored order', () => {
    const prefs = createCliPrefs(memoryStorage())
    prefs.remember([DEEPSEEK, CLAUDE, CODEX])
    prefs.move('cli-codex', -1, ['deepseek-official', 'cli-claude', 'cli-codex'])
    prefs.remember([DEEPSEEK, CODEX])
    expect(prefs.getSnapshot().known).toEqual([DEEPSEEK, CODEX])
    // A CLI switched off comes back in the place the user gave it.
    expect(prefs.getSnapshot().order).toEqual(['deepseek-official', 'cli-codex', 'cli-claude'])
  })

  it('keeps the list while the switcher has not listed any provider', () => {
    const prefs = createCliPrefs(memoryStorage())
    prefs.remember([DEEPSEEK, CLAUDE])
    const before = prefs.getSnapshot()
    prefs.remember([])
    expect(prefs.getSnapshot()).toBe(before)
  })

  it('stops notifying after unsubscribe and survives storage that throws', () => {
    const prefs = createCliPrefs({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    let calls = 0
    const unsubscribe = prefs.subscribe(() => {
      calls += 1
    })
    prefs.remember([CLAUDE])
    unsubscribe()
    prefs.remember([CLAUDE, CODEX])
    expect(calls).toBe(1)
    expect(prefs.getSnapshot().known).toEqual([CLAUDE, CODEX])
  })
})
