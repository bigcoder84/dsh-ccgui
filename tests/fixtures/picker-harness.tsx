/// <reference lib="dom" />

/**
 * Renders the model picker the way the composer slot does, with stores the tests can push new
 * snapshots into and spies on everything the picker calls on the harness.
 */

import { render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { userEvent } from '@testing-library/user-event'
import { vi } from 'vitest'
import type { DirectorySelection, DirectoryState } from '../../src/client/choices.ts'
import { createCliPrefs } from '../../src/client/cli-prefs.ts'
import { createLastSelections } from '../../src/client/last-selections.ts'
import type { ModeApi, ModeReply, NativeModes } from '../../src/client/mode-api.ts'
import { CliPicker } from '../../src/client/picker/picker.tsx'
import type { PickerInjected } from '../../src/client/picker/picker.tsx'
import type { TeamApi } from '../../src/client/picker/use-picker-actions.ts'
import { createStore } from './client-store.ts'
import type { TestStore } from './client-store.ts'

export interface SelectResult {
  error?: { message?: string }
}

export interface SessionState {
  blank?: boolean
  removed?: boolean
  running?: boolean
}

export const MODES = {
  configId: 'mode',
  current: 'auto',
  options: [
    { value: 'read-only', name: 'Read Only' },
    { value: 'auto', name: 'Agent' },
    { value: 'full-access', name: 'Full Access' },
  ],
}

export const fast = (current: string): NativeModes => ({
  configId: 'fast-mode',
  current,
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
})

export const NO_SETTINGS: ModeReply = { modes: undefined, pending: undefined }

const LEVELS = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'XHigh' },
  ],
  defaultEffort: 'medium',
}

export const CODEX_GROUP = {
  id: 'cli-codex',
  name: 'Codex CLI',
  models: [
    { id: 'default', name: 'GPT-6 Terra（默认）' },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', reasoning: LEVELS },
    {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      description: '0.5x',
      reasoning: LEVELS,
      badge: { text: 'New', tone: 'brand' },
    },
  ],
}

export const CLAUDE_GROUP = {
  id: 'cli-claude',
  name: 'Claude Code',
  models: [{ id: 'default', name: 'Claude Code' }],
}

export const DEEPSEEK_GROUP = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: LEVELS.efforts } },
    { id: 'deepseek-flash', name: 'DeepSeek Flash' },
  ],
}

export const CODEX_SELECTION: DirectorySelection = {
  provider: 'cli-codex',
  model: 'gpt-6-sol',
  reasoningEffort: 'high',
}
const HARNESS_SELECTION: DirectorySelection = { provider: 'deepseek-official', model: 'deepseek-chat' }

export const CODEX_STATE: DirectoryState = {
  groups: [CLAUDE_GROUP, CODEX_GROUP, DEEPSEEK_GROUP],
  current: CODEX_SELECTION,
}

export const HARNESS_STATE: DirectoryState = { ...CODEX_STATE, current: HARNESS_SELECTION }

export interface PickerHarness {
  readonly directory: TestStore<DirectoryState>
  readonly session: TestStore<SessionState>
  readonly projections: TestStore<Readonly<Record<string, unknown>>>
  readonly load: ReturnType<typeof vi.fn<() => void>>
  readonly select: ReturnType<typeof vi.fn<(selection: DirectorySelection) => Promise<SelectResult>>>
  readonly read: ReturnType<typeof vi.fn<ModeApi['read']>>
  readonly write: ReturnType<typeof vi.fn<ModeApi['write']>>
  readonly team: ReturnType<typeof vi.fn<TeamApi['set']>>
  readonly storage: Map<string, string>
  readonly user: ReturnType<typeof userEvent.setup>
  readonly rerender: (overrides?: Partial<PickerInjected>) => void
}

export interface PickerOptions {
  readonly state?: DirectoryState
  readonly session?: SessionState
  readonly reply?: ModeReply
  readonly read?: ModeApi['read']
  readonly write?: ModeApi['write']
  readonly select?: () => Promise<SelectResult>
  readonly team?: TeamApi['set']
  readonly projections?: Readonly<Record<string, unknown>>
  readonly storage?: Readonly<Record<string, string>>
  readonly overrides?: Partial<PickerInjected>
}

/**
 * jsdom has no media queries and no canvas. Reduced motion draws the particle field's one
 * still frame, which the slider's tests need, without starting an animation loop.
 */
function stubBrowser(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
}

/**
 * Render the picker inside a composer card.
 * @param options - the directory, the session and what the harness answers.
 * @returns the stores and spies.
 */
export function renderPicker(options: PickerOptions = {}): PickerHarness {
  stubBrowser()
  const storage = new Map(Object.entries(options.storage ?? {}))
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
  }
  const projections = createStore<Readonly<Record<string, unknown>>>(options.projections ?? {})
  const harness = {
    directory: createStore(options.state ?? CODEX_STATE),
    session: createStore<SessionState>(options.session ?? { blank: false }),
    projections,
    load: vi.fn<() => void>(),
    select: vi.fn<(selection: DirectorySelection) => Promise<SelectResult>>(
      options.select ?? (() => Promise.resolve({})),
    ),
    read: vi.fn<ModeApi['read']>(options.read ?? (() => Promise.resolve(options.reply ?? NO_SETTINGS))),
    write: vi.fn<ModeApi['write']>(options.write ?? (() => Promise.resolve(options.reply ?? NO_SETTINGS))),
    team: vi.fn<TeamApi['set']>(options.team ?? (() => Promise.resolve(null))),
    storage,
    user: userEvent.setup(),
  }
  const prefs = createCliPrefs(memory)
  const lastSelections = createLastSelections(memory)
  const useProjection = (key: string): unknown =>
    useSyncExternalStore(projections.subscribe, () => projections.getSnapshot()[key])
  const props = (overrides: Partial<PickerInjected> = {}): PickerInjected => ({
    available: true,
    directory: harness.directory,
    load: harness.load,
    select: harness.select,
    session: harness.session,
    prefs,
    lastSelections,
    modes: { read: harness.read, write: harness.write },
    team: { set: harness.team },
    useProjection,
    ...options.overrides,
    ...overrides,
  })
  const view = render(
    <div data-composer-card>
      <CliPicker {...props()} />
    </div>,
  )
  return {
    ...harness,
    rerender: (overrides) => {
      view.rerender(
        <div data-composer-card>
          <CliPicker {...props(overrides)} />
        </div>,
      )
    },
  }
}

/** The picker's button. */
export const trigger = (): HTMLElement => screen.getByRole('button', { name: /^选择模型和思考深度/ })

/** Open the picker and wait for its popover. */
export async function openPicker(harness: PickerHarness): Promise<HTMLElement> {
  await harness.user.click(trigger())
  return screen.getByRole('dialog', { name: '选择模型和思考深度' })
}
