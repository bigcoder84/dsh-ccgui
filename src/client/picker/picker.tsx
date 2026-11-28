/// <reference lib="dom" />

/**
 * The model picker: one button in the composer and one popover for everything about the model
 * a session runs on, the same for a CLI and for the harness's own providers. The popover holds
 * the provider tabs, the model rows, the reasoning slider with the fast-mode bolt, and the one
 * setting each provider has of its own. It takes the place of the CLI switcher, the CLI mode
 * seat and the harness's native model seat.
 * @module dsh-ccgui/client/picker/picker
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAST_MODE_ON, isCliRoute } from '../../constants.ts'
import type { DirectorySelection, DirectoryState } from '../choices.ts'
import type { CliPrefs } from '../cli-prefs.ts'
import type { LastSelections } from '../last-selections.ts'
import { menuModels } from '../menu-models.ts'
import type { ModeApi } from '../mode-api.ts'
import type { SessionFacts } from '../session-facts.ts'
import { useRemoved, useRunning, useStarted } from '../session-facts.ts'
import { useStore } from '../store.ts'
import type { Store } from '../store.ts'
import { EffortPanel } from './effort-panel.tsx'
import { awaitHandBack } from './hosted-return.ts'
import { HostedOptions, OPTIONS_SLOT, useHostedLabel, useSlotEntries } from './hosted-slots.tsx'
import type { HostSlots } from './hosted-slots.tsx'
import { ModelList } from './model-list.tsx'
import { CliModeRow, TeamRow } from './picker-footer.tsx'
import { effortStops, isRiskyMode, pickerTabs, shownName } from './picker-model.ts'
import type { PickerTabs } from './picker-model.ts'
import { mountPicker } from './picker-shortcut.ts'
import { PICKER_CLASS, PICKER_POPOVER_CLASS } from './picker-styles.ts'
import { PickerTrigger } from './picker-trigger.tsx'
import { ProviderTabs } from './provider-tabs.tsx'
import { useCliSettings } from './use-cli-settings.ts'
import { usePickerActions } from './use-picker-actions.ts'
import type { SelectModel, TeamApi } from './use-picker-actions.ts'

const POPOVER_LABEL = '选择模型和思考深度'
const NO_MODEL_LABEL = '请选择模型'
const LOADING_LABEL = '正在加载模型…'
const FAILED_PREFIX = '切换失败：'

/** What the composer slot hands the picker for one session. */
export interface PickerInjected {
  /** False for an addressed subagent, which cannot select a model. */
  available: boolean
  directory: Store<DirectoryState>
  load: () => void
  select: SelectModel
  session: SessionFacts | undefined
  prefs: CliPrefs
  lastSelections: LastSelections
  /** Absent where the harness offers no web route. */
  modes?: ModeApi
  /** Absent where the harness has no teamwork remote. */
  team?: TeamApi
  /** The harness's session projections, a standard prop of session-scoped slots. */
  useProjection?: (key: string) => unknown
  /** The session, a standard prop of session-scoped slots. */
  sessionId?: string
  /** The harness's slot registry, to show what other plugins add to its model menu. */
  slots?: HostSlots
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const noProjection = (): undefined => undefined

/** The harness's teamwork for this session, if the harness runs it. */
function useTeam(useProjection: (key: string) => unknown = noProjection) {
  const team = useProjection('agentTeam')
  const selection = useProjection('modelSelection')
  if (!isObject(team) || typeof team.enabled !== 'boolean') return undefined
  const lastUsed = isObject(selection) ? selection.lastUsed : undefined
  return { enabled: team.enabled, confirmOff: lastUsed !== null && lastUsed !== undefined }
}

/** Keep the session's selection as the last one under its tab, whichever control changed it. */
function useRememberSelection(
  current: DirectorySelection | null,
  tabId: string | undefined,
  last: LastSelections,
): void {
  const { provider, model, reasoningEffort } = current ?? {}
  useEffect(() => {
    if (tabId === undefined || provider === undefined || model === undefined) return
    last.remember(tabId, { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) })
  }, [last, tabId, provider, model, reasoningEffort])
}

/**
 * The settings page learns the providers from here, as the harness has no session-free list.
 * The entries are rebuilt each render, so their ids and names say when they really changed.
 */
function useRememberProviders(prefs: CliPrefs, listed: PickerTabs['listed']): void {
  const key = listed.map(({ id, label }) => `${id}\u0000${label}`).join('\u0001')
  const latest = useRef(listed)
  latest.current = listed
  useEffect(() => {
    prefs.remember(latest.current)
  }, [prefs, key])
}

interface DismissRefs {
  readonly button: RefObject<HTMLButtonElement>
  readonly popover: RefObject<HTMLElement>
}

/**
 * A dialog the popover opened, such as the teamwork confirmation, owns its presses and keys,
 * whether the host draws it inside the popover or portals it elsewhere.
 */
