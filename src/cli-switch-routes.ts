/**
 * The settings page's CLI switch route, under `/dsh-ccgui/clis`. It lists every configured CLI
 * with its switch, switches one, and takes over the list a browser kept before the switches
 * moved to the plugin. Like the other routes, the harness's web server leaves authentication to
 * each route, so every request first asks `connection` for a rejection.
 * @module dsh-ccgui/cli-switch-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { CLI_SWITCH_ROUTE } from './constants.ts'
import { BodyTooLarge, isObject, isText, messageOf, readJson, sendJson } from './route-json.ts'

/** One configured CLI as the settings page lists it. */
interface CliSwitch {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
}

/** Every configured CLI, and whether a choice was ever saved. */
export interface CliSwitchList {
  readonly clis: readonly CliSwitch[]
  readonly saved: boolean
}

/** What the route reads from and changes in the bridge. */
export interface CliSwitchRoutes {
  list(): CliSwitchList
  /** Switch one CLI; `order` is the switcher's, for moving the default off a CLI switched off. */
  set(provider: string, enabled: boolean, order: readonly string[]): Promise<void>
  adopt(disabled: readonly string[]): Promise<void>
}

/** The parts of the harness's `webServer` and `connection` services this module uses. */
interface SwitchWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}
interface SwitchConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** A body is a switch and the switcher's order; anything larger is not a request this route takes. */
const MAX_BODY_BYTES = 16 * 1024
const UNEXPECTED = '切换 CLI 失败，请查看日志'

type Request =
  | { readonly kind: 'list' }
  | { readonly kind: 'set'; readonly provider: string; readonly enabled: boolean; readonly order: readonly string[] }
  | { readonly kind: 'adopt'; readonly disabled: readonly string[] }

const isIdList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText)

/** Read the one body shape each request takes. */
function requestOf(body: unknown): Request | undefined {
  if (!isObject(body)) return undefined
  if (body.adopt !== undefined) return isIdList(body.adopt) ? { kind: 'adopt', disabled: body.adopt } : undefined
  if (body.provider === undefined && body.enabled === undefined) return { kind: 'list' }
  if (!isText(body.provider) || typeof body.enabled !== 'boolean') return undefined
  const order = body.order ?? []
  if (!isIdList(order)) return undefined
  return { kind: 'set', provider: body.provider, enabled: body.enabled, order }
}

async function apply(routes: CliSwitchRoutes, request: Request): Promise<void> {
  if (request.kind === 'set') await routes.set(request.provider, request.enabled, request.order)
  if (request.kind === 'adopt') await routes.adopt(request.disabled)
}

async function readRequest(req: IncomingMessage, res: ServerResponse): Promise<Request | undefined> {
  try {
    const request = requestOf(await readJson(req, MAX_BODY_BYTES))
    if (request === undefined) sendJson(res, 400, { success: false, error: '请求格式不正确' })
    return request
  } catch (error: unknown) {
    const tooLarge = error instanceof BodyTooLarge
    sendJson(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? '请求内容过大' : '请求格式不正确' })
    return undefined
  }
}

/**
 * Build the handler for the CLI switch route.
 * @param routes - the bridge's CLI switches.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns the request handler.
 */
export function cliSwitchHandler(
  routes: CliSwitchRoutes,
  connection: SwitchConnection,
  warn: (message: string) => void,
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
    const request = await readRequest(req, res)
    if (request === undefined) return
    try {
      // A change and the list are one operation: the answer is the state after the change.
      await apply(routes, request)
      sendJson(res, 200, { success: true, data: routes.list() })
    } catch (error: unknown) {
      const known = error instanceof LlmError
      if (!known) warn(`ccgui: CLI switch failed: ${messageOf(error)}`)
      sendJson(res, known ? 400 : 500, { success: false, error: known ? messageOf(error) : UNEXPECTED })
    }
  }
}

/**
 * Serve the CLI switch route on the harness's web server.
 * @param server - the harness's web server.
 * @param routes - the bridge's CLI switches.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns a disposer that unregisters the route.
 */
export function registerCliSwitchRoute(
  server: SwitchWebServer,
  routes: CliSwitchRoutes,
  connection: SwitchConnection,
  warn: (message: string) => void,
): () => void {
  return server.register({
    kind: 'prefix',
    path: CLI_SWITCH_ROUTE,
    handler: cliSwitchHandler(routes, connection, warn),
  })
}
