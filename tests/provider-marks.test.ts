import { describe, expect, it } from 'vitest'
import { markOf, providerOfSession } from '../src/client/provider-marks.ts'

describe('markOf', () => {
  it.each([
    ['cli-opencode', 'opencode'],
    ['cli-omp', 'omp'],
    ['cli-codex', 'codex'],
    ['cli-pi', 'pi'],
    ['cli-claude', 'claude'],
    ['cli-codebuddy', 'codebuddy'],
    ['cli-kimi', 'kimi'],
    ['deepseek', 'deepseek'],
    ['my-deepseek-proxy', 'deepseek'],
  ])('gives %s its own mark', (provider, mark) => {
    expect(markOf(provider)).toBe(mark)
  })

  // A CLI someone configured themselves still reads as a CLI in the list.
  it('gives any other CLI the generic mark', () => {
    expect(markOf('cli-someone-elses')).toBe('cli')
  })

  // A provider that is not a CLI runs on the harness itself, whoever made its models: the mark
  // says where the session runs, so ChatGPT subscription models show the harness's mark too.
  it("gives every provider that is not a CLI the harness's mark", () => {
    expect(markOf('openrouter')).toBe('deepseek')
    expect(markOf('openai-codex')).toBe('deepseek')
  })
})

describe('providerOfSession', () => {
  const row = (modelSelection: unknown) => ({ projectionValues: { modelSelection } })

  it('reads the selection the next turn will use', () => {
    expect(
      providerOfSession(
        row({ next: { provider: 'cli-pi', model: 'x' }, lastUsed: { provider: 'cli-omp', model: 'y' } }),
      ),
    ).toBe('cli-pi')
  })

  it('falls back to the one last used', () => {
    expect(providerOfSession(row({ next: null, lastUsed: { provider: 'cli-omp', model: 'y' } }))).toBe('cli-omp')
  })

  // A cold row's cached block may omit any key, so nothing here can be assumed.
  it.each([
    ['no row', undefined],
    ['no values', {}],
    ['no selection', { projectionValues: {} }],
    ['an empty selection', row({ next: null, lastUsed: null })],
    ['a malformed provider', row({ next: { provider: 5 } })],
  ])('knows nothing from %s', (_name, value) => {
    expect(providerOfSession(value)).toBeUndefined()
  })
})
