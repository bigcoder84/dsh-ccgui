import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMIT_PROMPT } from '../../src/commit/commit-material.ts'
import { createCommitService } from '../../src/commit/commit-service.ts'
import {
  CommitSettingsStore,
  MAX_COMMIT_PROMPT,
  NO_COMMIT_SETTINGS,
  asCommitSettings,
  commitSettingsView,
  parseCommitSettings,
} from '../../src/commit/commit-settings.ts'
import type { CommitSettings, ModelDirectory } from '../../src/commit/commit-settings.ts'

const ROUTE = { provider: 'deepseek', model: 'chat' }

afterEach(() => {
  vi.useRealTimers()
})

describe('asCommitSettings', () => {
  it('takes a model or null, and a prompt', () => {
    expect(asCommitSettings({ model: ROUTE, prompt: 'p', extra: 1 })).toEqual({ model: ROUTE, prompt: 'p' })
    expect(asCommitSettings({ model: null, prompt: '' })).toEqual(NO_COMMIT_SETTINGS)
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['a CLI model', { model: { provider: 'cli-claude', model: 'default' }, prompt: '' }],
    ['a model without an id', { model: { provider: 'deepseek', model: '' }, prompt: '' }],
    ['a model that is not an object', { model: 'deepseek', prompt: '' }],
    ['no prompt', { model: null }],
    ['an overlong prompt', { model: null, prompt: 'x'.repeat(MAX_COMMIT_PROMPT + 1) }],
    ['a prompt with a NUL', { model: null, prompt: 'a\0b' }],
  ])('refuses %s', (_name, value) => {
    expect(asCommitSettings(value)).toBeUndefined()
  })
})

describe('parseCommitSettings', () => {
  it('reads a saved file, and treats a missing or broken one as nothing saved', () => {
    expect(parseCommitSettings(JSON.stringify({ model: ROUTE, prompt: '' }))).toEqual({ model: ROUTE, prompt: '' })
    expect(parseCommitSettings(undefined)).toEqual(NO_COMMIT_SETTINGS)
    expect(parseCommitSettings('{nope')).toEqual(NO_COMMIT_SETTINGS)
    expect(parseCommitSettings('{"model":1}')).toEqual(NO_COMMIT_SETTINGS)
  })
})

describe('CommitSettingsStore', () => {
  it('writes the whole settings and only then takes them', async () => {
    const write = vi.fn(async (_text: string) => {})
    const store = new CommitSettingsStore(NO_COMMIT_SETTINGS, write)
    await store.save({ model: ROUTE, prompt: 'p' })
    expect(store.current()).toEqual({ model: ROUTE, prompt: 'p' })
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '')).toEqual({ model: ROUTE, prompt: 'p' })
  })

  it('keeps the old settings when the write fails', async () => {
    const store = new CommitSettingsStore(NO_COMMIT_SETTINGS, () => Promise.reject(new Error('disk full')))
    await expect(store.save({ model: ROUTE, prompt: '' })).rejects.toThrow('disk full')
    expect(store.current()).toEqual(NO_COMMIT_SETTINGS)
  })
})

function directory(models: Record<string, () => Promise<readonly { id: string; name: string }[]>>): ModelDirectory {
  return {
    listProviders: () => Object.keys(models).map((id) => ({ id, name: id.toUpperCase() })),
    listModels: (provider) => models[provider]?.() ?? Promise.resolve([]),
  }
}

describe('commitSettingsView', () => {
  it('lists every non-CLI model, the fallback, and providers that failed', async () => {
    const view = await commitSettingsView(
      NO_COMMIT_SETTINGS,
      directory({
        deepseek: async () => [{ id: 'chat', name: 'Chat' }],
        'cli-claude': async () => [{ id: 'default', name: 'Default' }],
        broken: () => Promise.reject(new Error('密钥无效')),
      }),
      async () => ROUTE,
    )
    expect(view).toEqual({
      model: null,
      prompt: '',
      defaultPrompt: DEFAULT_COMMIT_PROMPT,
      fallback: ROUTE,
      models: [{ provider: 'deepseek', providerName: 'DEEPSEEK', id: 'chat', name: 'Chat' }],
      errors: ['BROKEN：密钥无效'],
    })
  })

  it('shows no fallback when there is none, and says when there is no model service', async () => {
    const view = await commitSettingsView(NO_COMMIT_SETTINGS, undefined, () => Promise.reject(new Error('none')))
    expect(view).toMatchObject({ fallback: null, models: [], errors: ['当前 DSH 没有提供模型服务'] })
  })

  it('gives up on a provider that does not answer', async () => {
    vi.useFakeTimers()
    const pending = commitSettingsView(
      NO_COMMIT_SETTINGS,
      directory({ slow: () => new Promise(() => {}) }),
      async () => ROUTE,
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await pending).errors).toEqual(['SLOW：读取超时'])
  })
})

describe('createCommitService', () => {
  function service(saved: CommitSettings, configPrompt = '') {
    const store = new CommitSettingsStore(saved, async () => {})
    const fallbackRoute = vi.fn(async () => ({ provider: 'config', model: 'm' }))
    return {
      store,
      fallbackRoute,
      service: createCommitService({
        store,
        directory: () => undefined,
        fallbackRoute,
        configPrompt: () => configPrompt,
      }),
    }
  }

  it('prefers the model chosen on the settings page over the config', async () => {
    expect(await service({ model: ROUTE, prompt: '' }).service.route()).toEqual(ROUTE)
    expect(await service(NO_COMMIT_SETTINGS).service.route()).toEqual({ provider: 'config', model: 'm' })
  })

  it('prefers the saved prompt, then the config one', () => {
    expect(service({ model: null, prompt: '写英文' }, 'config').service.prompt()).toBe('写英文')
    expect(service({ model: null, prompt: '  ' }, 'config').service.prompt()).toBe('config')
  })

  it('saves valid settings and answers with the new view', async () => {
    const { service: commit, store } = service(NO_COMMIT_SETTINGS)
    const view = await commit.save({ model: ROUTE, prompt: 'p' })
    expect(store.current()).toEqual({ model: ROUTE, prompt: 'p' })
    expect(view).toMatchObject({ model: ROUTE, prompt: 'p', fallback: { provider: 'config', model: 'm' } })
  })

  it('refuses invalid settings', async () => {
    await expect(
      service(NO_COMMIT_SETTINGS).service.save({ model: { provider: 'cli-x', model: 'y' }, prompt: '' }),
    ).rejects.toThrow(/提交信息设置无效/)
  })
})
