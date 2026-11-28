// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * What `apply` puts into the harness, reached the way the harness does: capturing what it
 * registers into each slot. `SessionMark` is not exported, so it is rendered from there too.
 * The model picker has tests of its own (picker*.test.tsx).
 */

import { cleanup, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectorySelection, DirectoryState } from '../../src/client/choices.ts'
import { apply, inject } from '../../src/client/index.tsx'
import type { ModeApi } from '../../src/client/mode-api.ts'
import type { SessionRowValues } from '../../src/client/provider-marks.ts'
import { MODE_ROUTE_PREFIX } from '../../src/constants.ts'
import { createStore } from '../fixtures/client-store.ts'
import type { TestStore } from '../fixtures/client-store.ts'

interface SelectResult {
  error?: { message?: string }
}
interface SessionState {
  blank?: boolean
  removed?: boolean
}

interface Registration {
  readonly options: { name: string; id: string; order?: number; inject(sessionId: string): unknown }
  readonly component: unknown
}

interface Harness {
  readonly directory: TestStore<DirectoryState>
  readonly session: TestStore<SessionState>
  readonly list: TestStore<{ byId: Readonly<Record<string, SessionRowValues | undefined>> }>
  readonly load: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  readonly select: ReturnType<typeof vi.fn<(selection: DirectorySelection) => Promise<SelectResult>>>
  readonly effects: (() => () => void)[]
  readonly slots: Map<string, Registration>
  /** Every registration in call order; `slots` alone cannot hold two entries sharing an id. */
  readonly registrations: Registration[]
  readonly injected: (readonly string[])[]
  subagent: unknown
}

const DEEPSEEK_GROUP = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
}
const CLI_STATE: DirectoryState = {
  groups: [
    { id: 'cli-claude', name: 'Claude Code', models: [{ id: 'default', name: 'Claude Code' }] },
    { id: 'cli-codex', name: 'Codex CLI', models: [{ id: 'default', name: 'Codex CLI' }] },
    DEEPSEEK_GROUP,
  ],
  current: { provider: 'cli-claude', model: 'default' },
}

function harness(state: DirectoryState = CLI_STATE, result: () => Promise<SelectResult> = () => Promise.resolve({})) {
  const slots = new Map<string, Registration>()
  const registrations: Registration[] = []
  const effects: (() => () => void)[] = []
  const h: Harness = {
    directory: createStore(state),
    session: createStore<SessionState>({ blank: true }),
    list: createStore({ byId: {} }),
    load: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
    select: vi.fn<(selection: DirectorySelection) => Promise<SelectResult>>(result),
    effects,
    slots,
    registrations,
    injected: [],
    subagent: undefined,
  }
  apply({
    effect: (run) => {
      effects.push(run)
    },
    // The terminal entry and add-to-chat have their own tests; here only their requests are recorded.
    inject: (deps) => {
      h.injected.push(deps)
      return undefined
    },
    slots: {
      inject: (_name, add) => add(),
      register: (options, component) => {
        const registration = { options, component }
        registrations.push(registration)
        slots.set(options.id, registration)
        return undefined
      },
    },
    modelDirectories: { directoryFor: () => ({ store: h.directory, load: h.load, select: h.select }) },
    sessions: {
      binding: () => ({ session: h.session }),
      list: h.list,
      subagentAddress: () => h.subagent,
    },
  })
  return h
}

function registered(h: Harness, id: string): Registration {
  const registration = h.slots.get(id)
  if (registration === undefined) throw new Error(`nothing registered as ${id}`)
  return registration
}

/** Render a slot entry the way the harness does: injected props, plus the session id. */
function renderSlot(h: Harness, id: string, sessionId = 's1') {
  const { options, component } = registered(h, id)
  const Component = component as ComponentType<Record<string, unknown>>
  const injected = options.inject(sessionId) as Record<string, unknown>
  return render(<Component {...injected} sessionId={sessionId} />)
}

