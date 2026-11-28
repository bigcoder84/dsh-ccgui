/**
 * The browser side of the AI commit message settings: read what is saved with every model the
 * harness lists, and save a new choice. The Node half checks what is saved.
 * @module dsh-ccgui/client/commit-settings-api
 */

import { COMMIT_MESSAGE_ROUTE } from '../constants.ts'
import { postJson } from './git-post.ts'
import type { Fetch } from './git-post.ts'

export interface CommitModelRoute {
  readonly provider: string
  readonly model: string
}

export interface CommitSettingsValue {
  /** Null follows the plugin config, then the harness's default model. */
  readonly model: CommitModelRoute | null
  /** Empty uses the built-in prompt. */
  readonly prompt: string
}

/** One model the page offers. */
interface CommitModelOption {
  readonly provider: string
  readonly providerName: string
  readonly id: string
  readonly name: string
}

export interface CommitSettingsView extends CommitSettingsValue {
  readonly defaultPrompt: string
  /** The model used when none is chosen here, or null when there is none. */
  readonly fallback: CommitModelRoute | null
  readonly models: readonly CommitModelOption[]
  readonly errors: readonly string[]
}

export interface CommitSettingsApi {
  read(): Promise<CommitSettingsView>
  save(value: CommitSettingsValue): Promise<CommitSettingsView>
}

/**
 * Bind the settings routes.
 * @param fetchFn - the fetch to use.
 * @returns the reader and the saver; each rejects with a message ready to show.
 */
export function createCommitSettingsApi(fetchFn: Fetch): CommitSettingsApi {
  return {
    read: () => postJson(fetchFn, `${COMMIT_MESSAGE_ROUTE}/settings`, {}),
    save: (value) => postJson(fetchFn, `${COMMIT_MESSAGE_ROUTE}/save`, value),
  }
}
