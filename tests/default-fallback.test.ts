import { describe, expect, it, vi } from 'vitest'
import { moveDefaultOff, readDefaultModel } from '../src/default-fallback.ts'
import type { DefaultModel, FallbackDeps } from '../src/default-fallback.ts'

function setup(current: string, overrides: Partial<FallbackDeps> = {}) {
  const defaults: DefaultModel = {
    currentSelection: () => ({ provider: current, model: 'default' }),
    saveSelection: vi.fn(() => Promise.resolve()),
  }
  const deps: FallbackDeps = {
    defaults,
    isEnabledCli: (provider) => provider === 'cli-claude',
    isCli: (provider) => provider.startsWith('cli-'),
    firstModel: (provider) => Promise.resolve(provider === 'deepseek-official' ? 'deepseek-v4' : undefined),
    ...overrides,
  }
  return { defaults, deps }
}

describe('moveDefaultOff', () => {
  it('leaves the default alone when it is on another provider', async () => {
    const { defaults, deps } = setup('cli-claude')
    await expect(moveDefaultOff('cli-codex', ['cli-claude'], deps)).resolves.toBeUndefined()
    expect(defaults.saveSelection).not.toHaveBeenCalled()
  })

  // The order is the switcher's, so DeepSeek at the top wins, with its first model.
  it('moves it to the first provider still on, in the switcher order', async () => {
    const { defaults, deps } = setup('cli-codex')
    const order = ['deepseek-official', 'cli-claude', 'cli-codex']
    await expect(moveDefaultOff('cli-codex', order, deps)).resolves.toBe('deepseek-official')
    expect(defaults.saveSelection).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4' })
  })

  it("moves it to a CLI's own default model", async () => {
    const { defaults, deps } = setup('cli-codex')
    await moveDefaultOff('cli-codex', ['cli-codex', 'cli-kimi', 'cli-claude'], deps)
    expect(defaults.saveSelection).toHaveBeenCalledWith({ provider: 'cli-claude', model: 'default' })
  })

  it('skips a harness provider that lists no models', async () => {
    const { defaults, deps } = setup('cli-codex')
    await moveDefaultOff('cli-codex', ['deepseek-account', 'cli-claude'], deps)
    expect(defaults.saveSelection).toHaveBeenCalledWith({ provider: 'cli-claude', model: 'default' })
  })

  it('does nothing when no provider is left to move to', async () => {
    const { defaults, deps } = setup('cli-codex')
    await expect(moveDefaultOff('cli-codex', ['cli-codex', 'cli-kimi'], deps)).resolves.toBeUndefined()
    expect(defaults.saveSelection).not.toHaveBeenCalled()
  })

  it('does nothing in a harness without a default model service', async () => {
    const { deps } = setup('cli-codex', { defaults: undefined })
    await expect(moveDefaultOff('cli-codex', ['cli-claude'], deps)).resolves.toBeUndefined()
  })
})

describe('readDefaultModel', () => {
  it('takes a service with both methods', () => {
    const service = { currentSelection: () => ({ provider: 'x', model: 'y' }), saveSelection: () => Promise.resolve() }
    expect(readDefaultModel(service)).toBe(service)
  })

  it('refuses anything else', () => {
    expect(readDefaultModel(undefined)).toBeUndefined()
    expect(readDefaultModel({ currentSelection: () => undefined })).toBeUndefined()
  })
})
