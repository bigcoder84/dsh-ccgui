/**
 * The CLI settings the composer changes from outside a turn: the CLI's native mode and its
 * fast mode. Each keeps the CLI's own ids. A pick made before the CLI started is held here and
 * sent with the first step, after the model, since a model switch changes which settings exist.
 * @module dsh-ccgui/session/native-settings
 */

import type { CliChoiceList, CliModelList } from '../model-options.ts'
import type { ChoiceState } from './choice-state.ts'
import { ModeState } from './mode-state.ts'
import type { ConfigOptions, ModelTarget } from './model-state.ts'
import { SpeedState } from './speed-state.ts'

/** What a session starts its settings from. */
export interface SettingsStart {
  /** What the CLI reported ahead of any session, which a probe reads. */
  readonly knownModels?: () => CliModelList | undefined
  /** A native mode picked before this session existed. */
  readonly initialMode?: string
  /** A fast mode picked before this session existed. */
  readonly initialSpeed?: string
  /** Told when the CLI would not take the mode picked before it started. */
  readonly onModeRefused?: (mode: string) => void
  /** Told when the CLI would not take the fast mode picked before it started. */
  readonly onSpeedRefused?: (value: string) => void
}

/** The mode and fast-mode sides of one CLI session. */
export class NativeSettings {
  readonly mode: ModeState
  readonly speed: SpeedState

  /**
   * @param start - what the session starts from.
   * @param report - passes on the options the CLI answers a change with.
   */
  constructor(
    private readonly start: SettingsStart,
    report: (options: ConfigOptions) => void,
  ) {
    this.mode = new ModeState(() => start.knownModels?.()?.modes, report, start.initialMode)
    this.speed = new SpeedState(() => start.knownModels?.()?.speed, report, start.initialSpeed)
  }

  /**
   * Take in a report of the CLI's options.
   * @param options - the options the CLI reported.
   */
  observe(options: ConfigOptions): void {
    this.mode.observe(options)
    this.speed.observe(options)
  }

  /**
   * Pick a value for one setting. Before the CLI has started there is nothing to change, so
   * the pick waits for the first step.
   * @param state - the setting to change.
   * @param value - a value exactly as the CLI reported it.
   * @param where - the started session, or undefined before the CLI has started.
   * @param signal - cancellation for the wait.
   * @returns the setting as the CLI now reports it, or the known one when it has not started.
   * @throws when the CLI never offered that value, or refuses the change.
   */
  async change(
    state: ChoiceState,
    value: string,
    where: ModelTarget | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CliChoiceList | undefined> {
    state.choose(value)
    return where === undefined ? state.current() : state.apply(where, signal)
  }

  /**
   * Send the picks still waiting, at the start of a turn. A refusal does not cost the user
   * their message: it becomes a notice, and the pick is dropped so no later session retries it.
   * @param where - the session to change.
   * @param signal - cancellation for the wait; a cancelled wait still throws.
   * @returns the notices to show ahead of the reply.
   */
  async settle(where: ModelTarget, signal: AbortSignal | undefined): Promise<readonly string[]> {
    const mode = await this.mode.settle(where, signal)
    if (mode !== undefined) this.start.onModeRefused?.(mode.value)
    const speed = await this.speed.settle(where, signal)
    if (speed !== undefined) this.start.onSpeedRefused?.(speed.value)
    return [mode?.notice, speed?.notice].filter((notice) => notice !== undefined)
  }
}
