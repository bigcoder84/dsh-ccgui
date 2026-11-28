/**
 * What the AI commit message is written from, and the clean-up of the model's answer. Pure
 * functions, no I/O: the selected files are ranked so the diffs worth reading come first,
 * and the material stays within a byte budget however many files changed.
 * @module dsh-ccgui/commit/commit-material
 */

/** One selected file, with the patch the panel would show for it when one was read. */
export interface MaterialFile {
  readonly path: string
  readonly origPath?: string | undefined
  /** The status letter as the panel shows it; `?` for an untracked file. */
  readonly status: string
  readonly additions?: number | undefined
  readonly deletions?: number | undefined
  readonly patch?: string | undefined
}

export type FileCategory = 'source' | 'test' | 'config' | 'docs' | 'nameOnly'

export interface Material {
  readonly text: string
  /** How many selected files there were, and how many of them a diff was shown for. */
  readonly coverage: { readonly files: number; readonly diffFiles: number; readonly truncated: boolean }
}

export const MATERIAL_LIMITS = {
  /** Material sent to the model, in UTF-8 bytes; a small context window lowers it. */
  maxInputBytes: 64 * 1024,
  minInputBytes: 4 * 1024,
  /** Files named in the list; the rest are counted. */
  listedFiles: 150,
  /** Least diff bytes a file must be able to get to be read at all. */
  minShare: 1536,
  /** The commit box takes any length, but a message this long is not one anyone wrote. */
  maxMessageChars: 2000,
} as const

/** Share of the budget the file list may take; the diffs get the rest. */
const LIST_SHARE = 0.35

export const DEFAULT_COMMIT_PROMPT = [
  '你是 Git 提交信息助手。根据给出的代码改动写一条提交信息。',
  '- 第一行：type(scope): 描述。type 按改动性质选：新功能 feat，修复 fix，重构 refactor，文档 docs，测试 test，杂项 chore，性能 perf，样式 style；scope 是主要影响的模块，取不出就省略括号。',
  '- 描述说清楚做了什么，不超过 50 个字；不要写“更新代码”“修改文件”这类没有信息量的话。',
  '- 改动点较多时，空一行后用“- ”列出 2～5 条要点；改动单一时只写第一行。',
  '- 只输出提交信息本身：不要解释，不要代码块，不要引号。',
].join('\n')

