/// <reference lib="dom" />

/**
 * What other plugins add to the harness's own model menu, shown in the picker instead. The
 * picker hides that menu, so without this their rows and labels would be lost: Codex
 * Subscription, for one, puts its speed and output-detail rows in `conversation.input.model.options`
 * and a bolt into the model's name through `conversation.input.model.label`. The harness's menu
 * declares those slots and only it may render them through the host, so the picker reads their
 * entries from the slot registry and renders each with the props the harness's menu passes.
 * One plugin failing to render takes only its own row away.
 * @module dsh-ccgui/client/picker/hosted-slots
 */

import { Component, useEffect, useState } from 'react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { isCliRoute } from '../../constants.ts'
import type { DirectoryState } from '../choices.ts'
import { PICKER_HOSTED_CLASS } from './picker-styles.ts'

/** The harness menu's slot for extra rows, below the reasoning level. */
export const OPTIONS_SLOT = 'conversation.input.model.options'
/** The harness menu's slot that draws a model's name, on the button and in the rows. */
export const LABEL_SLOT = 'conversation.input.model.label'

/**
 * One registration in a slot, as the harness's registry lists it. The registry keeps the
 * registrant's `inject` beside `options`, not inside it: reading it from `options` hands a
 * plugin's row none of its own props, and the row fails without a word.
 */
export interface HostEntry {
  readonly component: unknown
  readonly options: {
    readonly id?: string
    readonly priority?: number
  }
  readonly inject?: (sessionId: string) => unknown
}

/** The parts of the harness's slot registry used to read other plugins' entries. */
export interface HostSlots {
  entries?: (name: string) => readonly HostEntry[]
  subscribe?: (name: string, listener: () => void) => () => void
}

type Props = Record<string, unknown>

const isObject = (value: unknown): value is Props => typeof value === 'object' && value !== null
/** A function component, or what memo and forwardRef wrap one in. */
const isComponent = (value: unknown): value is ComponentType<Props> =>
  typeof value === 'function' || (isObject(value) && '$$typeof' in value)
const priorityOf = (entry: HostEntry): number => entry.options.priority ?? 0

/** Keeps a plugin's failing row from taking the picker down with it. */
class Isolated extends Component<
  { readonly children: ReactNode; readonly fallback?: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

/**
 * Follow one slot's entries, highest priority first.
 * @param slots - the harness's slot registry; without `entries` the slot reads as empty.
 * @param name - the slot.
 * @returns its entries.
 */
export function useSlotEntries(slots: HostSlots | undefined, name: string): readonly HostEntry[] {
  const [, setVersion] = useState(0)
  useEffect(
    () =>
      slots?.subscribe?.(name, () => {
        setVersion((version) => version + 1)
      }),
    [slots, name],
  )
  const entries = slots?.entries?.(name) ?? []
  // A stable sort keeps the registry's order among equal priorities.
  return [...entries].sort((left, right) => priorityOf(right) - priorityOf(left))
}

function render(
  entry: HostEntry,
  sessionId: string,
  props: Props,
  { key, fallback }: { readonly key?: string; readonly fallback?: ReactNode } = {},
): ReactElement | null {
  if (!isComponent(entry.component)) return null
  const injected = entry.inject?.(sessionId)
  const Hosted = entry.component
  return (
    <Isolated key={key} fallback={fallback}>
      <Hosted {...(isObject(injected) ? injected : {})} {...props} sessionId={sessionId} />
    </Isolated>
  )
}

export interface HostedOptionsProps {
  readonly entries: readonly HostEntry[]
  readonly sessionId: string
  /** The menu's id; the picker's button names it in `aria-controls`, as the harness's does. */
  readonly menuId: string
  readonly locked: boolean
  readonly dismiss: () => void
  readonly reportFailure: (message: string) => void
}

/**
 * Render the rows other plugins add below the reasoning level.
 * @param props - the entries and what the harness's menu would pass them.
 * @returns the rows, or nothing when no plugin adds any.
 */
export function HostedOptions({ entries, sessionId, menuId, ...props }: HostedOptionsProps): ReactElement | null {
  if (entries.length === 0) return null
  // Rows written for the harness's menu find it as their closest role="menu", by its id.
  return (
    <div id={menuId} role="menu" className={PICKER_HOSTED_CLASS}>
      {entries.map((entry, index) => render(entry, sessionId, props, { key: entry.options.id ?? String(index) }))}
    </div>
  )
}

/** Where a model's name is drawn, in the harness's own words. */
type Placement = 'trigger' | 'menu'

/** Draws a model's name through another plugin's label, or says there is none to use. */
export type LabelFor = (
  row: { readonly provider: string; readonly model: string },
  placement: Placement,
  selected: boolean,
  fallback: string,
) => ReactNode | undefined

/**
 * Draw models' names through the first label another plugin registered, as the harness's menu
 * does. Only for the harness's own providers: those labels are written for its catalog, and a
 * CLI's names are the picker's to show.
 * @param slots - the harness's slot registry.
 * @param sessionId - the session, absent where the host passes none.
 * @param state - the directory the models come from.
 * @returns the label for a row, undefined where the picker draws its own.
 */
export function useHostedLabel(
  slots: HostSlots | undefined,
  sessionId: string | undefined,
  state: DirectoryState,
): LabelFor {
  const entries = useSlotEntries(slots, LABEL_SLOT)
  return (row, placement, selected, fallback) => {
    const entry = entries[0]
    if (entry === undefined || sessionId === undefined || isCliRoute(row.provider)) return undefined
    const provider = state.groups.find((group) => group.id === row.provider)
    const model = provider?.models.find((candidate) => candidate.id === row.model)
    if (model === undefined) return undefined
    return render(entry, sessionId, { provider, model, placement, selected }, { fallback }) ?? undefined
  }
}
