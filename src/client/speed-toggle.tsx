/// <reference lib="dom" />

/**
 * Codex's fast mode, as one toggle beside the CLI's mode control. It shows only while the CLI
 * reports a fast mode for its active model, and sends back the CLI's own `on` and `off`.
 * @module dsh-ccgui/client/speed-toggle
 */

import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { IconWarningOutlineRegular, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAST_MODE_OFF, FAST_MODE_ON } from '../constants.ts'
import type { ModeApi, ModeReply, NativeModes } from './mode-api.ts'
import { LABEL_CLASS, SPEED_CLASS, SPEED_MARK_CLASS, TRIGGER_CLASS } from './model-menu-styles.ts'

const LABEL = '快速'
/** Codex describes its fast tier as quicker answers for more usage; the title says the same. */
const EFFECT = '响应更快，用量更高'
/** A pick made before the CLI started only takes effect with the next message. */
const PENDING_HINT = '，下一条消息发送时生效'
const UNKNOWN_ERROR_LABEL = '未知错误'
const MARK_SIZE = 14

/** What the mode control hands the toggle. */
export interface SpeedToggleProps {
  readonly api: ModeApi
  readonly provider: string
  /** The fast mode as the CLI reported it. */
  readonly speed: NativeModes
  /** A pick the CLI has not confirmed yet. */
  readonly pending: string | undefined
  readonly locked: boolean
  /** Takes in what the route answered the pick with. */
  readonly accept: (next: ModeReply) => void
}

interface Failure {
  /** Gives each failure a toast of its own. */
  readonly seq: number
  readonly text: string
}

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/** A lightning bolt, drawn here since the host's icon set has none. */
function BoltMark(): ReactElement {
  return (
    <svg
      className={SPEED_MARK_CLASS}
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  )
}

/**
 * Send the opposite of what is shown, and report a refusal.
 * @param props - the route, the CLI and where to put the answer.
 * @param on - whether the toggle shows fast mode on.
 * @returns whether a pick is on its way, the last failure and the click handler.
 */
function useToggle({ api, provider, accept }: SpeedToggleProps, on: boolean) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | undefined>()
  const toggle = (): void => {
    setBusy(true)
    api.write(provider, on ? FAST_MODE_OFF : FAST_MODE_ON, 'speed').then(
      (next) => {
        setBusy(false)
        accept(next)
      },
      (reason: unknown) => {
        setBusy(false)
        setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text: textOf(reason) }))
      },
    )
  }
  return {
    busy,
    failure,
    toggle,
    clearFailure: () => {
      setFailure(undefined)
    },
  }
}

/**
 * Render the toggle. It shows the pending pick if there is one, else what the CLI confirmed.
 * @param props - the fast mode, the route and whether the session is gone.
 * @returns the toggle.
 */
export function SpeedToggle(props: SpeedToggleProps): ReactElement {
  const { speed, locked } = props
  // Turned on and back off before the CLI starts, the pick left waiting changes nothing.
  const pending = props.pending === speed.current ? undefined : props.pending
  const rootRef = useRef<HTMLSpanElement>(null)
  const on = (pending ?? speed.current) === FAST_MODE_ON
  const { busy, failure, toggle, clearFailure } = useToggle(props, on)
  const state = on ? '已开启' : '已关闭'
  return (
    <span ref={rootRef} className={SPEED_CLASS}>
      <button
        type="button"
        className={TRIGGER_CLASS}
        aria-pressed={on}
        aria-label={`快速模式，${state}`}
        title={`快速模式${state}：${EFFECT}${pending === undefined ? '' : PENDING_HINT}`}
        disabled={locked || busy}
        onClick={toggle}
      >
        {busy ? <StateDot state="ongoing" /> : <BoltMark />}
        <span className={LABEL_CLASS}>{LABEL}</span>
      </button>
      {failure !== undefined && (
        <Toast
          key={failure.seq}
          text={`切换快速模式失败：${failure.text || UNKNOWN_ERROR_LABEL}`}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={clearFailure}
        />
      )}
    </span>
  )
}
