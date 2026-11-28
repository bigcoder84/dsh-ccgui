/**
 * The CLI switches as the settings page sees them. The plugin owns them: a CLI switched off
 * is no provider at all, so the list comes from the plugin, not from what the composer's
 * switcher happens to be offered. The first read hands over the list this browser kept
 * before, once, so the CLIs a user turned off stay off.
 * @module dsh-ccgui/client/cli-switches
 */

import type { CliSwitchApi, CliSwitchEntry, CliSwitchReply } from './cli-switch-api.ts'
import type { Store } from './store.ts'

interface CliSwitchesSnapshot {
  /** Undefined until the plugin has answered. */
  readonly clis: readonly CliSwitchEntry[] | undefined
  /** CLIs whose switch is on its way to the plugin. */
  readonly pending: readonly string[]
  /** Why the last read or switch failed, until the next one succeeds. */
  readonly failure: string | undefined
}

export interface CliSwitches extends Store<CliSwitchesSnapshot> {
  /** Ask the plugin for the list again. */
  load(): void
  /** Switch one CLI; `order` is the switcher's, for moving the default off a CLI switched off. */
  set(id: string, enabled: boolean, order: readonly string[]): void
}

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/**
 * @param api - the plugin's CLI switch route.
 * @param legacyHidden - the CLIs this browser left out of the switcher before the switches moved.
 * @returns the switches, empty until the first load.
 */
export function createCliSwitches(api: CliSwitchApi, legacyHidden: () => readonly string[]): CliSwitches {
  let snapshot: CliSwitchesSnapshot = { clis: undefined, pending: [], failure: undefined }
  let listeners: ReadonlySet<() => void> = new Set()
  const update = (next: Partial<CliSwitchesSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }
  const fail = (reason: unknown): void => {
    update({ failure: textOf(reason) })
  }
  const handOver = async (reply: CliSwitchReply): Promise<CliSwitchReply> => {
    const hidden = legacyHidden()
    return reply.saved || hidden.length === 0 ? reply : api.adopt(hidden)
  }
  return {
    subscribe: (listener) => {
      listeners = new Set([...listeners, listener])
      return () => {
        listeners = new Set([...listeners].filter((candidate) => candidate !== listener))
      }
    },
    getSnapshot: () => snapshot,
    load: () => {
      api
        .read()
        .then(handOver)
        .then((reply) => {
          update({ clis: reply.clis, failure: undefined })
        }, fail)
    },
    set: (id, enabled, order) => {
      update({ pending: [...snapshot.pending, id] })
      const settle = (next: Partial<CliSwitchesSnapshot>): void => {
        update({ ...next, pending: snapshot.pending.filter((candidate) => candidate !== id) })
      }
      api.set(id, enabled, order).then(
        (reply) => {
          settle({ clis: reply.clis, failure: undefined })
        },
        (reason: unknown) => {
          settle({ failure: textOf(reason) })
        },
      )
    },
  }
}
