/**
 * Where the AI commit message's model and prompt come from: the settings page first, then the
 * plugin config, then the harness's default model. One object, so the generate route and the
 * settings page always agree on what "the model" is.
 * @module dsh-ccgui/commit/commit-service
 */

import { CommitSuggestError } from './commit-suggest.ts'
import type { SuggestRoute } from './commit-suggest.ts'
import { asCommitSettings, commitSettingsView } from './commit-settings.ts'
import type { CommitSettingsStore, CommitSettingsView, ModelDirectory } from './commit-settings.ts'

const INVALID_SETTINGS = '提交信息设置无效：模型不能是 CLI，提示词不能超过 8000 字'

export interface CommitServiceDeps {
  readonly store: CommitSettingsStore
  readonly directory: () => ModelDirectory | undefined
  /** The plugin config's route, then the harness default; rejects when neither is usable. */
  readonly fallbackRoute: () => Promise<SuggestRoute>
  /** The plugin config's prompt; empty means the built-in one. */
  readonly configPrompt: () => string
}

export interface CommitService {
  route(): Promise<SuggestRoute>
  prompt(): string
  view(): Promise<CommitSettingsView>
  /** Rejects with a message ready to show when the settings are not valid. */
  save(value: unknown): Promise<CommitSettingsView>
}

/**
 * Join the saved settings to the plugin config.
 * @param deps - the store, the model directory and the config's fallbacks.
 * @returns the service.
 */
export function createCommitService(deps: CommitServiceDeps): CommitService {
  const view = (): Promise<CommitSettingsView> =>
    commitSettingsView(deps.store.current(), deps.directory(), deps.fallbackRoute)
  return {
    route: async () => deps.store.current().model ?? deps.fallbackRoute(),
    prompt: () => {
      const saved = deps.store.current().prompt
      return saved.trim() === '' ? deps.configPrompt() : saved
    },
    view,
    save: async (value) => {
      const settings = asCommitSettings(value)
      if (settings === undefined) throw new CommitSuggestError(INVALID_SETTINGS)
      await deps.store.save(settings)
      return view()
    },
  }
}
