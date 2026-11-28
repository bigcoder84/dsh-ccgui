/**
 * The user's order for the model picker's provider tabs, edited on the settings page. The harness
 * only lists providers per session, so the switcher reports the ones it sees and they are kept
 * here; that is how the settings page knows the harness's own entry even when no session is
 * open. Which CLIs exist is the plugin's to say (see cli-switches.ts): a CLI switched off is no
 * provider at all. The list of CLIs this browser once left out is still read, so the plugin
 * can take it over once.
 * @module dsh-ccgui/client/cli-prefs
 */

import { CLI_ROUTE_PREFIX } from '../constants.ts'
import type { CliSwitchEntry } from './cli-switch-api.ts'
import type { Store } from './store.ts'

/** A provider as the switcher lists it. */
export interface CliChoice {
  readonly id: string
  readonly label: string
}

/** A provider as the settings page lists it. */
export interface CliEntry extends CliChoice {
  readonly enabled: boolean
}

export interface CliPrefsSnapshot {
  /** The providers the switcher currently offers, in the order first seen. */
  readonly known: readonly CliChoice[]
  /** Ids in the user's order; providers missing here follow in the directory's order. */
  readonly order: readonly string[]
  /** CLIs this browser left out before the plugin owned the switches; only read, to hand over. */
  readonly hidden: readonly string[]
}

/** The parts of `window.localStorage` used here, so tests can hand in a plain map. */
export interface CliPrefsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CliPrefs extends Store<CliPrefsSnapshot> {
  /** Record the providers a switcher was given, forgetting those it no longer offers. */
  remember(choices: readonly CliChoice[]): void
  /**
   * Move a provider one place up (-1) or down (1).
   * @param listed - the ids as the settings page lists them, which the new order is made from.
   */
  move(id: string, delta: -1 | 1, listed: readonly string[]): void
}

export const CLI_PREFS_STORAGE_KEY = 'dsh-ccgui.cli-prefs'

/**
 * Tell whether an entry is the harness's own, rather than a CLI. The switcher always lists
 * it, so the settings page offers no way to turn it off and stored preferences that hid it
 * are ignored. Any non-CLI id counts: which harness provider stands for the harness depends
 * on the catalog, and older versions listed each of them separately.
 * @param id - a provider route.
 * @returns true for the harness's entry.
 */
export const isBuiltInChoice = (id: string): boolean => !id.startsWith(CLI_ROUTE_PREFIX)

const EMPTY: CliPrefsSnapshot = { known: [], order: [], hidden: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function choices(value: unknown): readonly CliChoice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) =>
    isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string'
      ? [{ id: item.id, label: item.label }]
      : [],
  )
}

/**
 * Read stored preferences, keeping only well-formed fields.
 * @param raw - the stored JSON, or null when nothing is stored.
 * @returns the preferences; empty ones change nothing about the switcher.
 */
export function parseCliPrefs(raw: string | null): CliPrefsSnapshot {
  if (raw === null) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (_error: unknown) {
    // A corrupt entry should cost the user their order, not the plugin's start.
    return EMPTY
  }
  if (!isRecord(value)) return EMPTY
  return {
    known: choices(value.known),
    order: strings(value.order),
    hidden: strings(value.hidden).filter((id) => !isBuiltInChoice(id)),
  }
}

function sortByOrder<T extends CliChoice>(items: readonly T[], order: readonly string[]): readonly T[] {
  // Unordered items rank after ordered ones; the stable sort keeps their directory order.
  const rank = (id: string): number => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return [...items].sort((a, b) => rank(a.id) - rank(b.id))
}

/**
 * Order what a switcher would list. Nothing is left out here: a CLI switched off is not a
 * provider, so the directory never offers it.
 * @param items - the directory's providers, in its order.
 * @param prefs - the preferences.
 * @returns the providers in the user's order.
 */
export function arrangeChoices<T extends CliChoice>(items: readonly T[], prefs: CliPrefsSnapshot): readonly T[] {
  return sortByOrder(items, prefs.order)
}

/**
 * The settings page's rows: the harness's own entry as the switcher last saw it, and every
 * configured CLI as the plugin lists it, on or off, in the user's order.
 * @param prefs - the preferences.
 * @param clis - the plugin's CLIs, or undefined before it has answered.
 * @returns the rows.
 */
export function settingsEntries(
  prefs: CliPrefsSnapshot,
  clis: readonly CliSwitchEntry[] | undefined,
): readonly CliEntry[] {
  const builtIn = prefs.known
    .filter((choice) => isBuiltInChoice(choice.id))
    .map((choice) => ({ ...choice, enabled: true }))
  return sortByOrder([...builtIn, ...(clis ?? [])], prefs.order)
}

function rememberChoices(prefs: CliPrefsSnapshot, seen: readonly CliChoice[]): CliPrefsSnapshot {
  // A switcher renders before the harness has listed any provider. An empty report cannot
  // tell "this deployment has none" from "not loaded yet", so it must not clear the list.
  if (seen.length === 0) return prefs
  const offered = new Set(seen.map((choice) => choice.id))
  // A CLI removed from the plugin's agents keeps no row in settings. Its order and hidden
  // choice stay stored, so putting it back restores what the user had set before.
  const known = prefs.known.filter((choice) => offered.has(choice.id))
  const renamed = known.map((choice) => seen.find((candidate) => candidate.id === choice.id) ?? choice)
  const added = seen.filter((choice) => !known.some((candidate) => candidate.id === choice.id))
  const dropped = known.length !== prefs.known.length
  const relabelled = renamed.some((choice, index) => choice.label !== prefs.known[index]?.label)
  if (!dropped && added.length === 0 && !relabelled) return prefs
  return { ...prefs, known: [...renamed, ...added] }
}

function moveChoice(prefs: CliPrefsSnapshot, id: string, delta: -1 | 1, ids: readonly string[]): CliPrefsSnapshot {
  // Moving writes out the whole list, so later additions land after what the user arranged.
  const from = ids.indexOf(id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= ids.length) return prefs
  const other = ids[to] ?? id
  return { ...prefs, order: ids.map((candidate, index) => (index === from ? other : index === to ? id : candidate)) }
}

function readPrefs(storage: CliPrefsStorage): CliPrefsSnapshot {
  try {
    return parseCliPrefs(storage.getItem(CLI_PREFS_STORAGE_KEY))
  } catch (_error: unknown) {
    // Storage can be blocked (private modes, policies); the directory's own order is harmless.
    return EMPTY
  }
}

/**
 * @param storage - where the preferences are kept; the browser's localStorage in the harness.
 * @returns the preferences, loaded from storage.
 */
export function createCliPrefs(storage: CliPrefsStorage): CliPrefs {
  let prefs = readPrefs(storage)
  let listeners: readonly (() => void)[] = []
  const update = (next: CliPrefsSnapshot): void => {
    if (next === prefs) return
    prefs = next
    try {
      storage.setItem(CLI_PREFS_STORAGE_KEY, JSON.stringify(prefs))
    } catch (_error: unknown) {
      // The change still applies for this run; only remembering it across restarts is lost.
    }
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => prefs,
    subscribe(listener) {
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener)
      }
    },
    remember: (seen) => {
      update(rememberChoices(prefs, seen))
    },
    move: (id, delta, listed) => {
      update(moveChoice(prefs, id, delta, listed))
    },
  }
}
