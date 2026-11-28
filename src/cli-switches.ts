/**
 * Which configured CLIs are switched on. A CLI switched off is not registered as a provider at
 * all, so it leaves every list the harness shows, not only the composer's switcher. The choice
 * is kept in the plugin's home and read before the providers are registered, so a CLI that is
 * off never shows up for a moment at startup.
 * @module dsh-ccgui/cli-switches
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { cliRoute } from './constants.ts'

/** Bumped when the layout changes; a file of another version is ignored, not misread. */
const SWITCHES_VERSION = 1
/** CodeBuddy is bundled but not yet verified with a real account, so it starts off. */
const OFF_BY_DEFAULT: readonly string[] = [cliRoute('codebuddy')]
const FAILED = 'CLI_SWITCH_FAILED'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // A torn or hand-edited file costs the user their switches, not the plugin's start.
    return undefined
  }
}

/**
 * Read a saved file.
 * @param text - the file's contents, or undefined when there is no file.
 * @returns the CLIs switched off, or undefined when nothing trustworthy was saved.
 */
export function parseSwitches(text: string | undefined): readonly string[] | undefined {
  const data = text === undefined ? undefined : parseJson(text)
  if (!isObject(data) || data.version !== SWITCHES_VERSION || !Array.isArray(data.disabled)) return undefined
  return (data.disabled as readonly unknown[]).filter((id): id is string => typeof id === 'string')
}

/**
 * Write the file's contents.
 * @param disabled - the CLIs switched off.
 * @returns the text to save.
 */
export const formatSwitches = (disabled: readonly string[]): string =>
  JSON.stringify({ version: SWITCHES_VERSION, disabled })

/** The switches of every configured CLI. */
export class CliSwitches {
  private disabled: ReadonlySet<string>
  private saved: boolean

  /**
   * @param providers - every configured CLI route, in configuration order.
   * @param stored - what was saved, or undefined when nothing was.
   * @param persist - keeps the CLIs switched off for the next run.
   */
  constructor(
    private readonly providers: readonly string[],
    stored: readonly string[] | undefined,
    private readonly persist: (disabled: readonly string[]) => Promise<void>,
  ) {
    this.disabled = new Set(stored ?? OFF_BY_DEFAULT)
    this.saved = stored !== undefined
  }

  /** Whether a choice was ever saved; before that, the defaults stand. */
  get everSaved(): boolean {
    return this.saved
  }

  /** Every configured CLI route, in configuration order. */
  configured(): readonly string[] {
    return this.providers
  }

  /** The CLI routes switched on, in configuration order. */
  enabled(): readonly string[] {
    return this.providers.filter((provider) => !this.disabled.has(provider))
  }

  /**
   * @param provider - a CLI route.
   * @returns whether it is switched on.
   */
  isEnabled(provider: string): boolean {
    return this.providers.includes(provider) && !this.disabled.has(provider)
  }

  /**
   * Switch one CLI on or off, saving the choice before it takes effect.
   * @param provider - a configured CLI route.
   * @param enabled - whether it should be on.
   * @returns whether anything changed.
   * @throws when the route is not a configured CLI, or the choice could not be saved.
   */
  async set(provider: string, enabled: boolean): Promise<boolean> {
    if (!this.providers.includes(provider)) throw new LlmError(`未知的 CLI：${provider}`, FAILED)
    if (this.disabled.has(provider) !== enabled) return false
    const next = enabled
      ? [...this.disabled].filter((candidate) => candidate !== provider)
      : [...this.disabled, provider]
    await this.save(next)
    return true
  }

  /**
   * Take over a list a browser kept before the switches moved here. Only before anything
   * was saved: afterwards the saved choice is the user's, and an old list must not undo it.
   * @param disabled - the CLIs that list left out.
   * @returns whether the list was taken.
   */
  async adopt(disabled: readonly string[]): Promise<boolean> {
    if (this.saved) return false
    await this.save(disabled.filter((provider) => this.providers.includes(provider)))
    return true
  }

  /** Kept in configuration order, so the file does not churn with the order of clicks. */
  private async save(disabled: readonly string[]): Promise<void> {
    const ordered = this.providers.filter((provider) => disabled.includes(provider))
    await this.persist(ordered)
    this.disabled = new Set(ordered)
    this.saved = true
  }
}
