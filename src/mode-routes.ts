/**
 * The composer's mode route, under `/dsh-ccgui/modes`. A CLI's modes belong to the CLI:
 * the route only lists what that CLI reported and sends the chosen id back unchanged, so
 * no CLI mode is ever turned into a harness preset. The CLI's fast mode travels the same
 * way, beside the modes, since the composer shows both from one answer. Like the git routes, the harness's web
 * server leaves authentication to each route, so every request first asks `connection` for
 * a rejection.
 * @module dsh-ccgui/mode-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { MODE_ROUTE_PREFIX } from './constants.ts'
import type { CliModeList, CliSpeedList } from './model-options.ts'
import { BodyTooLarge, isObject, isText, messageOf, readJson, sendJson } from './route-json.ts'

/** The parts of the harness's `webServer` service this module uses. */
export interface ModeWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}

/** The parts of the harness's `connection` service this module uses. */
export interface ModeConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** What is known for a session's route, and the picks the CLI has not confirmed. */
export interface ModeRouteState {
  readonly modes?: CliModeList
  readonly pending?: string
  readonly speed?: CliSpeedList
  readonly speedPending?: string
}

/** What the route reads from the bridge. */
export interface ModeRoutes {
  /** The modes and the fast mode known for a session's route. */
  modeState(sessionId: string, provider: string): ModeRouteState
  /** Ask that CLI to switch, by the id it reported. */
  switchMode(sessionId: string, provider: string, mode: string): Promise<CliModeList | undefined>
  /** Ask that CLI to turn its fast mode on or off, by the value it reported. */
  switchSpeed(sessionId: string, provider: string, value: string): Promise<CliSpeedList | undefined>
}

/** A body is two ids, a mode and a speed; anything larger is not a request this route takes. */
const MAX_BODY_BYTES = 8 * 1024
const MODE_FAILED = '切换模式失败，请查看日志'
const SPEED_FAILED = '切换快速模式失败，请查看日志'

interface RequestFields {
  readonly sessionId: string
  readonly provider: string
  /** Absent when the caller only reads. */
  readonly mode: string | undefined
  /** Absent unless the caller switches the fast mode. */
  readonly speed: string | undefined
}

/** Read the one body shape this route accepts. */
function fieldsOf(body: unknown): RequestFields | undefined {
  if (!isObject(body) || !isText(body.sessionId) || !isText(body.provider)) return undefined
  if (body.mode !== undefined && !isText(body.mode)) return undefined
  if (body.speed !== undefined && !isText(body.speed)) return undefined
  return { sessionId: body.sessionId, provider: body.provider, mode: body.mode, speed: body.speed }
}

/** The mode goes first, like at the start of a turn. */
async function sendPicks(routes: ModeRoutes, { sessionId, provider, mode, speed }: RequestFields): Promise<void> {
  if (mode !== undefined) await routes.switchMode(sessionId, provider, mode)
  if (speed !== undefined) await routes.switchSpeed(sessionId, provider, speed)
}

/**
 * Build the handler for the mode route.
 * @param routes - what the bridge knows about native modes.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns the request handler.
 */
export function modeHandler(
  routes: ModeRoutes,
  connection: ModeConnection,
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
    let fields: RequestFields | undefined
    try {
      fields = fieldsOf(await readJson(req, MAX_BODY_BYTES))
    } catch (error: unknown) {
      const tooLarge = error instanceof BodyTooLarge
      sendJson(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? '请求内容过大' : '请求格式不正确' })
      return
    }
    if (fields === undefined) {
      sendJson(res, 400, { success: false, error: '请求缺少会话或 CLI' })
      return
    }
    try {
      // Sending a pick and reading the state are one operation: the answer is what that
      // CLI reports after the change, in the same ids and names it gave.
      await sendPicks(routes, fields)
      const { modes, pending, speed, speedPending } = routes.modeState(fields.sessionId, fields.provider)
      const data = {
        modes: modes ?? null,
        pending: pending ?? null,
        speed: speed ?? null,
        speedPending: speedPending ?? null,
      }
      sendJson(res, 200, { success: true, data })
    } catch (error: unknown) {
      const known = error instanceof LlmError
      if (!known) warn(`ccgui: mode request failed: ${messageOf(error)}`)
      const failed = fields.mode === undefined && fields.speed !== undefined ? SPEED_FAILED : MODE_FAILED
      sendJson(res, known ? 400 : 500, { success: false, error: known ? messageOf(error) : failed })
    }
  }
}

/**
 * Serve the mode route on the harness's web server.
 * @param server - the harness's web server.
 * @param routes - what the bridge knows about native modes.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns a disposer that unregisters the route.
 */
export function registerModeRoute(
  server: ModeWebServer,
  routes: ModeRoutes,
  connection: ModeConnection,
  warn: (message: string) => void,
): () => void {
  return server.register({ kind: 'prefix', path: MODE_ROUTE_PREFIX, handler: modeHandler(routes, connection, warn) })
}
