import { describe, expect, it, vi } from 'vitest'
import type { ConfigureCall, GenerateOptions, LlmCallConfig, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { DEFAULT_COMMIT_PROMPT } from '../../src/commit/commit-material.ts'
import {
  CommitSuggestError,
  SUGGEST_MAX_TOKENS,
  chooseRoute,
  suggestCommitMessage,
} from '../../src/commit/commit-suggest.ts'
import type { SuggestLlm, SuggestRequest } from '../../src/commit/commit-suggest.ts'

const NONE = { provider: '', model: '' }
const ROUTE = { provider: 'deepseek', model: 'chat' }

describe('chooseRoute', () => {
  const firstModel = vi.fn(async (provider: string) => (provider === 'deepseek' ? 'first' : undefined))
  const choose = (choice: Partial<Parameters<typeof chooseRoute>[0]>) =>
    chooseRoute({ configured: NONE, review: NONE, defaultSelection: undefined, firstModel, ...choice })

  it('takes the configured route, filling in its first model', async () => {
    expect(await choose({ configured: { provider: 'deepseek', model: '' } })).toEqual({
      provider: 'deepseek',
      model: 'first',
    })
    expect(await choose({ configured: ROUTE, review: { provider: 'other', model: 'x' } })).toEqual(ROUTE)
  })

  it('falls back to the review route, then a non-CLI default', async () => {
    expect(await choose({ review: ROUTE, defaultSelection: { provider: 'x', model: 'y' } })).toEqual(ROUTE)
    expect(await choose({ defaultSelection: ROUTE })).toEqual(ROUTE)
  })

  // A CLI route would hand the call back to this plugin and into the user's CLI conversation.
  it('never takes a CLI', async () => {
    await expect(choose({ configured: { provider: 'cli-claude', model: '' } })).rejects.toThrow(/不能是 CLI/)
    await expect(
      choose({
        review: { provider: 'cli-claude', model: 'x' },
        defaultSelection: { provider: 'cli-codex', model: 'y' },
      }),
    ).rejects.toThrow(/还没有生成提交信息用的模型/)
  })

  it('says so when the provider lists no model to fall back on', async () => {
    await expect(choose({ configured: { provider: 'empty', model: '' } })).rejects.toThrow(/读不到 empty 的模型列表/)
  })
})

interface FakeOptions {
  readonly chunks?: readonly StreamChunk[]
  readonly efforts?: readonly string[]
  readonly contextWindow?: number
  readonly prepareError?: Error
  /** Streams nothing until the signal aborts. */
  readonly hang?: boolean
}

const text = (value: string): StreamChunk => ({ type: 'text-delta', index: 0, text: value })
const STOP: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

function fakeLlm(options: FakeOptions = {}) {
  const calls: { config?: LlmCallConfig; configured?: unknown; request?: GenerateOptions } = {}
  const llm: SuggestLlm = {
    prepareCall: async (config: LlmCallConfig, _signal?: AbortSignal, configure?: ConfigureCall) => {
      if (options.prepareError !== undefined) throw options.prepareError
      calls.config = config
      const efforts = (options.efforts ?? []).map((id) => ({ id: ReasoningEffortId(id), name: id }))
      calls.configured = configure?.(
        { maxTokens: config.maxTokens },
        {
          provider: config.provider,
          id: config.model,
          name: config.model,
          ...(efforts.length > 0 ? { reasoning: { efforts } } : {}),
          ...(options.contextWindow === undefined ? {} : { context: { contextWindow: options.contextWindow } }),
        },
      )
      return {
        config,
        async *stream(request: GenerateOptions) {
          calls.request = request
          if (options.hang === true) {
            await new Promise((resolve) => {
              if (request.signal?.aborted === true) resolve(undefined)
              request.signal?.addEventListener('abort', resolve)
            })
            yield {
              type: 'finish',
              reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } },
            } satisfies StreamChunk
            return
          }
          yield* options.chunks ?? [text('feat: add x'), STOP]
        },
      }
    },
  }
  return { llm, calls }
}

const FILES = [{ path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, patch: '+x\n' }]