const RANK: Readonly<Record<FileCategory, number>> = { source: 0, test: 1, config: 2, docs: 3, nameOnly: 4 }
const NAME_ONLY_FILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'go.sum',
  'poetry.lock',
  'pipfile.lock',
  'composer.lock',
  'gemfile.lock',
  'uv.lock',
])
const NAME_ONLY_DIRS = new Set(['node_modules', '__snapshots__', '.next', '.nuxt', '.gradle', '.idea'])
/** Build output only at the top two levels: a Java package may well be called `build`. */
const OUTPUT_DIRS = new Set(['dist', 'build', 'target', 'out', 'coverage', 'vendor', 'lib'])
const NAME_ONLY_NAME =
  /(?:\.lock|\.min\.[a-z0-9]+|\.map|\.snap|\.svg|\.(?:png|jpe?g|gif|ico|webp|pdf|zip|gz|jar|class|so|dylib|dll|exe|woff2?|ttf))$/u
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'e2e'])
const TEST_NAME = /(?:\.(?:test|spec)\.[^.]+|Tests?\.(?:java|kt|cs|swift)|_test\.(?:go|py)|^test_[^/]*\.py)$/u
const DOC_NAME = /\.(?:md|markdown|rst|adoc|txt)$/u
const CONFIG_NAME = /(?:\.(?:xml|ya?ml|properties|json|toml|ini|conf|cfg|gradle|env)|^(?:dockerfile|makefile))$/u
const STATUS_LABELS: Readonly<Record<string, string>> = {
  A: '新增',
  '?': '新增',
  M: '修改',
  D: '删除',
  R: '重命名',
  C: '复制',
  U: '冲突',
  T: '类型变更',
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')
const changedLines = (file: MaterialFile): number => (file.additions ?? 0) + (file.deletions ?? 0)

/**
 * The input budget in bytes: half the context window (at least a byte per token), within the limits.
 * @param contextWindow - the model's context window in tokens, when it reports one.
 * @returns the budget.
 */
export function inputBudget(contextWindow: number | undefined): number {
  if (contextWindow === undefined || !Number.isInteger(contextWindow) || contextWindow <= 0) {
    return MATERIAL_LIMITS.maxInputBytes
  }
  return Math.min(MATERIAL_LIMITS.maxInputBytes, Math.max(MATERIAL_LIMITS.minInputBytes, Math.floor(contextWindow / 2)))
}

/**
 * The file's class for ranking. Lock files, build output, binaries and deletions are named
 * only: their diff says nothing about what the change is for.
 * @param file - the file.
 * @returns its category.
 */
export function fileCategory(file: Pick<MaterialFile, 'path' | 'status'>): FileCategory {
  if (file.status === 'D') return 'nameOnly'
  const segments = file.path.toLowerCase().split('/')
  const name = segments.at(-1) ?? ''
  const dirs = segments.slice(0, -1)
  if (NAME_ONLY_FILES.has(name) || NAME_ONLY_NAME.test(name) || dirs.some((dir) => NAME_ONLY_DIRS.has(dir))) {
    return 'nameOnly'
  }
  if (dirs.slice(0, 2).some((dir) => OUTPUT_DIRS.has(dir))) return 'nameOnly'
  if (DOC_NAME.test(name)) return 'docs'
  if (dirs.some((dir) => TEST_DIRS.has(dir)) || TEST_NAME.test(file.path.split('/').at(-1) ?? '')) return 'test'
  if (CONFIG_NAME.test(name)) return 'config'
  return 'source'
}

/**
 * Order files source, test, config, docs, name-only, then by lines changed.
 * @param files - the selected files.
 * @returns a sorted copy.
 */
export function rankFiles<T extends MaterialFile>(files: readonly T[]): T[] {
  return [...files].sort(
    (a, b) =>
      RANK[fileCategory(a)] - RANK[fileCategory(b)] ||
      changedLines(b) - changedLines(a) ||
      a.path.localeCompare(b.path),
  )
}

/**
 * The ranked files whose diff is worth reading, at most as many as the budget can give a share.
 * @param ranked - the files in rank order.
 * @param budget - the input budget in bytes.
 * @returns the files to read a patch for.
 */
export function diffCandidates<T extends MaterialFile>(ranked: readonly T[], budget: number): T[] {
  return ranked
    .filter((file) => fileCategory(file) !== 'nameOnly')
    .slice(0, Math.floor(budget / MATERIAL_LIMITS.minShare))
}

/** An even share each; what a small item leaves goes to the bigger ones. */
function allocateShares(sizes: readonly number[], budget: number): number[] {
  const order = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size)
  const shares = sizes.map(() => 0)
  let left = budget
  let count = sizes.length
  for (const { size, index } of order) {
    const share = Math.min(size, Math.floor(left / count))
    shares[index] = share
    left -= share
    count -= 1
  }
  return shares
}

/** The leading whole lines of `text` within `maxBytes`, and how many were left out. */
function excerpt(text: string, maxBytes: number): { readonly text: string; readonly omitted: number } {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  let used = 0
  let kept = 0
  for (const line of lines) {
    const size = byteLength(line) + 1
    if (used + size > maxBytes) break
    used += size
    kept += 1
  }
  return { text: lines.slice(0, kept).join('\n'), omitted: lines.length - kept }
}

function fileLine(file: MaterialFile): string {
  const path = file.origPath === undefined ? file.path : `${file.origPath} → ${file.path}`
  const counts = file.additions === undefined ? '' : ` +${String(file.additions)} -${String(file.deletions ?? 0)}`
  return `${file.status === '?' ? 'A' : file.status} ${path}${counts}`
}

function overview(branch: string | undefined, files: readonly MaterialFile[]): string {
  const added = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deleted = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  const kinds = files.reduce<ReadonlyMap<string, number>>((map, file) => {
    const label = STATUS_LABELS[file.status] ?? '修改'
    return new Map([...map, [label, (map.get(label) ?? 0) + 1]])
  }, new Map())
  const summary = [...kinds].map(([label, count]) => `${label} ${String(count)}`).join('，')
  return [
    '## 改动概览',
    ...(branch === undefined ? [] : [`分支：${branch}`]),
    `共 ${String(files.length)} 个文件，+${String(added)} -${String(deleted)}（${summary}）`,
  ].join('\n')
}

