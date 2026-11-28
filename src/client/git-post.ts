/**
 * The browser's side of the git routes: one POST per operation, answered with
 * `{ success, data, error }`. The working directory goes with every request; the Node half
 * finds the repository from it. Shared by the 变更 panel and the 新建 Worktree dialog.
 * @module dsh-ccgui/client/git-post
 */

import { GIT_ROUTE_PREFIX } from '../constants.ts'

/** `window.fetch`, or a stand-in in tests. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** Posts one operation; rejects with a message ready to show. */
export type GitPost = <T>(operation: string, body?: object) => Promise<T>

const NETWORK_FAILED = '无法连接到 DSH 服务'

interface Answer {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: unknown
}

async function answerOf(response: Response): Promise<Answer> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null ? body : {}
  } catch (_error: unknown) {
    // A proxy's HTML error page, say; the status code below still tells what happened.
    return {}
  }
}

/**
 * Post a JSON body to one of the plugin's routes and unwrap its `{ success, data, error }`.
 * @param fetchFn - the fetch to use.
 * @param url - the route.
 * @param body - the request body.
 * @param signal - cancels the request.
 * @returns the answer's data; rejects with a message ready to show.
 */
export async function postJson<T>(fetchFn: Fetch, url: string, body: object, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error: unknown) {
    if (signal?.aborted === true) throw error
    throw new Error(NETWORK_FAILED, { cause: error })
  }
  const answer = await answerOf(response)
  if (!response.ok || answer.success !== true) {
    throw new Error(typeof answer.error === 'string' ? answer.error : `请求失败（${String(response.status)}）`)
  }
  return answer.data as T
}

/**
 * Bind the routes to one working directory.
 * @param fetchFn - the fetch to use.
 * @param cwd - the working directory the operations run in.
 * @returns the poster.
 */
export function gitPost(fetchFn: Fetch, cwd: string): GitPost {
  return async <T>(operation: string, body: object = {}): Promise<T> =>
    postJson<T>(fetchFn, `${GIT_ROUTE_PREFIX}/${operation}`, { ...body, cwd })
}
