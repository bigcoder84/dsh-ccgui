/**
 * Learns which of a CLI's models have a fast tier. Codex reports its fast mode only for the
 * model a session is on, so the probe's throwaway session is switched to each model in turn
 * and what each one reports is kept. Switching sends no prompt, so no model is called.
 * @module dsh-ccgui/model-speeds
 */

import { setTimeout as delay } from 'node:timers/promises'
import { readModelList, readSpeedList } from './model-options.ts'
import type { CliModelList, CliSpeedList } from './model-options.ts'
import type { AcpTransport } from './transport.ts'

/**
 * How long the switching may take in all. The menu is already filled by then; this only bounds
 * how long the CLI is kept running for an answer that merely adds to it.
 */
export const SPEED_WALK_LIMIT_MS = 5_000

/** What one switch taught: the model's fast mode, `null` for none. Undefined teaches nothing. */
type Learned = { readonly speed: CliSpeedList | null } | undefined

/**
 * What a switch reported about the model switched to. An answer that does not show the CLI on
 * that model would describe another one, so it teaches nothing.
 */
function speedAfterSwitch(options: Parameters<typeof readModelList>[0], model: string): Learned {
  if (readModelList(options)?.current !== model) return undefined
  return { speed: readSpeedList(options) ?? null }
}

/**
 * Switch a session through every model but the one it is on, and return each model's fast mode.
 * A model that could not be switched to stays out, as unknown; so do the rest once the time
 * runs out. It never rejects: what it learns only adds to a list already in hand.
 * @param transport - the CLI.
 * @param sessionId - a session no one else uses, since its model is changed.
 * @param list - the models, as the session reported them.
 * @param limitMs - how long the switching may take in all.
 * @returns each model's fast mode, `null` for a model without one.
 */
export async function readSpeeds(
  transport: AcpTransport,
  sessionId: string,
  list: CliModelList,
  limitMs: number,
): Promise<Readonly<Record<string, CliSpeedList | null>>> {
  const timer = new AbortController()
  // Resolves false once the time is up; aborting it at the end only ends the wait.
  const deadline = delay(limitMs, false as const, { signal: timer.signal, ref: false }).catch(() => false as const)
  let speeds: Readonly<Record<string, CliSpeedList | null>> = { [list.current]: list.speed ?? null }
  try {
    for (const { value } of list.options) {
      if (value === list.current) continue
      const switched = transport.setConfigOption(sessionId, list.configId, value).then(
        (options) => speedAfterSwitch(options, value),
        (): Learned => undefined,
      )
      const answer = await Promise.race([switched, deadline])
      if (answer === false) break
      if (answer !== undefined) speeds = { ...speeds, [value]: answer.speed }
    }
  } finally {
    timer.abort()
  }
  return speeds
}
