/**
 * The JSON plumbing the plugin's own web routes share: reading a bounded request body and
 * answering with an uncached JSON reply.
 * @module dsh-ccgui/route-json
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Thrown when a body outgrows what a route takes. */
export class BodyTooLarge extends Error {
  override name = 'BodyTooLarge'
}

export const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Answer with JSON that no cache keeps.
 * @param res - the response.
 * @param status - the HTTP status.
 * @param payload - the body.
 * @param headers - extra headers.
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(payload))
}

/**
 * Read a JSON body, refusing one larger than the route takes.
 * @param req - the request.
 * @param maxBytes - the largest body accepted.
 * @returns the parsed body.
 * @throws {BodyTooLarge} past the limit, and a SyntaxError for a body that is not JSON.
 */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > maxBytes) throw new BodyTooLarge('请求内容过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param error - anything thrown.
 * @returns its message.
 */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
