/**
 * The modes a CLI reports for itself, and the one the user picked. The vocabulary is the
 * CLI's own: ids and names are kept and sent back exactly as reported, never translated
 * into a harness preset.
 * @module dsh-ccgui/session/mode-state
 */

import { readModeList } from '../model-options.ts'
import type { CliModeList } from '../model-options.ts'
import { ChoiceState } from './choice-state.ts'
import type { ChoiceKind, ChoiceRefusal } from './choice-state.ts'
import type { ConfigOptions, ModelTarget } from './model-state.ts'

/** A pick the CLI would not take at the start of a turn, and what to tell the user. */
export interface ModeRefusal extends ChoiceRefusal {
  /** The mode id that was dropped. */
  readonly mode: string
}

/** A report without modes keeps what is known, as some CLIs report only the option that changed. */
export const MODE_KIND: ChoiceKind = {
  read: (options, known) => readModeList(options) ?? known,
  code: 'CLI_MODE_FAILED',
  words: {
    unread: '还没有读到这个 CLI 的模式列表，请稍后再试。',
    unknown: (mode) => `这个 CLI 没有报告模式 ${mode}。`,
    notOffered: 'CLI 没有报告这个模式',
    refused: (label, mode) => `${label} 无法切换到模式 ${mode}`,
    runsWith: ({ name }) => `这条消息按 CLI 当前的模式「${name}」发送，可以在 CLI 模式菜单里重新选择。`,
  },
}

/** The mode side of one CLI session. */
export class ModeState extends ChoiceState {
  /**
   * @param known - what the CLI reported ahead of any session, which a probe reads.
   * @param report - passes on the options the CLI answers a change with, which describe
   *   more than the mode; the session then updates everything from that one report.
   * @param initial - a mode picked before this session existed, sent with its first step.
   */
  constructor(
    known: (() => CliModeList | undefined) | undefined,
    report: (options: ConfigOptions) => void,
    initial?: string,
  ) {
    super(MODE_KIND, known, report, initial)
  }

  /**
   * Apply a pick at the start of a turn; see {@link ChoiceState.settle}.
   * @param where - the session to change.
   * @param signal - cancellation for the wait; a cancelled wait still throws.
   * @returns the refusal to report, or undefined when the pick went through or there was none.
   */
  override async settle(where: ModelTarget, signal: AbortSignal | undefined): Promise<ModeRefusal | undefined> {
    const refusal = await super.settle(where, signal)
    return refusal === undefined ? undefined : { ...refusal, mode: refusal.value }
  }
}
