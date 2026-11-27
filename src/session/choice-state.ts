/**
 * A CLI setting the composer changes from outside a turn, such as the CLI's native mode or
 * its fast mode, and the value the user picked. Ids and names stay the CLI's own and are sent
 * back exactly as reported. A pick made before the CLI started waits for the first step.
 * @module dsh-ccgui/session/choice-state
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { abortable } from '../abortable.ts'
import type { CliChoiceList, CliModelOption } from '../model-options.ts'
import type { ConfigOptions, ModelTarget } from './model-state.ts'
import { errorMessage } from './outcomes.ts'

/** What the user is told about one setting. */
interface ChoiceWords {
  /** No list is known yet. */
  readonly unread: string
  /** The CLI never reported this value. */
  unknown(value: string): string
  /** Why a pick made before the CLI started fails once the CLI does not offer it. */
  readonly notOffered: string
  /** The CLI would not take this value; the reason follows after a colon. */
  refused(label: string, value: string): string
  /** What a message runs with instead, and where to pick again. */
  runsWith(current: CliModelOption): string
}

/** What sets one setting apart from another. */
export interface ChoiceKind {
  /**
   * Read the setting out of a report.
   * @param options - what the CLI reported.
   * @param known - what was known before; some CLIs report only the option that changed.
   * @returns the setting as it stands after the report.
   */
  read(options: ConfigOptions, known: CliChoiceList | undefined): CliChoiceList | undefined
  /** Code of the {@link LlmError} a failed change throws. */
  readonly code: string
  readonly words: ChoiceWords
}

/** A pick the CLI would not take at the start of a turn, and what to tell the user. */
export interface ChoiceRefusal {
  /** The value that was dropped. */
  readonly value: string
  /** Shown ahead of the reply, so the user knows what the message ran with. */
  readonly notice: string
}

/**
 * Check a pick against the list the CLI last reported: a value it never offered is refused
 * rather than sent as an unknown value.
 * @param kind - the setting.
 * @param list - what the CLI reported, if anything yet.
 * @param value - the value picked.
 * @throws when no list is known yet, or the list does not contain that value.
 */
export function assertOffered(kind: ChoiceKind, list: CliChoiceList | undefined, value: string): void {
  if (list === undefined) throw new LlmError(kind.words.unread, kind.code)
  if (!list.options.some((option) => option.value === value)) throw new LlmError(kind.words.unknown(value), kind.code)
}

/** One setting of one CLI session. */
export class ChoiceState {
  /** The setting as last reported. */
  private list: CliChoiceList | undefined
  /** The value the user picked, until the CLI confirms it. */
  private wanted: string | undefined

  /**
   * @param kind - which setting this is.
   * @param known - what the CLI reported ahead of any session, which a probe reads.
   * @param report - passes on the options the CLI answers a change with, which describe
   *   more than this setting; the session then updates everything from that one report.
   * @param initial - a value picked before this session existed, sent with its first step.
   */
  constructor(
    private readonly kind: ChoiceKind,
    known: (() => CliChoiceList | undefined) | undefined,
    private readonly report: (options: ConfigOptions) => void,
    initial?: string,
  ) {
    this.list = known?.()
    this.wanted = initial
  }

  /**
   * The setting as the CLI reports it, in its own ids and names.
   * @returns the list, or undefined before the CLI has reported one.
   */
  current(): CliChoiceList | undefined {
    return this.list
  }

  /** The value picked but not yet confirmed by the CLI, if any. */
  get pending(): string | undefined {
    return this.wanted
  }

  /**
   * Give up the pick without sending it.
   * @returns the value that was waiting, if any.
   */
  protected dropPick(): string | undefined {
    const { wanted } = this
    this.wanted = undefined
    return wanted
  }

  /**
   * A report of the CLI's options. The confirmed value clears a pending pick.
   * @param options - the options the CLI answered with.
   * @returns the setting as known after this report.
   */
  observe(options: ConfigOptions): CliChoiceList | undefined {
    if (options == null) return this.list
    this.list = this.kind.read(options, this.list)
    if (this.list?.current === this.wanted) this.wanted = undefined
    return this.list
  }

  /**
   * Ask for one of the values the CLI reported.
   * @param value - a value exactly as the CLI reported it.
   * @throws when no list is known yet, or the list does not contain that value.
   */
  choose(value: string): void {
    assertOffered(this.kind, this.list, value)
    this.wanted = value
  }

  /**
   * Send the pick, unless the CLI is already on it. A refused pick is dropped, so it never
   * comes back with a later step; only a cancelled wait keeps it, as nothing was refused.
   * @param where - the session to change.
   * @param signal - cancellation for the wait.
   * @returns the setting as the CLI confirmed it.
   * @throws when the started CLI does not offer that value, or refuses the change.
   */
  async apply(where: ModelTarget, signal: AbortSignal | undefined): Promise<CliChoiceList | undefined> {
    const { list, wanted, kind } = this
    if (list === undefined || wanted === undefined) return list
    if (list.current === wanted) {
      this.wanted = undefined
      return list
    }
    // A pick made before the CLI started was checked against the catalog, not this process.
    if (!list.options.some((option) => option.value === wanted)) {
      this.wanted = undefined
      throw new LlmError(`${kind.words.refused(where.label, wanted)}：${kind.words.notOffered}`, kind.code)
    }
    try {
      const options = await abortable(
        where.transport.setConfigOption(where.acpSessionId, list.configId, wanted),
        signal,
      )
      this.report(options)
      const confirmed = kind.read(options, undefined)?.current
      if (confirmed !== undefined && confirmed !== wanted) throw new Error(`CLI 仍在使用 ${confirmed}`)
      this.wanted = undefined
      return this.list ?? list
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      this.wanted = undefined
      throw new LlmError(`${kind.words.refused(where.label, wanted)}：${errorMessage(error)}`, kind.code, {
        cause: error,
      })
    }
  }

  /**
   * Apply a pick at the start of a turn. The user is sending a message, and a value the CLI
   * will not take must not cost them that message, so a refusal comes back as a notice.
   * @param where - the session to change.
   * @param signal - cancellation for the wait; a cancelled wait still throws.
   * @returns the refusal to report, or undefined when the pick went through or there was none.
   */
  async settle(where: ModelTarget, signal: AbortSignal | undefined): Promise<ChoiceRefusal | undefined> {
    const { list, wanted } = this
    if (list === undefined || wanted === undefined) return undefined
    try {
      await this.apply(where, signal)
      return undefined
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      // The CLI may have answered the refusal with its options, so read where it is now.
      const now = this.list ?? list
      const current = now.options.find((option) => option.value === now.current) ?? {
        value: now.current,
        name: now.current,
      }
      return { value: wanted, notice: `（${errorMessage(error)}。${this.kind.words.runsWith(current)}）\n\n` }
    }
  }
}
