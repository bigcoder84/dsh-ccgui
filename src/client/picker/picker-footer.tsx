/**
 * The picker's last row, the one setting each provider has of its own: a CLI's own mode,
 * opening in place into the modes the CLI reported, or the harness's agent teamwork switch.
 * Teamwork is read from the session's `agentTeam` projection and written through the
 * harness's `agentTeams` remote, as the harness's own menu does; turning it off mid-
 * conversation asks first, with the harness's own wording.
 * @module dsh-ccgui/client/picker/picker-footer
 */

import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativeModes } from '../mode-api.ts'
import { CheckIcon, ChevronIcon } from './picker-icons.tsx'
import {
  PICKER_FOOTER_CLASS,
  PICKER_FOOTER_ROW_CLASS,
  PICKER_FOOTER_VALUE_CLASS,
  PICKER_OPTION_CLASS,
} from './picker-styles.ts'

const MODE_LABEL = 'CLI 模式'
const PENDING_HINT = '，下一条消息发送时生效'
const TEAM_LABEL = '智能体团队协作'
const TEAM_HINT = '通过共享任务板协调多个智能体的分工与进度，复杂任务表现更佳，token 开销也相应更高。'
const CONFIRM_TITLE = '确认停用智能体团队协作？'
const CONFIRM_DESCRIPTION = '对话过程中停用智能体团队协作，将停止共享任务工具和团队协调指令。'
const CONFIRM_WARNING = '停用后可能影响缓存复用、增加后续 token 用量与开销，并影响当前任务的协作效果。'

export interface CliModeRowProps {
  readonly modes: NativeModes
  /** A mode picked before the CLI started, not taken yet. */
  readonly pending: string | undefined
  readonly disabled: boolean
  readonly onChoose: (mode: string) => void
}

/**
 * The CLI's own mode, opening in place into the modes the CLI reported.
 * @param props - the modes, a pick not taken yet and what to call on a choice.
 * @returns the row and, while open, the modes under it.
 */
export function CliModeRow({ modes, pending, disabled, onChoose }: CliModeRowProps): ReactElement {
  const [open, setOpen] = useState(false)
  const shown = pending ?? modes.current
  const name = modes.options.find((option) => option.value === shown)?.name ?? shown
  return (
    <div className={PICKER_FOOTER_CLASS}>
      <button
        type="button"
        className={PICKER_FOOTER_ROW_CLASS}
        aria-expanded={open}
        title={pending === undefined ? undefined : `${MODE_LABEL}：${name}${PENDING_HINT}`}
        disabled={disabled}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span>{MODE_LABEL}</span>
        <span className={PICKER_FOOTER_VALUE_CLASS}>
          {name}
          <ChevronIcon direction="right" size={12} />
        </span>
      </button>
      {open ? (
        <div role="menu" aria-label={MODE_LABEL}>
          {modes.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === shown}
              className={PICKER_OPTION_CLASS}
              onClick={() => {
                setOpen(false)
                onChoose(option.value)
              }}
            >
              <CheckIcon size={12} />
              {option.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface TeamRowProps {
  readonly enabled: boolean
  /** The conversation has already run with the current model, so turning it off asks first. */
  readonly confirmOff: boolean
  readonly disabled: boolean
  readonly onSet: (enabled: boolean) => void
}

/**
 * The harness's agent teamwork switch, for a session the harness runs.
 * @param props - whether it is on, whether turning it off asks, and what to call.
 * @returns the row, and its confirmation while asking.
 */
export function TeamRow({ enabled, confirmOff, disabled, onSet }: TeamRowProps): ReactElement {
  const [asking, setAsking] = useState(false)
  const close = (): void => {
    setAsking(false)
  }
  return (
    <div className={PICKER_FOOTER_CLASS}>
      <div className={PICKER_FOOTER_ROW_CLASS} title={TEAM_HINT}>
        <span>{TEAM_LABEL}</span>
        <Switch
          checked={enabled}
          label={TEAM_LABEL}
          disabled={disabled}
          onChange={(next) => {
            if (!next && confirmOff) setAsking(true)
            else onSet(next)
          }}
        />
      </div>
      <Modal
        open={asking}
        onClose={close}
        title={CONFIRM_TITLE}
        closeLabel="关闭"
        description={CONFIRM_DESCRIPTION}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                close()
                onSet(false)
              }}
            >
              确认停用
            </Button>
          </>
        }
      >
        {CONFIRM_WARNING}
      </Modal>
    </div>
  )
}
