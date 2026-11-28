import { describe, expect, it, vi } from 'vitest'
import {
  LAST_SELECTIONS_STORAGE_KEY,
  createLastSelections,
  parseLastSelections,
} from '../../src/client/last-selections.ts'
import type { LastSelectionsStorage } from '../../src/client/last-selections.ts'

function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
  let items = initial
  const storage: LastSelectionsStorage & { read(key: string): string | undefined } = {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items = { ...items, [key]: value }
    },
    read: (key) => items[key],
  }
  return storage
}

const LUNA = { provider: 'cli-codex', model: 'gpt-6-luna', reasoningEffort: 'low' }

describe('parseLastSelections', () => {
  it('keeps well-formed selections and drops the rest', () => {
    const raw = JSON.stringify({
      'cli-codex': LUNA,
      'cli-claude': { provider: 'cli-claude', model: 'opus' },
      broken: { provider: 'cli-x' },
      effort: { provider: 'cli-x', model: 'm', reasoningEffort: 3 },
    })
    expect(parseLastSelections(raw)).toEqual({
      'cli-codex': LUNA,
      'cli-claude': { provider: 'cli-claude', model: 'opus' },
      effort: { provider: 'cli-x', model: 'm' },
    })
  })

  it('reads nothing from a missing or corrupt entry', () => {
    expect(parseLastSelections(null)).toEqual({})
    expect(parseLastSelections('{nope')).toEqual({})
    expect(parseLastSelections('[]')).toEqual({})
  })
})

describe('createLastSelections', () => {
  it('remembers the last selection of each entry and keeps it for the next load', () => {
    const storage = memoryStorage()
    const selections = createLastSelections(storage)
    selections.remember('cli-codex', LUNA)
    selections.remember('deepseek-official', { provider: 'deepseek-account', model: 'deepseek-v4' })
    expect(selections.get('cli-codex')).toEqual(LUNA)
    const reloaded = createLastSelections(storage)
    expect(reloaded.get('deepseek-official')).toEqual({ provider: 'deepseek-account', model: 'deepseek-v4' })
    expect(parseLastSelections(storage.read(LAST_SELECTIONS_STORAGE_KEY) ?? null)).toEqual({
      'cli-codex': LUNA,
      'deepseek-official': { provider: 'deepseek-account', model: 'deepseek-v4' },
    })
  })

  // A session re-renders often with the same selection; only a change is written.
  it('writes nothing when the selection is the one it already has', () => {
    const storage = memoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    const selections = createLastSelections(storage)
    selections.remember('cli-codex', LUNA)
    selections.remember('cli-codex', { ...LUNA })
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('drops a level that is no longer chosen', () => {
    const selections = createLastSelections(memoryStorage())
    selections.remember('cli-codex', LUNA)
    selections.remember('cli-codex', { provider: 'cli-codex', model: 'gpt-6-luna' })
    expect(selections.get('cli-codex')).toEqual({ provider: 'cli-codex', model: 'gpt-6-luna' })
  })

  it('keeps working when storage throws', () => {
    const selections = createLastSelections({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    selections.remember('cli-codex', LUNA)
    expect(selections.get('cli-codex')).toEqual(LUNA)
  })
})
