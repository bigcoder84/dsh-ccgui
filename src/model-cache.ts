/**
 * Keeps each CLI's model list on disk. The harness restarts this plugin when its files
 * change (an update, or a rebuild under a linked install), and a fresh catalog would show
 * a bare menu until the CLI is probed again; with the saved lists it is filled at once.
 * @module dsh-ccgui/model-cache
 */

import { readFile } from 'node:fs/promises'
import { AtomicFile } from './atomic-file.ts'
import type { CliChoiceList, CliEffortList, CliModelList, CliModelOption } from './model-options.ts'

/** Bumped when the layout changes; a file of another version is ignored, not misread. */
const CACHE_VERSION = 1

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function readOption(value: unknown): CliModelOption | undefined {
  if (!isObject(value) || !isText(value.value) || !isText(value.name)) return undefined
  return {
    value: value.value,
    name: value.name,
    ...(isText(value.description) ? { description: value.description } : {}),
  }
}

type OptionList = Omit<CliModelList, 'efforts' | 'modes' | 'speed'>

/** Checked as strictly as a live answer: one empty id makes the harness drop the whole CLI. */
function readOptions(value: unknown): OptionList | undefined {
  if (!isObject(value) || !isText(value.configId) || !isText(value.current) || !Array.isArray(value.options)) {
    return undefined
  }
  const options = (value.options as readonly unknown[]).map(readOption)
  if (options.length === 0 || options.some((option) => option === undefined)) return undefined
  return { configId: value.configId, current: value.current, options: options.filter((option) => option !== undefined) }
}

/** Levels only add to the menu, so a bad entry loses that model's levels, not the list. */
function readEfforts(value: unknown): Readonly<Record<string, CliEffortList | null>> | undefined {
  if (!isObject(value) || Array.isArray(value)) return undefined
  const entries = Object.entries(value).flatMap(([model, effort]): [string, CliEffortList | null][] => {
    if (effort === null) return [[model, null]]
    const read = readOptions(effort)
    return read === undefined ? [] : [[model, read]]
  })
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** A CLI's native modes, or its fast mode, kept verbatim; a bad entry loses it, not the list. */
function readChoice(value: unknown): CliChoiceList | undefined {
  const read = readOptions(value)
  return read === undefined ? undefined : { configId: read.configId, current: read.current, options: read.options }
}

function readList(value: unknown): CliModelList | undefined {
  const list = readOptions(value)
  if (list === undefined || !isObject(value)) return undefined
  const efforts = readEfforts(value.efforts)
  const modes = readChoice(value.modes)
  const speed = readChoice(value.speed)
  return {
    ...list,
    ...(efforts === undefined ? {} : { efforts }),
    ...(modes === undefined ? {} : { modes }),
    ...(speed === undefined ? {} : { speed }),
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // A torn or hand-edited file is only a lost cache; the next probe writes a good one.
    return undefined
  }
}

/**
 * Read the saved lists, keeping only well-formed entries.
 * @param text - the file's contents.
 * @returns the lists by provider route; empty for anything unreadable.
 */
export function parseModelCache(text: string): ReadonlyMap<string, CliModelList> {
  const data = parseJson(text)
  if (!isObject(data) || data.version !== CACHE_VERSION || !isObject(data.lists)) return new Map()
  return new Map(
    Object.entries(data.lists).flatMap(([provider, value]) => {
      const list = readList(value)
      return list === undefined ? [] : [[provider, list] as const]
    }),
  )
}

const isMissing = (error: unknown): boolean => isObject(error) && error.code === 'ENOENT'

/** One cache file, with writes kept in order. */
export class ModelCacheFile {
  private readonly file: AtomicFile

  constructor(private readonly path: string) {
    this.file = new AtomicFile(path)
  }

  /**
   * Read the saved lists.
   * @returns them by provider route; empty before the first save or for a corrupt file.
   */
  async read(): Promise<ReadonlyMap<string, CliModelList>> {
    try {
      return parseModelCache(await readFile(this.path, 'utf8'))
    } catch (error: unknown) {
      if (isMissing(error)) return new Map()
      throw error
    }
  }

  /**
   * Replace the saved lists; see {@link AtomicFile.write} for the ordering.
   * @param lists - every list to keep, by provider route.
   * @returns settles once this snapshot is on disk; rejects when it could not be written.
   */
  save(lists: ReadonlyMap<string, CliModelList>): Promise<void> {
    return this.file.write(JSON.stringify({ version: CACHE_VERSION, lists: Object.fromEntries(lists) }))
  }
}
