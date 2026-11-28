/**
 * Read the files a commit would take for the AI commit message: the selected entries of the
 * status, ranked, and the patches the panel would show for the ones worth reading. Only files
 * the status lists are read, so a posted path can never reach a file git does not report.
 * @module dsh-ccgui/commit/commit-changes
 */

import { readDiff, readStatus } from '../git/git-read.ts'
import type { DiffSide } from '../git/git-read.ts'
import { GitRequestError } from '../git/git-requests.ts'
import type { Spawn } from '../git/git-run.ts'
import type { ChangeEntry } from '../git/git-status.ts'
import { diffCandidates, rankFiles } from './commit-material.ts'
import type { MaterialFile } from './commit-material.ts'

const NOTHING_SELECTED = '没有选中要提交的文件'
/** Patches read at a time: each is a git process, and a large pick could start dozens. */
const READ_CONCURRENCY = 8

/** A selected file and the sides of the panel it appears in. */
interface Selected extends MaterialFile {
  readonly sides: readonly DiffSide[]
  readonly origPath?: string | undefined
}

export interface CommitChanges {
  readonly branch: string | undefined
  /** The selected files in rank order; the ones read carry their patch. */
  readonly files: readonly MaterialFile[]
}

/** A file both staged and changed again shows in two groups; the commit takes both. */
function merge(previous: Selected | undefined, entry: ChangeEntry, side: DiffSide): Selected {
  if (previous === undefined) {
    return {
      path: entry.path,
      origPath: entry.origPath,
      status: entry.status,
      additions: entry.additions,
      deletions: entry.deletions,
      sides: [side],
    }
  }
  return {
    ...previous,
    origPath: previous.origPath ?? entry.origPath,
    additions: (previous.additions ?? 0) + (entry.additions ?? 0),
    deletions: (previous.deletions ?? 0) + (entry.deletions ?? 0),
    sides: [...previous.sides, side],
  }
}

function selectedFiles(
  groups: readonly (readonly [DiffSide, readonly ChangeEntry[]])[],
  paths: readonly string[],
): Selected[] {
  const wanted = new Set(paths)
  const byPath = groups.reduce<ReadonlyMap<string, Selected>>((map, [side, entries]) => {
    const picked = entries.filter((entry) => wanted.has(entry.path))
    return new Map([...map, ...picked.map((entry) => [entry.path, merge(map.get(entry.path), entry, side)] as const)])
  }, new Map())
  return [...byPath.values()]
}

async function patchOf(spawn: Spawn, root: string, file: Selected): Promise<string> {
  const diffs = await Promise.all(
    file.sides.map((side) => readDiff(spawn, root, { path: file.path, side, origPath: file.origPath })),
  )
  return diffs.map((diff) => diff.patch).join('')
}

async function readPatches(
  spawn: Spawn,
  root: string,
  files: readonly Selected[],
): Promise<ReadonlyMap<string, string>> {
  const batches = Array.from({ length: Math.ceil(files.length / READ_CONCURRENCY) }, (_, index) =>
    files.slice(index * READ_CONCURRENCY, (index + 1) * READ_CONCURRENCY),
  )
  const read = await batches.reduce<Promise<(readonly [string, string])[]>>(
    async (done, batch) => [
      ...(await done),
      ...(await Promise.all(batch.map(async (file) => [file.path, await patchOf(spawn, root, file)] as const))),
    ],
    Promise.resolve([]),
  )
  return new Map(read)
}

/**
 * Collect what the model is shown for a commit of `paths`.
 * @param spawn - the subprocess service's spawn.
 * @param root - the repository's top level.
 * @param paths - the files the commit box has selected.
 * @param budget - the input budget, which bounds how many patches are read.
 * @returns the branch and the ranked files.
 * @throws GitRequestError when none of the paths is a changed file.
 */
export async function collectChanges(
  spawn: Spawn,
  root: string,
  paths: readonly string[],
  budget: number,
): Promise<CommitChanges> {
  const status = await readStatus(spawn, root)
  const files = rankFiles(
    selectedFiles(
      [
        ['staged', status.staged],
        ['unstaged', status.unstaged],
        ['untracked', status.untracked],
      ],
      paths,
    ),
  )
  if (files.length === 0) throw new GitRequestError(NOTHING_SELECTED)
  const patches = await readPatches(spawn, root, diffCandidates(files, budget))
  return {
    branch: status.branch,
    files: files.map(({ sides: _sides, ...file }) => ({ ...file, patch: patches.get(file.path) })),
  }
}
