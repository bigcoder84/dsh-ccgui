import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectChanges } from '../../src/commit/commit-changes.ts'
import { MATERIAL_LIMITS } from '../../src/commit/commit-material.ts'
import { GitRequestError } from '../../src/git/git-requests.ts'
import { collectingSpawn } from '../fixtures/collecting-subprocess.ts'

let repo = ''
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const write = (name: string, text: string): void => {
  writeFileSync(join(repo, name), text)
}
const collect = (paths: readonly string[], budget: number = MATERIAL_LIMITS.maxInputBytes) =>
  collectChanges(collectingSpawn, repo, paths, budget)

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ccgui-commit-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  write('a.ts', 'one\ntwo\n')
  write('pnpm-lock.yaml', 'lock: 1\n')
  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
})

afterEach(() => {
  // A git process may still be writing its index when the test ends, which a single pass races.
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('collectChanges', () => {
  it('reads only the selected files, with the patches the panel shows', async () => {
    write('a.ts', 'one\nTWO\n')
    write('new.ts', 'fresh\n')
    write('other.ts', 'not picked\n')
    const changes = await collect(['a.ts', 'new.ts'])
    expect(changes.branch).toBe('main')
    expect(changes.files.map((file) => [file.path, file.status])).toEqual([
      ['a.ts', 'M'],
      ['new.ts', '?'],
    ])
    expect(changes.files[0]?.patch).toContain('+TWO')
    expect(changes.files[1]?.patch).toContain('+fresh')
  })

  // The commit takes the file as it is on disk, so both halves belong in the material.
  it('joins the staged and the unstaged halves of one file', async () => {
    write('a.ts', 'one\nTWO\n')
    git('add', 'a.ts')
    write('a.ts', 'one\nTWO\nthree\n')
    const [only] = (await collect(['a.ts'])).files
    expect(only).toMatchObject({ path: 'a.ts', additions: 2, deletions: 1 })
    expect(only?.patch).toContain('+TWO')
    expect(only?.patch).toContain('+three')
  })

  it('names a lock file without reading its diff', async () => {
    write('pnpm-lock.yaml', 'lock: 2\n')
    write('a.ts', 'one\nTWO\n')
    const changes = await collect(['pnpm-lock.yaml', 'a.ts'])
    expect(changes.files.map((file) => [file.path, file.patch === undefined])).toEqual([
      ['a.ts', false],
      ['pnpm-lock.yaml', true],
    ])
  })

  it('reads no more patches than the budget can share out', async () => {
    mkdirSync(join(repo, 'src'))
    for (const index of [1, 2, 3]) write(`src/f${String(index)}.ts`, `${String(index)}\n`)
    const changes = await collect(['src/f1.ts', 'src/f2.ts', 'src/f3.ts'], MATERIAL_LIMITS.minShare * 2)
    expect(changes.files.filter((file) => file.patch !== undefined)).toHaveLength(2)
  })

  it('refuses a selection with no changed file in it', async () => {
    await expect(collect(['a.ts', '../outside.txt'])).rejects.toBeInstanceOf(GitRequestError)
  })
})
