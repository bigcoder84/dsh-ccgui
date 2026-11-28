/// <reference lib="dom" />

/**
 * The context meter of a CLI session, below the composer where the harness shows its own for
 * its models: a ring and a percentage, opening a panel with the token counts. It looks and
 * reads like the harness's meter; the figures are the CLI's own, from ACP's `usage_update`,
 * and never pass through the harness's token accounting. The harness's breakdown into system
 * prompt, tools and conversation has no counterpart: a CLI reports only the total.
 * @module dsh-ccgui/client/context-meter
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { isCliRoute } from '../constants.ts'
import type { DirectoryState } from './choices.ts'
import type { ContextApi, ContextUsage } from './context-api.ts'
import {
  METER_BAR_CLASS,
  METER_CLASS,
  METER_FIGURES_CLASS,
  METER_FILL_CLASS,
  METER_HEADER_CLASS,
  METER_HEADLINE_CLASS,
  METER_PANEL_CLASS,
  METER_PERCENT_CLASS,
  METER_SEGMENT_CLASS,
  METER_TRACK_CLASS,
  METER_TRIGGER_CLASS,
} from './context-meter-styles.ts'
import { menuModels } from './menu-models.ts'
import type { SessionFacts } from './session-facts.ts'
import { useRunning } from './session-facts.ts'
import type { Store } from './store.ts'
import { useStore } from './store.ts'

/** The harness's own wording for its meter, so both read the same. */
const USED_LABEL = '上下文已用'
/** How often to ask while a turn runs, so the ring moves with the turn as the harness's does. */
export const CONTEXT_POLL_MS = 3000
/** Ring geometry, as the harness draws it: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** What the composer slot hands the meter. */
export interface ContextMeterInjected {
  /** The session's model directory, which names the provider it is on. */
  directory: Store<DirectoryState>
  session: SessionFacts | undefined
  /** Absent where the harness offers no route. */
  context?: ContextApi
}

/**
 * A token count as the harness's meter writes it: under 1,000 as is, then K or M, with one
 * decimal below 100 of the unit.
 * @param value - token count.
 * @returns the compact count.
 */
export function formatTokens(value: number): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

const percentOf = ({ used, size }: ContextUsage): number => Math.min(100, Math.round((used / size) * 100))

/**
 * Read the CLI's figures when the session is shown, while a turn runs, and once it ends.
 * @param api - the context route, absent when the harness offers none.
 * @param provider - the CLI route the session is on, or undefined off a CLI.
 * @param running - whether a turn is under way.
 * @returns the latest figures, if any.
 */
function useContextReading(
  api: ContextApi | undefined,
  provider: string | undefined,
  running: boolean,
): ContextUsage | undefined {
  const [usage, setUsage] = useState<ContextUsage | undefined>()
  const refresh = useCallback(() => {
    if (api === undefined || provider === undefined) return
    api.read(provider).then(setUsage, () => {
      /* keep the last figures; the meter only reads, and the next ask may succeed */
    })
  }, [api, provider])
  useEffect(() => {
    setUsage(undefined)
    refresh()
  }, [refresh])
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) refresh()
    wasRunning.current = running
    if (!running) return undefined
    const timer = setInterval(refresh, CONTEXT_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [running, refresh])
  return usage
}

/** Close on Escape or a press outside the trigger and the panel, as the harness's panel does. */
function useDismiss(
  open: boolean,
  close: () => void,
  rootRef: RefObject<HTMLSpanElement>,
  panelRef: RefObject<HTMLDivElement>,
): void {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open, close, rootRef, panelRef])
}

interface PanelProps {
  readonly usage: ContextUsage
  readonly percent: number
  readonly anchorStyle: CSSProperties
  readonly panelRef: RefObject<HTMLDivElement>
}

function ContextPanel({ usage, percent, anchorStyle, panelRef }: PanelProps): ReactElement {
  return (
    <div ref={panelRef} className={METER_PANEL_CLASS} style={anchorStyle} role="dialog" aria-label={USED_LABEL}>
      <div className={METER_HEADER_CLASS}>
        <span className={METER_HEADLINE_CLASS}>{USED_LABEL}</span>
        <span className={METER_PERCENT_CLASS}>{`${percent}%`}</span>
        <span className={METER_FIGURES_CLASS}>{`${formatTokens(usage.used)} / ${formatTokens(usage.size)}`}</span>
      </div>
      <div className={METER_BAR_CLASS}>
        {percent > 0 ? <div className={METER_SEGMENT_CLASS} style={{ width: `${percent}%` }} /> : null}
      </div>
    </div>
  )
}

function Ring({ percent }: { readonly percent: number }): ReactElement {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle className={METER_TRACK_CLASS} cx="7" cy="7" r={RADIUS} />
      <circle
        className={METER_FILL_CLASS}
        cx="7"
        cy="7"
        r={RADIUS}
        strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

function Meter({ usage }: { readonly usage: ContextUsage }): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
  }, [])
  useDismiss(open, close, rootRef, panelRef)
  const anchorStyle = {
    '--dsh-cli-context-anchor': `--dsh-cli-context-${useId().replaceAll(':', '')}`,
  } as CSSProperties
  const percent = percentOf(usage)
  const reading = `${USED_LABEL} ${percent}%`
  return (
    <span ref={rootRef} className={METER_CLASS} style={anchorStyle}>
      <Tooltip label={reading} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={METER_TRIGGER_CLASS}
          aria-label={reading}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <Ring percent={percent} />
          <span>{`${percent}%`}</span>
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <ContextPanel usage={usage} percent={percent} anchorStyle={anchorStyle} panelRef={panelRef} />,
          document.body,
        )}
    </span>
  )
}

/**
 * Render the meter for a session on a CLI that has reported its context, or nothing.
 * @param props - what the slot injected.
 * @returns the meter, or null.
 */
export function CliContextMeter({ directory, session, context }: ContextMeterInjected): ReactElement | null {
  const state = useStore(directory)
  const running = useRunning(session)
  const current = menuModels(state).current?.provider
  const provider = isCliRoute(current) ? current : undefined
  const usage = useContextReading(context, provider, running)
  return provider === undefined || usage === undefined ? null : <Meter usage={usage} />
}