function request(llm: SuggestLlm | undefined, extra: Partial<SuggestRequest> = {}): SuggestRequest {
  return {
    llm,
    route: async () => ROUTE,
    prompt: '',
    collect: async () => ({ branch: 'main', files: FILES }),
    ...extra,
  }
}

describe('suggestCommitMessage', () => {
  it('asks the route with the least reasoning and a capped answer, and cleans what comes back', async () => {
    const { llm, calls } = fakeLlm({
      efforts: ['low', 'high'],
      chunks: [text('```\nfeat: '), text('add x\n```'), STOP],
    })
    const suggestion = await suggestCommitMessage(request(llm))
    expect(suggestion).toEqual({
      message: 'feat: add x',
      model: ROUTE,
      coverage: { files: 1, diffFiles: 1, truncated: false },
    })
    expect(calls.config).toEqual({ ...ROUTE, maxTokens: SUGGEST_MAX_TOKENS })
    expect(calls.configured).toEqual({ maxTokens: SUGGEST_MAX_TOKENS, reasoningEffort: 'low' })
    expect(calls.request?.system).toBe(DEFAULT_COMMIT_PROMPT)
    expect(JSON.stringify(calls.request?.messages)).toContain('src/a.ts')
  })

  it('leaves the level alone for a model without levels, and uses a custom prompt', async () => {
    const { llm, calls } = fakeLlm()
    await suggestCommitMessage(request(llm, { prompt: '写英文' }))
    expect(calls.configured).toEqual({ maxTokens: SUGGEST_MAX_TOKENS })
    expect(calls.request?.system).toBe('写英文')
  })

  it('sizes the material from the context window', async () => {
    const { llm } = fakeLlm({ contextWindow: 20_000 })
    const collect = vi.fn(async () => ({ branch: undefined, files: FILES }))
    await suggestCommitMessage(request(llm, { collect }))
    expect(collect).toHaveBeenCalledWith(10_000)
  })

  it('warns when the answer was cut short', async () => {
    const { llm } = fakeLlm({ chunks: [text('feat: add'), { type: 'finish', reason: { kind: 'max-tokens' } }] })
    const suggestion = await suggestCommitMessage(request(llm))
    expect(suggestion.warning).toMatch(/截断/)
  })

  it('says the output ran out when nothing was written before the cap', async () => {
    const { llm } = fakeLlm({ chunks: [{ type: 'finish', reason: { kind: 'max-tokens' } }] })
    await expect(suggestCommitMessage(request(llm))).rejects.toThrow(/输出额度/)
  })

  it('says the model returned nothing', async () => {
    const { llm } = fakeLlm({ chunks: [text('  '), STOP] })
    await expect(suggestCommitMessage(request(llm))).rejects.toThrow(/没有返回提交信息/)
  })

  it('names the model when it fails', async () => {
    const failed: StreamChunk = {
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH', message: '密钥无效' } },
    }
    await expect(suggestCommitMessage(request(fakeLlm({ chunks: [failed] }).llm))).rejects.toThrow(
      'deepseek/chat 生成失败：密钥无效',
    )
    await expect(
      suggestCommitMessage(request(fakeLlm({ prepareError: new Error('没有这个模型') }).llm)),
    ).rejects.toThrow('deepseek/chat 生成失败：没有这个模型')
  })

  it('treats a stream that never finishes as a failure', async () => {
    const { llm } = fakeLlm({ chunks: [text('feat: x')] })
    await expect(suggestCommitMessage(request(llm))).rejects.toThrow(/没有正常结束/)
  })

  it('refuses without a model service', async () => {
    await expect(suggestCommitMessage(request(undefined))).rejects.toBeInstanceOf(CommitSuggestError)
  })

  it('stops after the time limit', async () => {
    const { llm } = fakeLlm({ hang: true })
    await expect(suggestCommitMessage(request(llm, { timeoutMs: 20 }))).rejects.toThrow(/生成超过 0 秒/)
  })

  it('stops when the request is cancelled, without calling it a timeout', async () => {
    const { llm } = fakeLlm({ hang: true })
    const cancel = new AbortController()
    const pending = suggestCommitMessage(request(llm, { signal: cancel.signal }))
    cancel.abort()
    await expect(pending).rejects.toThrow(/生成失败：aborted/)
  })
})
