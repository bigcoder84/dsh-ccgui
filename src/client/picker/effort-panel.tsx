/// <reference lib="dom" />

/**
 * The picker's reasoning section, one row tall so it weighs no more than a model row: the
 * fast-mode bolt, the slider whose filled part carries the particle field, and the level's
 * name. A model with a fast tier but no levels keeps the bolt alone. Dragging moves the thumb freely and
 * names the level under it; letting go snaps to the nearest level, which is the only change
 * sent. A click on the track and the arrow keys do the same in one step.
 * @module dsh-ccgui/client/picker/effort-panel
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserClock, startParticles } from './particle-field.ts'
import type { EffortScale, EffortStop } from './picker-model.ts'
import { BoltIcon } from './picker-icons.tsx'
import {
  PICKER_EFFORT_CLASS,
  PICKER_EFFORT_HEAD_CLASS,
  PICKER_EFFORT_NAME_CLASS,
  PICKER_EFFORT_WARN_CLASS,
  PICKER_FILL_CLASS,
  PICKER_ICON_BUTTON_CLASS,
  PICKER_STOP_CLASS,
  PICKER_THUMB_CLASS,
  PICKER_THUMB_SIZE,
  PICKER_TRACK_CLASS,
} from './picker-styles.ts'

const SLIDER_LABEL = '思考深度'
const TOP_WARNING = '用量消耗更快'
const FAST_ON = '快速模式已开启：响应更快，用量更高'
const FAST_OFF = '开启快速模式：响应更快，用量更高'
/**
 * The host's tooltip rather than a native `title`, which shows late and in the system's own
 * style, so hovering an icon button explains it the way the harness's own buttons do. It is
 * portaled: the popover's backdrop filter makes it the box a fixed bubble is placed in, and its
 * overflow would clip the bubble.
 */
const TIP = { side: 'top', delayMs: 300, portal: true } as const
/** The bolt is a narrow glyph, so it is drawn a little larger than the row's text. */
const BOLT_SIZE = 17

/** Names the section of a model with a fast tier but no levels, which shows only the bolt. */
const FAST_ONLY_LABEL = '快速模式'
const PENDING_HINT = '，下一条消息发送时生效'
/** How long a level let go at is held when the harness does not report it. */
const HOLD_MS = 1500
/** Half the thumb, which keeps it inside the track at either end. */
const HALF_THUMB = PICKER_THUMB_SIZE / 2

export interface EffortPanelProps {
  readonly scale: EffortScale
  /**
   * Absent for a model with no fast tier, where the bolt keeps its place but hides. Pending
   * while a pick waits for the CLI to start.
   */
  readonly fast: { readonly on: boolean; readonly pending: boolean } | undefined
  readonly disabled: boolean
  readonly onChoose: (stop: EffortStop) => void
  readonly onFast: () => void
}

/** Where a fraction of the scale sits on the track, thumb included. */
const at = (fraction: number): string => `calc((100% - ${HALF_THUMB * 2}px) * ${fraction} + ${HALF_THUMB}px)`
const fractionOf = (index: number, count: number): number => (count <= 1 ? 0 : Math.max(0, index) / (count - 1))

/** The fraction of the track under the pointer. */
function pointerFraction(track: HTMLElement, clientX: number): number {
  const box = track.getBoundingClientRect()
  const usable = box.width - HALF_THUMB * 2
  return usable <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - box.left - HALF_THUMB) / usable))
}

/** Run the particle field in the filled part while the panel is shown. */
function useParticles(fraction: number, top: boolean) {
  const fillRef = useRef<HTMLDivElement>(null)
  const level = useRef({ intensity: fraction, top })
  level.current = { intensity: fraction, top }
  useEffect(() => {
    const fill = fillRef.current
    if (fill === null) return undefined
    return startParticles(fill, () => level.current, browserClock())
  }, [])
  return fillRef
}

/** Arrow keys step one level; Home and End go to either end. */
function keyTarget(key: string, index: number, count: number): number | undefined {
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(count - 1, index + 1)
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, index - 1)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return undefined
}

/**
 * The level just let go at, held until the harness reports it, so the thumb does not slide
 * back to the old level for a frame. A change the harness refuses lets go after a while.
 */
