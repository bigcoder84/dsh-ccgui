/**
 * The AI commit message's settings, chosen on the plugin's settings page and kept in a small
 * file in the plugin's home: the model (null follows the plugin config, then the harness's
 * default) and a custom prompt (empty uses the built-in one). Also what that page shows:
 * every model the harness lists outside the CLIs, and the model that would be used.
 * @module dsh-ccgui/commit/commit-settings
 */

import { isCliRoute } from '../constants.ts'
import { DEFAULT_COMMIT_PROMPT } from './commit-material.ts'
import type { SuggestRoute } from './commit-suggest.ts'

/** The longest custom prompt saved; a prompt is guidance, not material. */
export const MAX_COMMIT_PROMPT = 8000
/** One provider's model list may hang on a slow endpoint; the page shows the rest without it. */
const LIST_TIMEOUT_MS = 10_000

export interface CommitSettings {
  readonly model: SuggestRoute | null
  readonly prompt: string
}

export const NO_COMMIT_SETTINGS: CommitSettings = { model: null, prompt: '' }

/** One model the settings page offers. */
interface ListedModel {
  readonly provider: string
  readonly providerName: string
  readonly id: string
  readonly name: string
}

export interface CommitSettingsView extends CommitSettings {
  readonly defaultPrompt: string
  /** The model used when none is chosen here, or null when there is none to fall back on. */
  readonly fallback: SuggestRoute | null
  readonly models: readonly ListedModel[]
  /** Providers whose models could not be listed, with why. */
  readonly errors: readonly string[]
}

const isRoute = (value: unknown): value is SuggestRoute =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).provider === 'string' &&
  (value as Record<string, unknown>).provider !== '' &&
  typeof (value as Record<string, unknown>).model === 'string' &&
  (value as Record<string, unknown>).model !== ''

/**
 * Check settings from the page or the file. A CLI is never accepted: it would hand the call
 * back to this plugin and into the user's CLI conversation.
 * @param value - parsed JSON.
 * @returns the settings, or undefined when they are not valid.
 */
export function asCommitSettings(value: unknown): CommitSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { model, prompt } = value as Record<string, unknown>
  if (model !== null && (!isRoute(model) || isCliRoute(model.provider))) return undefined
  if (typeof prompt !== 'string' || prompt.length > MAX_COMMIT_PROMPT || prompt.includes('\0')) return undefined
  return { model: model === null ? null : { provider: model.provider, model: model.model }, prompt }
}

/**
 * Read the saved file's text.
 * @param text - the file, or undefined when there is none yet.
 * @returns the settings; anything unreadable counts as nothing saved.
 */
export function parseCommitSettings(text: string | undefined): CommitSettings {
  if (text === undefined) return NO_COMMIT_SETTINGS
  try {
    return asCommitSettings(JSON.parse(text)) ?? NO_COMMIT_SETTINGS
  } catch (_error: unknown) {
    // A hand-edited file that is not JSON: the page shows the defaults and saving repairs it.
    return NO_COMMIT_SETTINGS
  }
}

/** The settings, held in memory and written through on every save. */
export class CommitSettingsStore {
  constructor(
    private settings: CommitSettings,
    private readonly write: (text: string) => Promise<void>,
  ) {}

  current(): CommitSettings {
    return this.settings
  }

  async save(next: CommitSettings): Promise<void> {
    await this.write(`${JSON.stringify(next, null, 2)}\n`)
    this.settings = next
  }
}

/** The part of the harness's `llm` service the settings page reads. */
export interface ModelDirectory {
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  listModels(provider: string): Promise<readonly { readonly id: string; readonly name: string }[]>
}

async function providerModels(
  directory: ModelDirectory,
  provider: { readonly id: string; readonly name: string },
): Promise<{ models: ListedModel[] } | { error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('读取超时'))
      }, LIST_TIMEOUT_MS)
    })
    const models = await Promise.race([directory.listModels(provider.id), timeout])
    return {
      models: models.map((model) => ({
        provider: provider.id,
        providerName: provider.name,
        id: model.id,
        name: model.name,
      })),
    }
  } catch (error: unknown) {
    return { error: `${provider.name}：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * What the settings page shows.
 * @param saved - the saved settings.
 * @param directory - the harness's model service, when it offers one.
 * @param fallback - resolves the model used when none is chosen; rejects when there is none.
 * @returns the saved settings, the built-in prompt, the fallback and every listed non-CLI model.
 */
export async function commitSettingsView(
  saved: CommitSettings,
  directory: ModelDirectory | undefined,
  fallback: () => Promise<SuggestRoute>,
): Promise<CommitSettingsView> {
  const resolved = await fallback().then(
    (route) => route,
    () => null,
  )
  const base = { ...saved, defaultPrompt: DEFAULT_COMMIT_PROMPT, fallback: resolved }
  if (directory === undefined) return { ...base, models: [], errors: ['当前 DSH 没有提供模型服务'] }
  const providers = directory.listProviders().filter((provider) => !isCliRoute(provider.id))
  const listed = await Promise.all(providers.map((provider) => providerModels(directory, provider)))
  return {
    ...base,
    models: listed.flatMap((entry) => ('models' in entry ? entry.models : [])),
    errors: listed.flatMap((entry) => ('error' in entry ? [entry.error] : [])),
  }
}
