/**
 * Write a commit message with a harness model: the route the user configured, prepared with
 * the least reasoning the model offers and a capped answer, given the material of the files
 * the commit box has selected, and stopped after a minute or when the request goes away.
 * The route is never a CLI: a CLI route would hand the call back to this plugin's adapter
 * and into the user's CLI conversation.
 * @module dsh-ccgui/commit/commit-suggest
 */

import type { ConfigureCall, GenerateOptions, LlmCallConfig, LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { isCliRoute } from '../constants.ts'
import { DEFAULT_COMMIT_PROMPT, buildMaterial, cleanSuggestion, inputBudget } from './commit-material.ts'
import type { MaterialFile } from './commit-material.ts'

const SUGGEST_TIMEOUT_MS = 60_000
/** A commit message needs a few hundred tokens; the rest is room for models that reason anyway. */
export const SUGGEST_MAX_TOKENS = 4096

const ROUTE_UNSET = '还没有生成提交信息用的模型：请在 设置 › CC GUI 设置 › 提交信息 里选一个模型（CLI 不能用来生成）。'
const ROUTE_IS_CLI = 'commitProvider 不能是 CLI，请设置为 DeepSeek 等非 CLI 的模型提供方。'
const modelMissing = (provider: string): string => `读不到 ${provider} 的模型列表，请在插件配置里设置 commitModel。`
const NO_LLM = '当前 DSH 没有提供模型服务，无法生成提交信息'
const EMPTY = '模型没有返回提交信息，可以再试一次，或换一个模型'
const SPENT = '模型的输出额度在写出提交信息前就用完了（可能都用在了推理上），可以换一个模型'
const CUT = '模型的输出被截断，提交信息可能不完整，请检查后再提交'
const timedOut = (ms: number): string =>
  `生成超过 ${String(Math.round(ms / 1000))} 秒，已停止；可以再试一次，或换一个更快的模型`

/** A failure the user can act on; the route answers it with its message. */
export class CommitSuggestError extends Error {
  override name = 'CommitSuggestError'
}

export interface SuggestRoute {
  readonly provider: string
  readonly model: string
}

/** The part of a prepared call this module uses. */
interface SuggestCall {
  readonly config: LlmCallConfig
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** The part of the harness's `llm` service this module uses. */
export interface SuggestLlm {
  prepareCall(config: LlmCallConfig, signal?: AbortSignal, configure?: ConfigureCall): Promise<SuggestCall>
}

export interface RouteChoice {
  /** From the plugin config; an empty provider means not set. */
  readonly configured: SuggestRoute
  /** The review route, also chosen by the user and also never a CLI. */
  readonly review: SuggestRoute
  /** The harness's default for new sessions, when it has one. */
  readonly defaultSelection: SuggestRoute | undefined
  readonly firstModel: (provider: string) => Promise<string | undefined>
}

async function withModel(route: SuggestRoute, firstModel: RouteChoice['firstModel']): Promise<SuggestRoute> {
  if (isCliRoute(route.provider)) throw new CommitSuggestError(ROUTE_IS_CLI)
  const model = route.model === '' ? await firstModel(route.provider) : route.model
  if (model === undefined) throw new CommitSuggestError(modelMissing(route.provider))
  return { provider: route.provider, model }
}

/**
 * Pick the model: the commit route the user configured, else the review route, else the
 * harness's default when it is not a CLI. The plugin never picks a provider on its own: the
 * call carries the user's code.
 * @param choice - the configured routes and the harness's default.
 * @returns the route to call.
 */
export async function chooseRoute(choice: RouteChoice): Promise<SuggestRoute> {
  const { configured, review, defaultSelection, firstModel } = choice
  if (configured.provider !== '') return withModel(configured, firstModel)
  if (review.provider !== '' && !isCliRoute(review.provider)) return withModel(review, firstModel)
  if (defaultSelection !== undefined && !isCliRoute(defaultSelection.provider) && defaultSelection.model !== '') {
    return defaultSelection
  }
  throw new CommitSuggestError(ROUTE_UNSET)
}

/** A model failure, named after the model so the user knows which one to look at. */
function modelFailure(route: SuggestRoute, failure: { readonly code?: string; readonly message: string }): Error {
  return new CommitSuggestError(`模型 ${route.provider}/${route.model} 生成失败：${failure.message}`)
}

async function prepare(
  llm: SuggestLlm,
  route: SuggestRoute,
  signal: AbortSignal,
): Promise<{ call: SuggestCall; contextWindow: number | undefined }> {
  let contextWindow: number | undefined
  try {
    const call = await llm.prepareCall({ ...route, maxTokens: SUGGEST_MAX_TOKENS }, signal, (controls, model) => {
      contextWindow = model.context?.contextWindow
      // The first listed level is the least; a commit message needs no deliberation.
      const least = model.reasoning?.efforts[0]
      return least === undefined ? controls : { ...controls, reasoningEffort: least.id }
    })
    return { call, contextWindow }
  } catch (error: unknown) {
    if (signal.aborted) throw error
    throw modelFailure(route, { message: error instanceof Error ? error.message : String(error) })
  }
}

type Finish = { kind: 'stop' | 'max-tokens' | 'other' } | { kind: 'failed'; failure: LlmFailure }

async function readAnswer(
  call: SuggestCall,
  prompt: string,
  material: string,
  signal: AbortSignal,
): Promise<{ text: string; finish: Finish }> {
  let text = ''
  let finish: Finish = { kind: 'failed', failure: { code: 'NO_FINISH', message: '模型的输出没有正常结束' } }
  const stream = call.stream({
    ...call.config,
    system: prompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: material }] }],
    signal,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type !== 'finish') continue
    const { reason } = chunk
    if (reason.kind === 'error' || reason.kind === 'aborted') finish = { kind: 'failed', failure: reason.failure }
    else finish = { kind: reason.kind === 'stop' || reason.kind === 'max-tokens' ? reason.kind : 'other' }
  }
  return { text, finish }
}