function useHeld(index: number) {
  const [held, setHeld] = useState<number | undefined>()
  useEffect(() => {
    setHeld(undefined)
  }, [index])
  useEffect(() => {
    if (held === undefined) return undefined
    const timer = setTimeout(() => {
      setHeld(undefined)
    }, HOLD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [held])
  return { held, setHeld }
}

function useSlider({ scale, disabled, onChoose }: Pick<EffortPanelProps, 'scale' | 'disabled' | 'onChoose'>) {
  const [drag, setDrag] = useState<number | undefined>()
  const { held, setHeld } = useHeld(scale.index)
  const count = scale.stops.length
  const nearest = (fraction: number): number => Math.round(fraction * (count - 1))
  const commit = (index: number): void => {
    const stop = scale.stops[index]
    if (stop === undefined || index === scale.index) return
    setHeld(index)
    onChoose(stop)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || count === 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(pointerFraction(event.currentTarget, event.clientX))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag !== undefined) setDrag(pointerFraction(event.currentTarget, event.clientX))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag === undefined) return
    setDrag(undefined)
    commit(nearest(pointerFraction(event.currentTarget, event.clientX)))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = disabled ? undefined : keyTarget(event.key, settled, count)
    if (target === undefined) return
    event.preventDefault()
    commit(target)
  }
  const settled = held ?? scale.index
  const shown = drag === undefined ? settled : nearest(drag)
  const fraction = drag ?? fractionOf(settled, count)
  return { drag, shown, fraction, handlers: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } }
}

function Track({ panel, slider }: { readonly panel: EffortPanelProps; readonly slider: ReturnType<typeof useSlider> }) {
  const { scale, disabled } = panel
  const fillRef = useParticles(slider.fraction, scale.top)
  const count = scale.stops.length
  return (
    <div
      className={PICKER_TRACK_CLASS}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={SLIDER_LABEL}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={Math.max(0, slider.shown)}
      aria-valuetext={scale.stops[slider.shown]?.label}
      aria-disabled={disabled}
      data-dragging={slider.drag === undefined ? undefined : ''}
      {...slider.handlers}
    >
      {scale.stops.map((stop, index) =>
        index <= slider.shown ? null : (
          <span key={stop.key} className={PICKER_STOP_CLASS} style={{ left: at(fractionOf(index, count)) }} />
        ),
      )}
      <div
        ref={fillRef}
        className={PICKER_FILL_CLASS}
        data-top={scale.top}
        style={{ width: `calc(${at(slider.fraction)} + ${HALF_THUMB}px)` }}
      />
      <span className={PICKER_THUMB_CLASS} style={{ left: at(slider.fraction) }} />
    </div>
  )
}

/**
 * Render the reasoning section of the picker.
 * @param props - the scale, the fast mode and what to call on a change.
 * @returns the section.
 */
export function EffortPanel(props: EffortPanelProps): ReactElement {
  const { scale, fast, disabled } = props
  const slider = useSlider(props)
  const levels = scale.stops.length > 0
  const label = levels ? (scale.stops[slider.shown]?.label ?? '') : FAST_ONLY_LABEL
  const fastLabel = fast?.on === true ? FAST_ON : FAST_OFF
  return (
    <div className={PICKER_EFFORT_CLASS}>
      <div className={PICKER_EFFORT_HEAD_CLASS}>
        <Tooltip
          label={fast?.pending === true ? `${fastLabel}${PENDING_HINT}` : fastLabel}
          {...TIP}
          disabled={fast === undefined}
        >
          <button
            type="button"
            className={PICKER_ICON_BUTTON_CLASS}
            hidden={fast === undefined}
            aria-pressed={fast?.on ?? false}
            aria-label={fastLabel}
            disabled={disabled}
            onClick={props.onFast}
          >
            <BoltIcon size={BOLT_SIZE} on={fast?.on ?? false} />
          </button>
        </Tooltip>
        {levels ? <Track panel={props} slider={slider} /> : null}
        <span key={label} className={PICKER_EFFORT_NAME_CLASS} data-top={scale.top} data-bump="">
          {label}
        </span>
      </div>
      {scale.top ? <div className={PICKER_EFFORT_WARN_CLASS}>{TOP_WARNING}</div> : null}
    </div>
  )
}
