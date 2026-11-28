/**
 * The AI commit message routes, under `/dsh-ccgui/commit-message`: the 变更 panel posts its
 * working directory and selected files and gets a message written by a harness model; the
 * settings page reads (`/settings`) and saves (`/save`) the model and prompt. Like the other
 * routes, authentication is left to each route, so every request first asks `connection` for
 * a rejection. Closing a generate request (the panel's 停止) stops the model call.
 * @module dsh-ccgui/commit/commit-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { COMMIT_MESSAGE_ROUTE } from '../constants.ts'
import { GitRequestError, asBody } from '../git/git-requests.ts'
import { repoRoot } from '../git/git-read.ts'
import { GitError } from '../git/git-run.ts'
import type { Spawn } from '../git/git-run.ts'
import { BodyTooLarge, messageOf, readJson, sendJson } from '../route-json.ts'
import { collectChanges } from './commit-changes.ts'
import { CommitSuggestError, suggestCommitMessage } from './commit-suggest.ts'
import type { SuggestLlm, Suggestion } from './commit-suggest.ts'
import type { CommitService } from './commit-service.ts'
import { isAbsolute } from 'node:path'

/** A directory and up to a few thousand paths. */
const MAX_BODY_BYTES = 1024 * 1024
const MAX_PATHS = 5_000
const NOT_A_REPO = '当前工作区不是 Git 仓库'
const COMMIT_SEGMENT = COMMIT_MESSAGE_ROUTE.split('/').pop() ?? ''

/** What a request needs from the plugin: git, the model service, and the settings. */
export interface CommitRouteDeps {
  readonly spawn: Spawn
  readonly llm: () => SuggestLlm | undefined
  readonly service: Pick<CommitService, 'route' | 'prompt' | 'view' | 'save'>
  readonly warn: (message: string) => void
  readonly timeoutMs?: number | undefined
}

interface CommitWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}
interface CommitConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Relative, without `..`; the status check later keeps only files git reports anyway. */
function pathsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS) {
    throw new GitRequestError('缺少或无效的参数：paths')
  }
  return value.map((path: unknown) => {
    if (typeof path !== 'string' || path === '' || path.includes('\0') || isAbsolute(path)) {
      throw new GitRequestError('文件路径无效')
    }
    if (path.split(/[\\/]/).includes('..')) throw new GitRequestError('文件路径无效')
    return path
  })
}

async function requestOf(req: IncomingMessage): Promise<{ cwd: string; paths: string[] }> {
  const body = asBody(await readJson(req, MAX_BODY_BYTES))
  const { cwd } = body
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) throw new GitRequestError('工作目录必须是绝对路径')
  return { cwd, paths: pathsOf(body.paths) }
}

function statusOf(error: unknown): number {
  if (error instanceof BodyTooLarge) return 413
  if (error instanceof GitRequestError || error instanceof SyntaxError) return 400
  if (error instanceof CommitSuggestError || error instanceof GitError) return 409
  return 500
}

async function suggest(deps: CommitRouteDeps, req: IncomingMessage, signal: AbortSignal): Promise<Suggestion> {
  const { cwd, paths } = await requestOf(req)
  const root = await repoRoot(deps.spawn, cwd)
  if (root === undefined) throw new GitRequestError(NOT_A_REPO)
  return suggestCommitMessage({
    llm: deps.llm(),
    route: () => deps.service.route(),
    prompt: deps.service.prompt(),
    collect: (budget) => collectChanges(deps.spawn, root, paths, budget),
    signal,
    timeoutMs: deps.timeoutMs,
  })
}

/** The operation is the path below the route: none generates, `settings` reads, `save` saves. */
async function answer(deps: CommitRouteDeps, req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  // The last segment, as the git routes read it: whether the server hands over the full path or not.
  const segment =
    (req.url ?? '')
      .split('?')[0]
      ?.split('/')
      .filter((part) => part !== '')
      .pop() ?? ''
  if (segment === COMMIT_SEGMENT) return suggest(deps, req, signal)
  if (segment === 'settings') return deps.service.view()
  if (segment === 'save') return deps.service.save(await readJson(req, MAX_BODY_BYTES))
  throw new GitRequestError('不支持的操作')
}

/**
 * Build the handler for the commit message routes.
 * @param deps - git, the model service and the configured route.
 * @param connection - the harness's trust check.
 * @returns the request handler.
 */
export function commitMessageHandler(
  deps: CommitRouteDeps,
  connection: CommitConnection,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      sendJson(res, rejection, { success: false, error: '未授权' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: '只支持 POST' }, { allow: 'POST' })
      return
    }
    // The panel aborts its fetch on 停止; the socket closing before the answer is sent says so.
    const cancel = new AbortController()
    res.once('close', () => {
      if (!res.writableEnded) cancel.abort()
    })
    try {
      const data = await answer(deps, req, cancel.signal)
      if (!cancel.signal.aborted) sendJson(res, 200, { success: true, data })
    } catch (error: unknown) {
      if (cancel.signal.aborted) return
      const status = statusOf(error)
      if (status === 500) deps.warn(`ccgui: commit message failed: ${messageOf(error)}`)
      sendJson(res, status, {
        success: false,
        error: status === 400 && error instanceof SyntaxError ? '请求格式不正确' : messageOf(error),
      })
    }
  }
}

/**
 * Serve the commit message route on the harness's web server.
 * @param server - the harness's web server.
 * @param deps - git, the model service and the configured route.
 * @param connection - the harness's trust check.
 * @returns a disposer that unregisters the route.
 */
export function registerCommitMessageRoute(
  server: CommitWebServer,
  deps: CommitRouteDeps,
  connection: CommitConnection,
): () => void {
  return server.register({
    kind: 'prefix',
    path: COMMIT_MESSAGE_ROUTE,
    handler: commitMessageHandler(deps, connection),
  })
}