function inOtherDialog(target: EventTarget | null, popover: HTMLElement | null): boolean {
  const dialog = target instanceof Element ? target.closest('[role="dialog"]') : null
  return dialog !== null && dialog !== popover
}

/** Close on Escape, handing the keyboard back to the button, or on a press outside both. */
function useDismiss(open: boolean, close: () => void, refs: DismissRefs): void {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || inOtherDialog(event.target, refs.popover.current)) return
      close()
      refs.button.current?.focus()
    }
    const onPress = (event: PointerEvent): void => {
      const { target } = event
      if (!(target instanceof Node) || inOtherDialog(target, refs.popover.current)) return
      if (refs.button.current?.contains(target) === true || refs.popover.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open, close, refs])
}

/**
 * The directory as the picker shows it: on the selection under way while the harness settles
 * it, so a change does not snap back to the old one for a moment and then forward again.
 */
function shownState(state: DirectoryState): DirectoryState {
  return state.pending === undefined || state.pending === null ? state : { ...state, current: state.pending }
}

function usePickerState(props: PickerInjected) {
  const real = useStore(props.directory)
  const state = shownState(real)
  const prefs = useStore(props.prefs)
  const models = menuModels(state)
  const tabs = pickerTabs(state, prefs)
  const scale = effortStops(models.efforts, models.effort)
  const started = useStarted(props.session)
  const locked = useRemoved(props.session) || !props.available
  const settling = state !== real
  const running = useRunning(props.session)
  // The button names the model, so the catalog is wanted before the popover opens.
  const { load } = props
  useEffect(() => {
    load()
  }, [load])
  const provider = real.current?.provider
  const cli = isCliRoute(provider) ? provider : undefined
  const settings = useCliSettings(props.modes, cli, { started, running, model: real.current?.model })
  const team = useTeam(props.useProjection)
  const actions = usePickerActions({ ...props, state, settling, models, team: props.team })
  useRememberSelection(real.current, pickerTabs(real, prefs).currentId, props.lastSelections)
  useRememberProviders(props.prefs, tabs.listed)
  const options = useSlotEntries(props.slots, OPTIONS_SLOT)
  const labelFor = useHostedLabel(props.slots, props.sessionId, state)
  return { state, models, tabs, scale, started, locked, cli, settings, team, actions, options, labelFor }
}

type PickerState = ReturnType<typeof usePickerState>

function Footer({ picker, props }: { readonly picker: PickerState; readonly props: PickerInjected }) {
  const { settings, team, actions, locked, cli } = picker
  const modes = settings.reply?.modes
  if (cli !== undefined && modes !== undefined && modes.options.length > 0) {
    return (
      <CliModeRow
        modes={modes}
        pending={settings.reply?.pending}
        disabled={locked || settings.busy}
        onChoose={(value) => {
          settings.choose('mode', value)
        }}
      />
    )
  }
  if (cli !== undefined || team === undefined || props.team === undefined) return null
  return <TeamRow enabled={team.enabled} confirmOff={team.confirmOff} disabled={locked} onSet={actions.setTeam} />
}

/** The reasoning slider and the fast-mode bolt, where the model has either. */
function Effort({ picker }: { readonly picker: PickerState }) {
  const { scale, settings, actions, locked } = picker
  const speed = settings.reply?.speed
  const fastOn = (settings.reply?.speedPending ?? speed?.current) === FAST_MODE_ON
  if (scale.stops.length === 0 && speed === undefined) return null
  return (
    <EffortPanel
      scale={scale}
      fast={speed === undefined ? undefined : { on: fastOn, pending: settings.reply?.speedPending !== undefined }}
      disabled={locked || settings.busy}
      onChoose={actions.chooseEffort}
      onFast={() => {
        settings.choose('speed', fastOn ? 'off' : FAST_MODE_ON)
      }}
    />
  )
}

/** Rows other plugins add to the harness's model menu, with what that menu passes them. */
function Hosted(props: {
  readonly picker: PickerState
  readonly sessionId: string | undefined
  readonly menuId: string
  readonly dismiss: () => void
}) {
  const { picker, sessionId } = props
  if (sessionId === undefined) return null
  return (
    <HostedOptions
      entries={picker.options}
      sessionId={sessionId}
      menuId={props.menuId}
      locked={picker.locked}
      dismiss={props.dismiss}
      reportFailure={picker.actions.report}
    />
  )
}

