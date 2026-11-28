/**
 * The picker's button in the composer: the provider's mark, the model, the level in effect,
 * a bolt when fast mode is on, and a warning dot when the CLI runs in a mode without the usual
 * approvals, which the button is now the only place to show.
 * @module dsh-ccgui/client/picker/picker-trigger
 */

import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import { ProviderMark } from '../marks.tsx'
import { BoltIcon, ChevronIcon } from './picker-icons.tsx'
import {
  PICKER_BOLT_CLASS,
  PICKER_CHEVRON_CLASS,
  PICKER_LEVEL_CLASS,
  PICKER_RISK_CLASS,
  PICKER_TRIGGER_CLASS,
} from './picker-styles.ts'

const HINT = '选择模型和思考深度'
const MARK_SIZE = 14

export interface PickerTriggerProps {
  readonly buttonRef: RefObject<HTMLButtonElement>
  readonly anchorStyle: CSSProperties
  readonly provider: string | undefined
  readonly name: string
  /** The name as another plugin draws it, if one does; `name` still labels the button. */
  readonly label?: ReactNode
  /** The open popover's menu that rows from other plugins look the button up by. */
  readonly controls?: string
  readonly level: string | undefined
  readonly fastOn: boolean
  /** The CLI mode's name when it runs without the usual approvals. */
  readonly riskyMode: string | undefined
  /** The CLI reports modes, which the harness's access control then steps aside for. */
  readonly hasModes: boolean
  readonly open: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
}

/**
 * Render the button.
 * @param props - what it shows and what it opens.
 * @returns the button.
 */
export function PickerTrigger(props: PickerTriggerProps): ReactElement {
  const { provider, name, level, fastOn, riskyMode } = props
  const parts = [name, level, fastOn ? '快速模式' : undefined, riskyMode].filter((part) => part !== undefined)
  return (
    <button
      ref={props.buttonRef}
      type="button"
      className={PICKER_TRIGGER_CLASS}
      style={props.anchorStyle}
      aria-haspopup="dialog"
      aria-controls={props.controls}
      aria-expanded={props.open}
      aria-label={`${HINT}，当前 ${parts.join('，')}`}
      title={riskyMode === undefined ? HINT : `${HINT}（当前 CLI 模式：${riskyMode}）`}
      data-cli-modes={props.hasModes ? '' : undefined}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      {provider === undefined ? null : <ProviderMark provider={provider} size={MARK_SIZE} />}
      <span>{props.label ?? name}</span>
      {level === undefined ? null : <span className={PICKER_LEVEL_CLASS}>{level}</span>}
      {fastOn ? (
        <span className={PICKER_BOLT_CLASS}>
          <BoltIcon size={12} on />
        </span>
      ) : null}
      {riskyMode === undefined ? null : <span className={PICKER_RISK_CLASS} />}
      <ChevronIcon direction="down" size={14} className={PICKER_CHEVRON_CLASS} />
    </button>
  )
}
