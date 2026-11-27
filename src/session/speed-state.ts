/**
 * Codex's fast mode on one CLI session, and the value the user picked. It belongs to the
 * active model: codex-acp reports it only while that model has a fast tier, and drops it
 * from a full report once the model has none.
 * @module dsh-ccgui/session/speed-state
 */

import { FAST_MODE_OFF, FAST_MODE_ON } from '../constants.ts'
import { readModelList, readSpeedList } from '../model-options.ts'
import type { CliSpeedList } from '../model-options.ts'
import { ChoiceState } from './choice-state.ts'
import type { ChoiceKind, ChoiceRefusal } from './choice-state.ts'
import type { ConfigOptions, ModelTarget } from './model-state.ts'

const turned = (value: string): string => (value === FAST_MODE_ON ? '开启' : '关闭')
const NO_FAST_TIER = '当前模型不支持快速模式'

/**
 * A report that carries the model option is a full one, so a fast mode missing from it is
 * gone; a report without the model option may describe only what changed.
 */
export const SPEED_KIND: ChoiceKind = {
  read: (options, known) => readSpeedList(options) ?? (readModelList(options) === undefined ? known : undefined),
  code: 'CLI_SPEED_FAILED',
  words: {
    unread: '还没有读到这个 CLI 的快速模式，请稍后再试。',
    unknown: (value) => `这个 CLI 没有报告快速模式选项 ${value}。`,
    notOffered: NO_FAST_TIER,
    refused: (label, value) => `${label} 无法${turned(value)}快速模式`,
    runsWith: ({ value }) =>
      `这条消息按 CLI 当前的设置（快速模式${turned(value)}）发送，可以用输入框旁的「快速」开关重新切换。`,
  },
}

/** The fast-mode side of one CLI session. */
export class SpeedState extends ChoiceState {
  /**
   * @param known - what the CLI reported ahead of any session, which a probe reads.
   * @param report - passes on the options the CLI answers a change with.
   * @param initial - a value picked before this session existed, sent with its first step.
   */
  constructor(
    known: (() => CliSpeedList | undefined) | undefined,
    report: (options: ConfigOptions) => void,
    initial?: string,
  ) {
    super(SPEED_KIND, known, report, initial)
  }

  /**
   * Apply a pick at the start of a turn; see {@link ChoiceState.settle}. The model has been
   * applied by then, and one without a fast tier runs at normal speed. A pick to turn fast
   * mode on is refused rather than kept: kept, it would turn fast mode on unasked once a later
   * turn moved to a model that has a fast tier.
   * @param where - the session to change.
   * @param signal - cancellation for the wait; a cancelled wait still throws.
   * @returns the refusal to report, or undefined when the pick went through or there was none.
   */
  override async settle(where: ModelTarget, signal: AbortSignal | undefined): Promise<ChoiceRefusal | undefined> {
    if (this.current() !== undefined) return super.settle(where, signal)
    const value = this.dropPick()
    if (value === undefined || value === FAST_MODE_OFF) return undefined
    const refused = SPEED_KIND.words.refused(where.label, value)
    return { value, notice: `（${refused}：${NO_FAST_TIER}。这条消息按普通速度发送。）\n\n` }
  }
}