export interface SuggestRequest {
  readonly llm: SuggestLlm | undefined
  readonly route: () => Promise<SuggestRoute>
  /** The custom prompt from the plugin config; empty means the built-in one. */
  readonly prompt: string
  /** Reads the selected files; the budget bounds how many patches are read. */
  readonly collect: (budget: number) => Promise<{ branch: string | undefined; files: readonly MaterialFile[] }>
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
}

export interface Suggestion {
  readonly message: string
  readonly model: SuggestRoute
  readonly coverage: { readonly files: number; readonly diffFiles: number; readonly truncated: boolean }
  readonly warning?: string
}

async function generate(request: SuggestRequest, signal: AbortSignal): Promise<Suggestion> {
  const { llm } = request
  if (llm === undefined) throw new CommitSuggestError(NO_LLM)
  const route = await request.route()
  const { call, contextWindow } = await prepare(llm, route, signal)
  const budget = inputBudget(contextWindow)
  const changes = await request.collect(budget)
  const material = buildMaterial({ ...changes, budget })
  const prompt = request.prompt.trim() === '' ? DEFAULT_COMMIT_PROMPT : request.prompt
  const answer = await readAnswer(call, prompt, material.text, signal)
  if (answer.finish.kind === 'failed') throw modelFailure(route, answer.finish.failure)
  const message = cleanSuggestion(answer.text)
  if (message === '') throw new CommitSuggestError(answer.finish.kind === 'max-tokens' ? SPENT : EMPTY)
  const warning = answer.finish.kind === 'max-tokens' ? CUT : undefined
  return { message, model: route, coverage: material.coverage, ...(warning === undefined ? {} : { warning }) }
}

/**
 * Generate a commit message within the time limit; the request's own cancellation stops the
 * model call too.
 * @param request - the model, the material reader, and the cancellation.
 * @returns the cleaned message, the model used, and how much of the change it saw.
 */
export async function suggestCommitMessage(request: SuggestRequest): Promise<Suggestion> {
  const timeoutMs = request.timeoutMs ?? SUGGEST_TIMEOUT_MS
  const timer = new AbortController()
  const handle = setTimeout(() => {
    timer.abort()
  }, timeoutMs)
  const signal = request.signal === undefined ? timer.signal : AbortSignal.any([request.signal, timer.signal])
  try {
    return await generate(request, signal)
  } catch (error: unknown) {
    if (timer.signal.aborted && request.signal?.aborted !== true) {
      throw new CommitSuggestError(timedOut(timeoutMs), { cause: error })
    }
    throw error
  } finally {
    clearTimeout(handle)
  }
}
