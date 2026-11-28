/**
 * The browser side of the composer's context meter: asks the plugin's context route how full
 * a session's CLI says its context is.
 * @module dsh-ccgui/client/context-api
 */

import { CONTEXT_ROUTE } from '../constants.ts'
import type { PostJson } from './mode-api.ts'

/** Tokens in context, and the context window they are out of. */
export interface ContextUsage {
  readonly used: number
  readonly size: number
}

/** What the meter calls. */
export interface ContextApi {
  /** @returns the CLI's latest figures, or undefined while it has reported none. */
  read(provider: string): Promise<ContextUsage | undefined>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function usageOf(body: unknown, status: number): ContextUsage | undefined {
  if (!isObject(body) || body.success !== true) throw new Error(`读取上下文用量失败（HTTP ${status}）`)
  const usage = isObject(body.data) ? body.data.usage : undefined
  if (!isObject(usage) || !isCount(usage.used) || !isCount(usage.size) || usage.size === 0) return undefined
  return { used: usage.used, size: usage.size }
}

/** A failing answer may carry no JSON at all, such as a proxy's error page. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    // Only the status is left to report, which usageOf does.
    return undefined
  }
}

/**
 * @param post - the fetch to post with.
 * @param sessionId - the harness session whose CLI the meter speaks for.
 * @returns the meter's one call.
 */
export function createContextApi(post: PostJson, sessionId: string): ContextApi {
  return {
    read: async (provider) => {
      const response = await post(CONTEXT_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, provider }),
      })
      return usageOf(await bodyOf(response), response.status)
    },
  }
}

/** One API per session: the meter reads in an effect, which a new object each render would re-run. */
const perSession = new Map<string, ContextApi>()

/**
 * @param post - the fetch to post with.
 * @param sessionId - the harness session whose CLI the meter speaks for.
 * @returns the API for that session, the same object on every call.
 */
export function contextApiFor(post: PostJson, sessionId: string): ContextApi {
  const known = perSession.get(sessionId)
  if (known !== undefined) return known
  const created = createContextApi(post, sessionId)
  perSession.set(sessionId, created)
  return created
}
