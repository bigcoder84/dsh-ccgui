import { describe, expect, it } from 'vitest'
import {
  MATERIAL_LIMITS,
  buildMaterial,
  cleanSuggestion,
  diffCandidates,
  fileCategory,
  inputBudget,
  rankFiles,
} from '../../src/commit/commit-material.ts'
import type { MaterialFile } from '../../src/commit/commit-material.ts'

const file = (path: string, extra: Partial<MaterialFile> = {}): MaterialFile => ({ path, status: 'M', ...extra })
const patchOf = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `+line ${String(index)}`).join('\n')

describe('fileCategory', () => {
  it.each([
    ['src/a.ts', 'source'],
    ['tests/a.test.ts', 'test'],
    ['src/a.spec.tsx', 'test'],
    ['README.md', 'docs'],
    ['tsconfig.json', 'config'],
    ['pnpm-lock.yaml', 'nameOnly'],
    ['dist/index.js', 'nameOnly'],
    ['assets/logo.svg', 'nameOnly'],
    ['node_modules/x/index.js', 'nameOnly'],
  ])('classes %s as %s', (path, category) => {
    expect(fileCategory({ path, status: 'M' })).toBe(category)
  })

  // A deletion's diff is the whole old file; what matters is that it went.
  it('names a deletion only', () => {
    expect(fileCategory({ path: 'src/a.ts', status: 'D' })).toBe('nameOnly')
  })

  // Build output is only recognised near the top: a Java package may be called `build`.
  it('keeps a deep folder called build as source', () => {
    expect(fileCategory({ path: 'src/main/java/build/A.java', status: 'M' })).toBe('source')
  })
})

describe('rankFiles', () => {
  it('puts source first, then tests, config, docs and name-only files, larger changes first', () => {
    const ranked = rankFiles([
      file('README.md'),
      file('pnpm-lock.yaml', { additions: 900 }),
      file('tests/a.test.ts'),
      file('src/small.ts', { additions: 1 }),
      file('src/big.ts', { additions: 40 }),
      file('package.json'),
    ])
    expect(ranked.map((entry) => entry.path)).toEqual([
      'src/big.ts',
      'src/small.ts',
      'tests/a.test.ts',
      'package.json',
      'README.md',
      'pnpm-lock.yaml',
    ])
  })
})

describe('diffCandidates', () => {
  it('skips name-only files and reads no more than the budget can share out', () => {
    const files = Array.from({ length: 10 }, (_, index) => file(`src/f${String(index)}.ts`))
    const picked = diffCandidates([file('yarn.lock'), ...files], MATERIAL_LIMITS.minShare * 3)
    expect(picked.map((entry) => entry.path)).toEqual(['src/f0.ts', 'src/f1.ts', 'src/f2.ts'])
  })
})

describe('inputBudget', () => {
  it('takes half the context window within the limits', () => {
    expect(inputBudget(undefined)).toBe(MATERIAL_LIMITS.maxInputBytes)
    expect(inputBudget(20_000)).toBe(10_000)
    expect(inputBudget(1_000)).toBe(MATERIAL_LIMITS.minInputBytes)
    expect(inputBudget(1_000_000)).toBe(MATERIAL_LIMITS.maxInputBytes)
    expect(inputBudget(0)).toBe(MATERIAL_LIMITS.maxInputBytes)
  })
})

describe('buildMaterial', () => {
  it('gives the overview, the file list and each diff', () => {
    const material = buildMaterial({
      branch: 'main',
      files: [
        file('src/a.ts', { additions: 2, deletions: 1, patch: '+x\n-y\n+z\n' }),
        file('b.txt', { status: '?', additions: 1, deletions: 0 }),
      ],
      budget: MATERIAL_LIMITS.maxInputBytes,
    })
    expect(material.text).toContain('分支：main')
    expect(material.text).toContain('共 2 个文件，+3 -1（修改 1，新增 1）')
    expect(material.text).toContain('A b.txt +1 -0')
    expect(material.text).toContain('### M src/a.ts +2 -1\n```diff\n+x\n-y\n+z\n```')
    expect(material.coverage).toEqual({ files: 2, diffFiles: 1, truncated: true })
  })

  it('keeps within the budget however large the diffs are', () => {
    const files = Array.from({ length: 30 }, (_, index) =>
      file(`src/f${String(index)}.ts`, { additions: 5000, patch: patchOf(5000) }),
    )
    const budget = 16 * 1024
    const material = buildMaterial({ branch: undefined, files, budget })
    expect(Buffer.byteLength(material.text)).toBeLessThanOrEqual(budget)
    expect(material.coverage.truncated).toBe(true)
    expect(material.text).toContain('行省略')
  })

  it('counts the files beyond the list instead of naming them', () => {
    const files = Array.from({ length: MATERIAL_LIMITS.listedFiles + 5 }, (_, index) => file(`f${String(index)}.lock`))
    const material = buildMaterial({ branch: undefined, files, budget: MATERIAL_LIMITS.maxInputBytes })
    expect(material.text).toContain('…另有 5 个文件')
    expect(material.coverage.truncated).toBe(true)
  })

  it('names a rename with where it came from', () => {
    const material = buildMaterial({
      branch: undefined,
      files: [file('src/new.ts', { status: 'R', origPath: 'src/old.ts' })],
      budget: MATERIAL_LIMITS.maxInputBytes,
    })
    expect(material.text).toContain('R src/old.ts → src/new.ts')
  })
})

describe('cleanSuggestion', () => {
  it.each([
    ['feat: add x', 'feat: add x'],
    ['```\nfeat: add x\n```', 'feat: add x'],
    ['```text\nfeat: add x', 'feat: add x'],
    ['提交信息：feat: add x', 'feat: add x'],
    ['"feat: add x"', 'feat: add x'],
    ['「feat: add x」', 'feat: add x'],
    ['feat: add x\r\n\r\n\r\n\r\n- one\t two', 'feat: add x\n\n- one  two'],
    ['  \n ', ''],
  ])('cleans %j', (raw, expected) => {
    expect(cleanSuggestion(raw)).toBe(expected)
  })

  it('drops control characters', () => {
    expect(cleanSuggestion('feat: a\u0007b')).toBe('feat: ab')
  })

  it('cuts an overlong answer at a line', () => {
    const long = `feat: x\n\n${'- point\n'.repeat(400)}`
    const cleaned = cleanSuggestion(long)
    expect(cleaned.length).toBeLessThanOrEqual(MATERIAL_LIMITS.maxMessageChars)
    expect(cleaned.endsWith('- point')).toBe(true)
  })

  it('cuts a single overlong line', () => {
    expect(cleanSuggestion('x'.repeat(3000))).toHaveLength(MATERIAL_LIMITS.maxMessageChars)
  })
})
