/**
 * The browser side of the CLI switches: lists every configured CLI with its switch, switches
 * one, and hands over the list this browser kept before the switches moved to the plugin.
 * @module dsh-ccgui/client/cli-switch-api
 */

import { CLI_SWITCH_ROUTE } from '../constants.ts'
import type { PostJson } from './mode-api.ts'

/** One configured CLI as the settings page lists it. */
export interface CliSwitchEntry {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
}

/** What the route knew when it answered. */
export interface CliSwitchReply {
  readonly clis: readonly CliSwitchEntry[]
  /** False until a choice was ever saved; before that the plugin's defaults stand. */
  readonly saved: boolean
}

/** What the settings page calls. */
export interface CliSwitchApi {
  read(): Promise<CliSwitchReply>
  set(provider: string, enabled: boolean, order: readonly string[]): Promise<CliSwitchReply>
  adopt(disabled: readonly string[]): Promise<CliSwitchReply>
}

const FAILED = '读取或切换 CLI 失败'
const BAD_REPLY = 'CLI 开关接口返回了无法识别的结果'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function entryOf(value: unknown): readonly CliSwitchEntry[] {
  if (!isObject(value) || !isText(value.id) || !isText(value.label) || typeof value.enabled !== 'boolean') return []
  return [{ id: value.id, label: value.label, enabled: value.enabled }]
}

/** The route is the plugin's own, but a stale build must not put a half-read list on screen. */
function replyOf(body: unknown, status: number): CliSwitchReply {
  if (!isObject(body)) throw new Error(`${FAILED}（HTTP ${status}）`)
  if (body.success !== true) throw new Error(isText(body.error) ? body.error : `${FAILED}（HTTP ${status}）`)
  const data = isObject(body.data) ? body.data : {}
  if (!Array.isArray(data.clis) || typeof data.saved !== 'boolean') throw new Error(BAD_REPLY)
  return { clis: (data.clis as readonly unknown[]).flatMap(entryOf), saved: data.saved }
}

/** A failing answer may carry no JSON at all, such as a proxy's error page. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    // Only the status is left to report, which replyOf does.
    return undefined
  }
}

/**
 * @param post - the fetch to post with.
 * @returns the settings page's three calls.
 */
export function createCliSwitchApi(post: PostJson): CliSwitchApi {
  const send = async (body: Record<string, unknown>): Promise<CliSwitchReply> => {
    const response = await post(CLI_SWITCH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return replyOf(await bodyOf(response), response.status)
  }
  return {
    read: () => send({}),
    set: (provider, enabled, order) => send({ provider, enabled, order }),
    adopt: (disabled) => send({ adopt: disabled }),
  }
}
