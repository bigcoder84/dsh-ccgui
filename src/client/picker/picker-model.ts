/**
 * What the model picker shows, derived from the session's model directory: the provider
 * tabs, and the reasoning scale as a row of slider stops with the names the picker uses.
 * Pure, so every rule here is checked without rendering.
 * @module dsh-ccgui/client/picker/picker-model
 */

import { DEFAULT_MODEL_SUFFIX } from '../../constants.ts'
import { cliChoices } from '../choices.ts'
import type { DirectoryState } from '../choices.ts'
import { arrangeChoices } from '../cli-prefs.ts'
import type { CliChoice, CliPrefsSnapshot } from '../cli-prefs.ts'
import type { EffortLevel } from '../menu-models.ts'

/** Names for the levels CLIs report by these ids; the top two stay as CLIs name them. */
const LEVEL_NAMES: Readonly<Record<string, string>> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: 'Max',
  ultra: 'Ultra',
}
/** The provider's own choice, when it advertises no default level of its own. */
const PROVIDER_CHOICE = '默认'
/** A scale this short has no level worth a warning at its top. */
const MIN_LEVELS_FOR_TOP = 3
/** Words that mark a CLI mode as running without the usual approvals. */
const RISKY_WORDS = /full|bypass|danger|yolo/i

/** One stop of the reasoning slider. */
export interface EffortStop {
  readonly key: string
  /** Undefined for the provider's own choice. */
  readonly effort: string | undefined
  readonly label: string
}

/** The reasoning slider of the current model. */
export interface EffortScale {
  readonly stops: readonly EffortStop[]
  /** The stop in effect, or -1 when none is. */
  readonly index: number
  /** The last of more than two real levels is in effect, which uses noticeably more. */
  readonly top: boolean
}

/** The provider tabs. */
export interface PickerTabs {
  readonly items: readonly CliChoice[]
  /** The same entries in the directory's order, which the settings page learns them in. */
  readonly listed: readonly CliChoice[]
  readonly currentId: string | undefined
}

const labelOf = ({ effort, name }: EffortLevel): string =>
  effort === undefined ? PROVIDER_CHOICE : (LEVEL_NAMES[effort] ?? name)

/**
 * Lay the current model's reasoning levels out as slider stops.
 * @param levels - the model's levels, the provider's own choice first when it has one.
 * @param current - the level in effect, if known.
 * @returns the stops, which one is in effect, and whether it is the top level.
 */
export function effortStops(levels: readonly EffortLevel[], current: EffortLevel | undefined): EffortScale {
  const stops = levels.map((level) => ({ key: level.key, effort: level.effort, label: labelOf(level) }))
  const index = current === undefined ? -1 : stops.findIndex((stop) => stop.key === current.key)
  const real = stops.filter((stop) => stop.effort !== undefined)
  const last = real.at(-1)
  const top = real.length >= MIN_LEVELS_FOR_TOP && last !== undefined && stops[index]?.key === last.key
  return { stops, index, top }
}

/**
 * Tell whether a CLI mode runs without the usual approvals, which the picker's button flags.
 * @param mode - the mode's id and name, as the CLI reports them.
 * @returns true for a mode such as Full access or Bypass permissions.
 */
export function isRiskyMode({ value, name }: { readonly value: string; readonly name: string }): boolean {
  return RISKY_WORDS.test(value) || RISKY_WORDS.test(name)
}

/**
 * List the provider tabs: the switcher's entries, the harness as one, in the user's order.
 * @param state - the session's model directory.
 * @param prefs - the user's order.
 * @returns the tabs and the one in use.
 */
export function pickerTabs(state: DirectoryState, prefs: CliPrefsSnapshot): PickerTabs {
  const { items, currentId } = cliChoices(state)
  return { items: arrangeChoices(items, prefs), listed: items, currentId }
}

/**
 * A model's name as the picker shows it. The row standing for the CLI's own setting is always
 * the first, and the catalog drops that model's own row, so its name needs no 「（默认）」.
 * @param name - the name the catalog gives.
 * @returns the name without the suffix.
 */
export function shownName(name: string): string {
  return name.endsWith(DEFAULT_MODEL_SUFFIX) ? name.slice(0, -DEFAULT_MODEL_SUFFIX.length) : name
}
