/**
 * The composer's context meter route, under `/dsh-ccgui/context`: how full a session's CLI
 * says its context is, from ACP's `usage_update`. Read-only. Like the other routes, the
 * harness's web server leaves authentication to each route, so every request first asks
 * `connection` for a rejection.
 * @module dsh-ccgui/context-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONTEXT_ROUTE } from './constants.ts'
import { BodyTooLarge, isObject, isText, readJson, sendJson } from './route-json.ts'
import type { ContextUsage } from './session/context-usage.ts'

/** What the route reads from the bridge. */
export interface ContextRoutes {
  usageFor(sessionId: string, provider: string): ContextUsage | undefined
}

/** The parts of the harness's `webServer` and `connection` services this module uses. */
interface ContextWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}
interface ContextConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** A body is two ids; anything larger is not a request this route takes. */
const MAX_BODY_BYTES = 4 * 1024

async function fieldsOf(req: IncomingMessage): Promise<{ sessionId: string; provider: string } | undefined> {
  const body = await readJson(req, MAX_BODY_BYTES)
  return isObject(body) && isText(body.sessionId) && isText(body.provider)
    ? { sessionId: body.sessionId, provider: body.provider }
    : undefined
}

/**
 * Build the handler for the context route.
 * @param routes - what the bridge knows about each session's context.
 * @param connection - the harness's trust check.
 * @returns the request handler.
 */
export function contextHandler(
  routes: ContextRoutes,
  connection: ContextConnection,
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
    try {
      const fields = await fieldsOf(req)
      if (fields === undefined) {
        sendJson(res, 400, { success: false, error: '请求缺少会话或 CLI' })
        return
      }
      sendJson(res, 200, { success: true, data: { usage: routes.usageFor(fields.sessionId, fields.provider) ?? null } })
    } catch (error: unknown) {
      const tooLarge = error instanceof BodyTooLarge
      sendJson(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? '请求内容过大' : '请求格式不正确' })
    }
  }
}

/**
 * Serve the context route on the harness's web server.
 * @param server - the harness's web server.
 * @param routes - what the bridge knows about each session's context.
 * @param connection - the harness's trust check.
 * @returns a disposer that unregisters the route.
 */
export function registerContextRoute(
  server: ContextWebServer,
  routes: ContextRoutes,
  connection: ContextConnection,
): () => void {
  return server.register({ kind: 'prefix', path: CONTEXT_ROUTE, handler: contextHandler(routes, connection) })
}