function fileList(files: readonly MaterialFile[], cap: number): { readonly text: string; readonly cut: boolean } {
  const lines = files.slice(0, MATERIAL_LIMITS.listedFiles).map(fileLine)
  const kept: string[] = []
  let used = byteLength('## 文件\n')
  for (const line of lines) {
    if (used + byteLength(line) + 1 > cap) break
    kept.push(line)
    used += byteLength(line) + 1
  }
  const rest = files.length - kept.length
  return {
    text: ['## 文件', ...kept, ...(rest > 0 ? [`…另有 ${String(rest)} 个文件`] : [])].join('\n'),
    cut: rest > 0,
  }
}

function diffBlocks(files: readonly MaterialFile[], budget: number): { blocks: string[]; partial: boolean } {
  const readable = files.filter((file) => file.patch !== undefined && file.patch !== '')
  const headers = readable.map((file) => `### ${fileLine(file)}\n\`\`\`diff\n`)
  const overhead = headers.reduce((sum, header) => sum + byteLength(header) + 48, 0)
  const shares = allocateShares(
    readable.map((file) => byteLength(file.patch ?? '')),
    Math.max(0, budget - overhead),
  )
  const cuts = readable.map((file, index) => excerpt(file.patch ?? '', shares[index] ?? 0))
  const blocks = cuts.flatMap((cut, index) =>
    cut.text === ''
      ? []
      : [
          `${headers[index] ?? ''}${cut.text}\n\`\`\`${cut.omitted > 0 ? `\n…（其余 ${String(cut.omitted)} 行省略）` : ''}`,
        ],
  )
  return { blocks, partial: cuts.some((cut) => cut.omitted > 0) }
}

/**
 * The material the model gets as its user message, within `budget` bytes whatever the number
 * of files: an overview, the file list, then diff excerpts shared out over the files read.
 * @param input - the branch, the selected files in rank order, and the budget in bytes.
 * @returns the text and how much of the change it covers.
 */
export function buildMaterial(input: {
  readonly branch: string | undefined
  readonly files: readonly MaterialFile[]
  readonly budget: number
}): Material {
  const { branch, files, budget } = input
  const head = overview(branch, files)
  const list = fileList(files, Math.floor(budget * LIST_SHARE))
  const diffBudget = budget - byteLength(head) - byteLength(list.text) - 32
  const diffs = diffBlocks(files, diffBudget)
  const eligible = files.filter((file) => fileCategory(file) !== 'nameOnly').length
  const note =
    diffs.blocks.length < eligible
      ? `改动较多，下面只有 ${String(diffs.blocks.length)} 个文件的 diff，其余只有文件名；请结合概览概括整体改动。`
      : ''
  const parts = [head, list.text, '## 代码改动', note, ...diffs.blocks].filter((part) => part !== '')
  return {
    text: parts.join('\n\n'),
    coverage: {
      files: files.length,
      diffFiles: diffs.blocks.length,
      truncated: diffs.blocks.length < eligible || diffs.partial || list.cut,
    },
  }
}

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['「', '」'],
]
const LABEL = /^(?:git\s+)?(?:提交信息|commit\s+message)\s*[:：]\s*/iu

/** One layer of wrapping: a code fence (closed, or left open by a cut-off answer), a label, or quotes. */
function unwrapOnce(text: string): string {
  if (text.startsWith('```')) {
    return text
      .replace(/^```[^\n]*(?:\n|$)/u, '')
      .replace(/\n?```\s*$/u, '')
      .trim()
  }
  const unlabelled = text.replace(LABEL, '')
  if (unlabelled !== text) return unlabelled.trim()
  const pair = QUOTE_PAIRS.find(([open, close]) => text.length >= 2 && text.startsWith(open) && text.endsWith(close))
  return pair === undefined ? text : text.slice(pair[0].length, -pair[1].length).trim()
}

/** Drop whole trailing lines until the text fits; a first line alone too long is cut. */
function withinLength(text: string, max: number): string {
  if (text.length <= max) return text
  const lines = text.split('\n')
  while (lines.length > 1 && lines.join('\n').length > max) lines.pop()
  return lines.join('\n').slice(0, max).trimEnd()
}

/**
 * The model's answer as a commit message: wrapping fences, labels and quotes removed, line
 * ends and blank lines normalised, control characters dropped, cut at a line to the limit.
 * @param raw - the model's text.
 * @returns the message; empty when the model said nothing usable.
 */
export function cleanSuggestion(raw: string): string {
  const normalised = raw
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, ' ')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
  let value = normalised.trim()
  for (let previous = ''; previous !== value;) {
    previous = value
    value = unwrapOnce(value)
  }
  const tidy = value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return withinLength(tidy, MATERIAL_LIMITS.maxMessageChars)
}
