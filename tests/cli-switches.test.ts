import { describe, expect, it, vi } from 'vitest'
import { CliSwitches, parseSwitches } from '../src/cli-switches.ts'

const PROVIDERS = ['cli-claude', 'cli-codex', 'cli-kimi', 'cli-codebuddy']

function setup(stored?: readonly string[]) {
  const persist = vi.fn((_disabled: readonly string[]) => Promise.resolve())
  return { persist, switches: new CliSwitches(PROVIDERS, stored, persist) }
}

describe('parseSwitches', () => {
  it('reads the CLIs switched off', () => {
    expect(parseSwitches(JSON.stringify({ version: 1, disabled: ['cli-kimi', 3] }))).toEqual(['cli-kimi'])
  })

  // Nothing stored, a torn file or another version: start from the defaults instead.
  it('reads nothing it cannot trust', () => {
    expect(parseSwitches(undefined)).toBeUndefined()
    expect(parseSwitches('{not json')).toBeUndefined()
    expect(parseSwitches(JSON.stringify({ version: 2, disabled: [] }))).toBeUndefined()
    expect(parseSwitches(JSON.stringify({ version: 1, disabled: 'cli-kimi' }))).toBeUndefined()
  })
})

describe('CliSwitches', () => {
  it('starts with CodeBuddy off until anything is saved', () => {
    const { switches } = setup()
    expect(switches.enabled()).toEqual(['cli-claude', 'cli-codex', 'cli-kimi'])
    expect(switches.everSaved).toBe(false)
  })

  it('starts from what was saved, in the configured order', () => {
    const { switches } = setup(['cli-kimi'])
    expect(switches.enabled()).toEqual(['cli-claude', 'cli-codex', 'cli-codebuddy'])
    expect(switches.everSaved).toBe(true)
    expect(switches.isEnabled('cli-kimi')).toBe(false)
  })

  it('switches a CLI off and saves every choice', async () => {
    const { persist, switches } = setup()
    await expect(switches.set('cli-kimi', false)).resolves.toBe(true)
    expect(switches.isEnabled('cli-kimi')).toBe(false)
    expect(persist).toHaveBeenCalledWith(['cli-kimi', 'cli-codebuddy'])
    expect(switches.everSaved).toBe(true)
  })

  it('changes nothing when the CLI is already that way', async () => {
    const { persist, switches } = setup()
    await expect(switches.set('cli-codex', true)).resolves.toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it('refuses a route that is not a configured CLI', async () => {
    await expect(setup().switches.set('deepseek-official', false)).rejects.toMatchObject({
      code: 'CLI_SWITCH_FAILED',
    })
  })

  // The switch is not flipped in memory when it could not be kept, so the two never disagree.
  it('keeps the old state when saving fails', async () => {
    const { persist, switches } = setup()
    persist.mockRejectedValueOnce(new Error('disk full'))
    await expect(switches.set('cli-kimi', false)).rejects.toThrow('disk full')
    expect(switches.isEnabled('cli-kimi')).toBe(true)
  })

  // A browser that kept its own list before the switches moved here hands it over once.
  it('adopts a list only before anything was saved', async () => {
    const { persist, switches } = setup()
    await expect(switches.adopt(['cli-kimi', 'cli-unknown'])).resolves.toBe(true)
    expect(persist).toHaveBeenCalledWith(['cli-kimi'])
    expect(switches.enabled()).toEqual(['cli-claude', 'cli-codex', 'cli-codebuddy'])
    await expect(switches.adopt(['cli-codex'])).resolves.toBe(false)
    expect(switches.isEnabled('cli-codex')).toBe(true)
  })
})
