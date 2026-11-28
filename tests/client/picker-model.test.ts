import { describe, expect, it } from 'vitest'
import type { DirectoryState } from '../../src/client/choices.ts'
import { effortStops, isRiskyMode, pickerTabs, shownName } from '../../src/client/picker/picker-model.ts'
import type { EffortLevel } from '../../src/client/menu-models.ts'

const level = (effort: string | undefined, name = effort ?? 'Default'): EffortLevel => ({
  key: effort === undefined ? 'provider-default' : `effort:${effort}`,
  effort,
  name,
})

describe('effortStops', () => {
  it('names the known levels in Chinese and keeps the top two as they are', () => {
    const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((id) => level(id))
    expect(effortStops(levels, levels[3]).stops.map((stop) => stop.label)).toEqual([
      '低',
      '中',
      '高',
      '极高',
      'Max',
      'Ultra',
    ])
  })

  it('keeps the name the catalog gives a level it does not know', () => {
    expect(effortStops([level('thinking', 'Thinking')], undefined).stops[0]?.label).toBe('Thinking')
  })

  it('points at the level in effect', () => {
    const levels = [level('low'), level('high'), level('max')]
    expect(effortStops(levels, levels[1]).index).toBe(1)
    expect(effortStops(levels, undefined).index).toBe(-1)
  })

  // The CLI may pick its own level; that is a stop of its own, named for what it is.
  it("calls the provider's own choice 默认 and leaves it out of the top-level check", () => {
    const levels = [level(undefined), level('low'), level('medium'), level('high')]
    const stops = effortStops(levels, levels[3])
    expect(stops.stops[0]?.label).toBe('默认')
    expect(stops.top).toBe(true)
    expect(effortStops(levels, levels[0]).top).toBe(false)
  })

  it('marks the last level as the top only on a scale of more than two', () => {
    const three = [level('low'), level('medium'), level('high')]
    expect(effortStops(three, three[2]).top).toBe(true)
    expect(effortStops(three, three[1]).top).toBe(false)
    const two = [level('low'), level('high')]
    expect(effortStops(two, two[1]).top).toBe(false)
  })
})

describe('isRiskyMode', () => {
  it.each([
    [{ value: 'agent-full-access', name: 'Full access' }, true],
    [{ value: 'bypassPermissions', name: 'Bypass permissions' }, true],
    [{ value: 'danger-full-access', name: 'Danger' }, true],
    [{ value: 'yolo', name: 'YOLO' }, true],
    [{ value: 'agent', name: 'Auto review' }, false],
    [{ value: 'plan', name: 'Plan' }, false],
  ])('reads %o as risky: %s', (mode, risky) => {
    expect(isRiskyMode(mode)).toBe(risky)
  })
})

describe('pickerTabs', () => {
  const state: DirectoryState = {
    groups: [
      { id: 'cli-claude', name: 'Claude Code', models: [{ id: 'default', name: 'Opus' }] },
      { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] },
      { id: 'cli-codex', name: 'Codex CLI', models: [{ id: 'default', name: '6.2 Sol' }] },
    ],
    current: { provider: 'cli-codex', model: 'default' },
  }

  it("lists the switcher's entries in the user's order and names the one in use", () => {
    const tabs = pickerTabs(state, { known: [], order: ['deepseek-official', 'cli-codex'], hidden: [] })
    expect(tabs.items.map((item) => item.id)).toEqual(['deepseek-official', 'cli-codex', 'cli-claude'])
    expect(tabs.listed.map((item) => item.id)).toEqual(['cli-claude', 'deepseek-official', 'cli-codex'])
    expect(tabs.currentId).toBe('cli-codex')
  })
})

describe('shownName', () => {
  it("drops the catalog's mark on the CLI's own setting, and leaves other names alone", () => {
    expect(shownName('6.2 Sol（默认）')).toBe('6.2 Sol')
    expect(shownName('默认（默认）模型')).toBe('默认（默认）模型')
  })
})