function Popover(props: {
  readonly picker: PickerState
  readonly injected: PickerInjected
  readonly popoverRef: RefObject<HTMLDivElement>
  readonly anchorStyle: CSSProperties
  readonly menuId: string
  readonly dismiss: () => void
}): ReactElement {
  const { picker, injected } = props
  const { models, scale, settings, actions, locked } = picker
  const [query, setQuery] = useState('')
  const speed = settings.reply?.speed
  const fastOn = (settings.reply?.speedPending ?? speed?.current) === FAST_MODE_ON
  return (
    <div
      ref={props.popoverRef}
      className={PICKER_POPOVER_CLASS}
      style={props.anchorStyle}
      role="dialog"
      aria-label={POPOVER_LABEL}
    >
      <ProviderTabs tabs={picker.tabs} started={picker.started} disabled={locked} onChoose={actions.chooseTab} />
      <ModelList
        models={models}
        state={picker.state}
        levelLabel={scale.stops[scale.index]?.label}
        fastOn={speed !== undefined && fastOn}
        query={query}
        disabled={locked}
        onQuery={setQuery}
        onChoose={actions.chooseModel}
        onRetry={injected.load}
        labelFor={picker.labelFor}
      />
      <Effort picker={picker} />
      <Hosted picker={picker} sessionId={injected.sessionId} menuId={props.menuId} dismiss={props.dismiss} />
      <Footer picker={picker} props={injected} />
    </div>
  )
}

function Failure({ picker, root }: { readonly picker: PickerState; readonly root: HTMLElement | null }) {
  const failure = picker.actions.failure ?? picker.settings.failure
  if (failure === undefined) return null
  return (
    <Toast
      key={failure.seq}
      text={`${FAILED_PREFIX}${failure.text}`}
      icon={<IconWarningOutlineRegular />}
      anchor={root?.closest<HTMLElement>('[data-composer-card]') ?? null}
      onDone={() => {
        picker.actions.clearFailure()
        picker.settings.clearFailure()
      }}
    />
  )
}

/** Open, close, and answer the shortcut. */
function useOpen(buttonRef: RefObject<HTMLButtonElement>, popoverRef: RefObject<HTMLDivElement>) {
  const [open, setOpen] = useState(false)
  const [refs] = useState(() => ({ button: buttonRef, popover: popoverRef }))
  const [close] = useState(() => () => {
    setOpen(false)
  })
  useDismiss(open, close, refs)
  const stopWaiting = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => stopWaiting.current?.(), [])
  // However the picker opened, it is no longer waiting for a list to hand back.
  useEffect(() => {
    if (open) stopWaiting.current?.()
  }, [open])
  // What a row from another plugin calls when it hands over to a menu of its own.
  const dismiss = (): void => {
    setOpen(false)
    const button = buttonRef.current
    button?.focus()
    stopWaiting.current?.()
    stopWaiting.current =
      button === null
        ? undefined
        : awaitHandBack(button, () => {
            setOpen(true)
          })
  }
  useEffect(
    () =>
      mountPicker({
        button: () => buttonRef.current,
        toggle: () => {
          if (buttonRef.current?.disabled !== true) setOpen((value) => !value)
        },
      }),
    [buttonRef],
  )
  return { open, setOpen, dismiss }
}

/** The model the button names, drawn through another plugin's label where one draws it. */
function triggerName({ models, labelFor }: PickerState): { name: string; label?: ReactNode } {
  const current = models.current
  if (current === undefined) return { name: models.loading ? LOADING_LABEL : NO_MODEL_LABEL }
  const name = shownName(current.name)
  const label = labelFor(current, 'trigger', true, name)
  return label === undefined ? { name } : { name, label }
}

/**
 * Render the picker's button and, while open, its popover.
 * @param props - what the slot injected.
 * @returns the picker.
 */
export function CliPicker(props: PickerInjected): ReactElement {
  const picker = usePickerState(props)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const { open, setOpen, dismiss } = useOpen(buttonRef, popoverRef)
  const id = useId().replaceAll(':', '')
  const anchorStyle = { '--dsh-cli-picker-anchor': `--dsh-cli-picker-${id}` } as CSSProperties
  const menuId = `dsh-cli-picker-${id}-menu`
  const { models, scale, settings } = picker
  const modes = settings.reply?.modes
  const shownMode = modes?.options.find((option) => option.value === (settings.reply?.pending ?? modes.current))
  const speed = settings.reply?.speed
  return (
    <span ref={rootRef} className={PICKER_CLASS}>
      <PickerTrigger
        buttonRef={buttonRef}
        anchorStyle={anchorStyle}
        provider={models.current?.provider ?? picker.state.current?.provider}
        {...triggerName(picker)}
        controls={open && picker.options.length > 0 ? menuId : undefined}
        level={scale.stops[scale.index]?.label}
        fastOn={speed !== undefined && (settings.reply?.speedPending ?? speed.current) === FAST_MODE_ON}
        riskyMode={shownMode !== undefined && isRiskyMode(shownMode) ? shownMode.name : undefined}
        hasModes={picker.cli !== undefined && modes !== undefined && modes.options.length > 0}
        open={open}
        disabled={picker.locked}
        onToggle={() => {
          if (!open) props.load()
          setOpen(!open)
        }}
      />
      {open
        ? createPortal(
            <Popover
              picker={picker}
              injected={props}
              popoverRef={popoverRef}
              anchorStyle={anchorStyle}
              menuId={menuId}
              dismiss={dismiss}
            />,
            document.body,
          )
        : null}
      <Failure picker={picker} root={rootRef.current} />
    </span>
  )
}
