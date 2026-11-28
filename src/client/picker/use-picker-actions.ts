/**
 * What the picker does when the user chooses: a provider tab, a model row, a level on the
 * slider, the reset arrow, the teamwork switch. Every change goes to the harness's model
 * directory or the harness's teamwork remote; a refusal comes back as one failure to show.
 * @module dsh-ccgui/client/picker/use-picker-actions
 */

import { useEffect, useRef, useState } from 'react'
import { selectionForChoice } from '../choices.ts'
import type { DirectorySelection, DirectoryState } from '../choices.ts'
import type { LastSelections } from '../last-selections.ts'
import type { MenuModels, MenuRow } from '../menu-models.ts'
import type { EffortScale, EffortStop } from './picker-model.ts'
import type { SettingsFailure } from './use-cli-settings.ts'

/** Switches the session's model; the harness answers a refusal with an error. */
export type SelectModel = (selection: DirectorySelection) => Promise<{ error?: { message?: string } }>

/** The harness's teamwork remote for one session; resolves to a failure message, or null. */
export interface TeamApi {
  set(enabled: boolean): Promise<string | null>
}

/** The picker's choices, and the last refusal to show. */
export interface PickerActions {
  readonly failure: SettingsFailure | undefined
  readonly clearFailure: () => void
  readonly chooseTab: (id: string) => void
  readonly chooseModel: (row: MenuRow) => void
  readonly chooseEffort: (stop: EffortStop | undefined) => void
  readonly reset: () => void
  readonly setTeam: (enabled: boolean) => void
  /** Show a failure another plugin's row reports. */
  readonly report: (text: string) => void
}

const UNKNOWN_ERROR = '未知错误'
const TEAM_FAILED = '无法确认智能体团队协作设置已保存，请重试：'

interface ActionDeps {
  readonly state: DirectoryState
  /** A selection is on its way to the harness; another one waits for it rather than racing it. */
  readonly settling: boolean
  readonly models: MenuModels
  readonly scale: EffortScale
  readonly select: SelectModel
  readonly lastSelections: LastSelections
  readonly team: TeamApi | undefined
}

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const withLevel = (row: MenuRow, stop: EffortStop | undefined): DirectorySelection => ({
  provider: row.provider,
  model: row.model,
  ...(stop?.effort === undefined ? {} : { reasoningEffort: stop.effort }),
})

/** The level a model starts at: its own default, or the provider's choice when it names none. */
function defaultStop(models: MenuModels, scale: EffortScale): EffortStop | undefined {
  const preferred = models.current?.reasoning?.defaultEffort
  return scale.stops.find((stop) => stop.effort === preferred) ?? scale.stops.find((stop) => stop.effort === undefined)
}

/**
 * Send selections to the harness one at a time. A change made while another is settling waits
 * for it, and only the last such change is sent: dragging the slider twice in a row must not
 * have the first answer land after the second.
 */
function useQueuedSelect(
  { select, settling }: Pick<ActionDeps, 'select' | 'settling'>,
  fail: (text: string) => void,
): (selection: DirectorySelection) => void {
  const queued = useRef<DirectorySelection | undefined>()
  const send = (selection: DirectorySelection): void => {
    select(selection).then(
      (result) => {
        if (result.error !== undefined) fail(result.error.message ?? UNKNOWN_ERROR)
      },
      (reason: unknown) => {
        fail(textOf(reason))
      },
    )
  }
  const latest = useRef(send)
  latest.current = send
  useEffect(() => {
    const next = queued.current
    if (settling || next === undefined) return
    queued.current = undefined
    latest.current(next)
  }, [settling])
  return (selection) => {
    if (settling) queued.current = selection
    else send(selection)
  }
}

/**
 * Bind the picker's choices to the harness.
 * @param deps - the directory, what the picker shows, and the harness's entry points.
 * @returns the choices and the last failure.
 */
export function usePickerActions(deps: ActionDeps): PickerActions {
  const { state, models, scale, lastSelections, team } = deps
  const [failure, setFailure] = useState<SettingsFailure | undefined>()
  const fail = (text: string): void => {
    setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text }))
  }
  const send = useQueuedSelect(deps, fail)
  const apply = (selection: DirectorySelection | undefined): void => {
    if (selection !== undefined) send(selection)
  }
  const chooseEffort = (stop: EffortStop | undefined): void => {
    if (models.current !== undefined && stop !== undefined) apply(withLevel(models.current, stop))
  }
  return {
    failure,
    clearFailure: () => {
      setFailure(undefined)
    },
    chooseTab: (id: string) => {
      apply(selectionForChoice(state, id, lastSelections.get(id)))
    },
    chooseModel: (row: MenuRow) => {
      if (row.provider !== state.current?.provider || row.model !== state.current.model) {
        apply({ provider: row.provider, model: row.model })
      }
    },
    chooseEffort,
    report: fail,
    reset: () => {
      chooseEffort(defaultStop(models, scale))
    },
    setTeam: (enabled: boolean) => {
      team?.set(enabled).then(
        (message) => {
          if (message !== null) fail(`${TEAM_FAILED}${message}`)
        },
        (reason: unknown) => {
          fail(`${TEAM_FAILED}${textOf(reason)}`)
        },
      )
    },
  }
}