const bodyOf = (init: RequestInit): Record<string, unknown> =>
  typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('apply', () => {
  it('asks for the services it uses', () => {
    expect(inject).toEqual(['slots', 'modelDirectories', 'sessions'])
  })

  it('registers the model picker, the session marks, the context meter and the settings section in their slots', () => {
    const h = harness()
    expect(h.registrations.map(({ options }) => [options.id, options.name, options.order])).toEqual([
      ['dsh-ccgui.picker', 'conversation.input.right', 1000],
      ['dsh-ccgui.session-mark', 'sidebar.session.row.leading', 20],
      ['dsh-ccgui.context-meter', 'conversation.composer.dock', undefined],
      ['dsh-ccgui.session-status-mark', 'sidebar.session.row.trailing', undefined],
      ['dsh-ccgui.settings', 'settings.section', 50],
      ['dsh-ccgui.settings', 'settings.section.icon', undefined],
    ])
  })

  it('defers the picker\'s shortcut and teamwork, the terminal entry, the files default, the 变更 page, startup scripts, 新建 Worktree and "添加到对话" until their services are available', () => {
    const h = harness()
    // The picker's services and "添加到对话" are not switchable; the others wait on their
    // switches, which start out on.
    const always = [['remote', 'remote.agentTeams'], ['shortcuts'], ['contextMenus']]
    expect(h.injected).toEqual(always)
    const disposers = h.effects.map((run) => run())
    expect(h.injected).toEqual([
      ...always,
      ['sidebarRight'],
      ['sidebarRight', 'sidebarRightTabs'],
      ['sidebarRightTabs', 'slots'],
      ['contextMenus', 'workspaces', 'sessions', 'uiWorkspace', 'slots'],
      ['sidebarRight', 'webTerminals'],
    ])
    for (const dispose of disposers) dispose()
  })

  it('installs its styles and removes them on dispose', () => {
    const h = harness()
    const dispose = h.effects[0]?.()
    const tag = document.head.querySelector('style[data-plugin="dsh-ccgui"]')
    expect(tag?.textContent).toContain('.dsh-cli-picker-popover')
    expect(tag?.textContent).toContain('.dsh-cli-session-mark')
    expect(tag?.textContent).toContain('.dsh-cli-terminal-entry')
    expect(tag?.textContent).toContain('[data-row-key^="session:"]')
    expect(tag?.textContent).toContain('.dsh-ccgui-changes-row')
    expect(tag?.textContent).toContain('.dsh-wt-dialog')
    expect(tag?.textContent).toContain('.dsh-wtg-header')
    dispose?.()
    expect(document.head.querySelector('style[data-plugin="dsh-ccgui"]')).toBeNull()
  })

  it('offers the model picker only to sessions that are not addressed subagents', () => {
    const h = harness()
    const menu = registered(h, 'dsh-ccgui.picker').options
    expect(menu.inject('s1')).toMatchObject({ available: true, session: h.session })
    h.subagent = { parent: 's0' }
    expect(menu.inject('s1')).toMatchObject({ available: false })
  })

  it('swallows catalog load failures, which land in the directory the picker shows', async () => {
    const h = harness()
    h.load.mockRejectedValueOnce(new Error('offline'))
    const face = registered(h, 'dsh-ccgui.picker').options.inject('s1') as { load: () => void }
    face.load()
    await Promise.resolve()
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  // The picker's inject is where the mode route meets the browser: the fetch must be
  // called on `window`, not passed bare, and every render of a session gets the same API.
  it('gives the picker an API that posts for that session through window.fetch', async () => {
    const h = harness()
    const face = registered(h, 'dsh-ccgui.picker').options.inject('mode-seat-1') as { modes: ModeApi }
    const reply = {
      success: true,
      data: {
        modes: {
          configId: 'permission_mode',
          current: 'default',
          options: [{ value: 'default', name: 'Default' }],
        },
      },
    }
    const fetchSpy = vi.fn((_input: string, _init: RequestInit) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) } as unknown as Response),
    )
    vi.stubGlobal('fetch', fetchSpy)
    try {
      expect(window.fetch).toBe(fetchSpy)
      await expect(face.modes.read('cli-claude')).resolves.toMatchObject({ modes: { current: 'default' } })
      const call = fetchSpy.mock.calls.at(0)
      expect(call?.[0]).toBe(MODE_ROUTE_PREFIX)
      expect(call?.[1].method).toBe('POST')
      expect(bodyOf(call?.[1] ?? {})).toEqual({ sessionId: 'mode-seat-1', provider: 'cli-claude' })
      const again = registered(h, 'dsh-ccgui.picker').options.inject('mode-seat-1') as { modes: ModeApi }
      expect(again.modes).toBe(face.modes)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('hands the session mark the list of sessions it draws from', () => {
    const h = harness()
    expect(registered(h, 'dsh-ccgui.session-status-mark').options.inject('s1')).toEqual({ list: h.list })
  })
})

describe('SessionMark', () => {
  it('shows the mark of the provider a session row is on', () => {
    const h = harness()
    h.list.set({
      byId: { s1: { projectionValues: { modelSelection: { next: { provider: 'cli-codex', model: 'x' } } } } },
    })
    const { container } = renderSlot(h, 'dsh-ccgui.session-mark')
    expect(container.querySelector('.dsh-cli-session-mark [data-cli-mark="codex"]')).not.toBeNull()
  })

  it('shows nothing for a row with no provider, and follows list updates', () => {
    const h = harness()
    const { container } = renderSlot(h, 'dsh-ccgui.session-mark')
    expect(container.innerHTML).toBe('')
    h.list.set({
      byId: { s1: { projectionValues: { modelSelection: { lastUsed: { provider: 'cli-mine', model: 'x' } } } } },
    })
    expect(container.querySelector('[data-cli-mark="cli"]')).not.toBeNull()
  })
})
