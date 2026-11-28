/**
 * The model and reasoning level last selected under each entry of the composer's CLI
 * switcher, so choosing that entry again picks them up instead of the provider's own default.
 * Keyed by the switcher's entries: a CLI by its route, and the harness by its one entry,
 * which stands for every provider the harness runs, so it recalls which of them was last used.
 * Kept in the browser, like the switcher's order.
 * @module dsh-ccgui/client/last-selections
 */

import type { DirectorySelection } from './choices.ts'

/** The parts of `window.localStorage` used here, so tests can hand in a plain map. */
export interface LastSelectionsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LastSelections {
  /** Record what a session is on now, under the switcher entry it belongs to. */
  remember(choiceId: string, selection: DirectorySelection): void
  /** What was last selected under a switcher entry, if anything. */
  get(choiceId: string): DirectorySelection | undefined
}

export const LAST_SELECTIONS_STORAGE_KEY = 'dsh-ccgui.last-selections'

type Saved = Readonly<Record<string, DirectorySelection>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function selectionOf(value: unknown): DirectorySelection | undefined {
  if (!isRecord(value) || !isText(value.provider) || !isText(value.model)) return undefined
  const { provider, model, reasoningEffort } = value
  return isText(reasoningEffort) ? { provider, model, reasoningEffort } : { provider, model }
}

/**
 * Read stored selections, keeping only well-formed ones.
 * @param raw - the stored JSON, or null when nothing is stored.
 * @returns the selections by switcher entry.
 */
export function parseLastSelections(raw: string | null): Saved {
  let value: unknown
  try {
    value = raw === null ? undefined : JSON.parse(raw)
  } catch (_error: unknown) {
    // A corrupt entry only costs the recall; each provider starts on its default again.
    return {}
  }
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      const selection = selectionOf(entry)
      return selection === undefined ? [] : [[id, selection] as const]
    }),
  )
}

const sameSelection = (a: DirectorySelection | undefined, b: DirectorySelection): boolean =>
  a?.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort

function readSaved(storage: LastSelectionsStorage): Saved {
  try {
    return parseLastSelections(storage.getItem(LAST_SELECTIONS_STORAGE_KEY))
  } catch (_error: unknown) {
    // Storage can be blocked (private modes, policies); providers then start on their defaults.
    return {}
  }
}

/**
 * @param storage - where the selections are kept; the browser's localStorage in the harness.
 * @returns the selections, loaded from storage.
 */
export function createLastSelections(storage: LastSelectionsStorage): LastSelections {
  let saved = readSaved(storage)
  return {
    remember: (choiceId, selection) => {
      if (sameSelection(saved[choiceId], selection)) return
      const { provider, model, reasoningEffort } = selection
      saved = { ...saved, [choiceId]: reasoningEffort === undefined ? { provider, model } : selection }
      try {
        storage.setItem(LAST_SELECTIONS_STORAGE_KEY, JSON.stringify(saved))
      } catch (_error: unknown) {
        // The recall still works for this run; only keeping it across restarts is lost.
      }
    },
    get: (choiceId) => saved[choiceId],
  }
}
