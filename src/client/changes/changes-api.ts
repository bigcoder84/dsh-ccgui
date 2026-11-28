/**
 * The 变更 panel's operations, each a POST to the git routes (see git-post.ts) with the
 * session's working directory, and the AI commit message route.
 * @module dsh-ccgui/client/changes/changes-api
 */

import { COMMIT_MESSAGE_ROUTE } from '../../constants.ts'
import { gitPost, postJson } from '../git-post.ts'
import type { Fetch } from '../git-post.ts'
import type { BranchList, FileDiff, StatusAnswer } from './changes-model.ts'

export type { Fetch } from '../git-post.ts'

/** A commit message a harness model wrote for the selected files. */
interface CommitSuggestion {
  readonly message: string
  readonly model: { readonly provider: string; readonly model: string }
  /** How many selected files there were, and how many of them the model saw a diff for. */
  readonly coverage: { readonly files: number; readonly diffFiles: number; readonly truncated: boolean }
  readonly warning?: string
}

/** Which version of a file a diff compares. */
export type DiffSide = 'staged' | 'unstaged' | 'untracked'

export interface GitApi {
  status(): Promise<StatusAnswer>
  branches(): Promise<BranchList | { readonly repo: false }>
  diff(target: { path: string; side: DiffSide; origPath?: string | undefined }): Promise<FileDiff>
  stage(paths: readonly string[]): Promise<StatusAnswer>
  unstage(paths: readonly string[]): Promise<StatusAnswer>
  discard(target: { tracked: readonly string[]; untracked: readonly string[] }): Promise<StatusAnswer>
  commit(change: { message: string; paths: readonly string[] }): Promise<StatusAnswer>
  push(): Promise<StatusAnswer>
  pull(): Promise<StatusAnswer>
  checkout(branch: { branch: string; remote: boolean }): Promise<StatusAnswer>
  createBranch(branch: string): Promise<StatusAnswer>
  /** Cancelling the signal stops the model call on the server too. */
  suggestMessage(paths: readonly string[], signal: AbortSignal): Promise<CommitSuggestion>
}

/**
 * Bind the routes to one working directory.
 * @param fetchFn - the fetch to use.
 * @param cwd - the session's working directory.
 * @returns one method per operation; each rejects with a message ready to show.
 */
export function createGitApi(fetchFn: Fetch, cwd: string): GitApi {
  const post = gitPost(fetchFn, cwd)
  return {
    status: () => post('status'),
    branches: () => post('branches'),
    diff: (target) => post('diff', target),
    stage: (paths) => post('stage', { paths }),
    unstage: (paths) => post('unstage', { paths }),
    discard: (target) => post('discard', target),
    commit: (change) => post('commit', change),
    push: () => post('push'),
    pull: () => post('pull'),
    checkout: (branch) => post('checkout', branch),
    createBranch: (branch) => post('create-branch', { branch }),
    suggestMessage: (paths, signal) => postJson(fetchFn, COMMIT_MESSAGE_ROUTE, { cwd, paths }, signal),
  }
}
