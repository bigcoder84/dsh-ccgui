// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * What other plugins add to the harness's own model menu, shown in the picker: rows below the
 * reasoning level (Codex Subscription's speed and output detail) and the drawing of a model's
 * name. The picker renders them with the props the harness's menu passes.
 */

import { act, cleanup, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LABEL_SLOT, OPTIONS_SLOT } from '../../src/client/picker/hosted-slots.tsx'
import type { HostEntry, HostSlots } from '../../src/client/picker/hosted-slots.tsx'
import { CODEX_STATE, HARNESS_STATE, openPicker, renderPicker, trigger } from '../fixtures/picker-harness.tsx'

afterEach(cleanup)

interface FakeSlots extends HostSlots {
  set(name: string, entries: readonly HostEntry[]): void
}

function fakeSlots(initial: Readonly<Record<string, readonly HostEntry[]>> = {}): FakeSlots {
  let lists: Readonly<Record<string, readonly HostEntry[]>> = initial
  let listeners: readonly { name: string; run: () => void }[] = []
  return {
    entries: (name) => lists[name] ?? [],
    subscribe: (name, run) => {
      const listener = { name, run }
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener)
      }
    },
    set: (name, entries) => {
      lists = { ...lists, [name]: entries }
      act(() => {
        for (const listener of listeners) if (listener.name === name) listener.run()
      })
    },
  }
}

interface RowProps {
  readonly sessionId: string
  readonly label: string
  readonly locked: boolean
  readonly dismiss: () => void
  readonly reportFailure: (message: string) => void
}

/** A row written the way Codex Subscription's is: it finds its menu and the button naming it. */
function SpeedRow({ sessionId, label, locked, dismiss, reportFailure }: RowProps): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={locked}
      data-session={sessionId}
      onClick={(event) => {
        const menu = event.currentTarget.closest('[role="menu"]')
        const opener = document.querySelector(`button[aria-controls="${menu?.id ?? ''}"]`)
        if (opener === null) throw new Error('no button names the menu')
        if (label === 'fail') reportFailure('偏好保存失败')
        else dismiss()
      }}
    >
      {label}
    </button>
  )
}

function Broken(): ReactElement {
  throw new Error('a plugin bug')
}

// The harness's registry keeps `inject` beside `options`, not inside it, as its StoredEntry does.
const row = (label: string, priority?: number, id?: string): HostEntry => ({
  component: SpeedRow,
  options: {
    ...(id === undefined ? {} : { id }),
    ...(priority === undefined ? {} : { priority }),
  },
  inject: () => ({ label }),
})

const hostedRows = (): string[] =>
  screen
    .getAllByRole('menuitem')
    .filter((item) => item.closest('.dsh-cli-picker-hosted') !== null)
    .map((item) => item.textContent)

describe('rows other plugins add to the model menu', () => {
  it('shows them below the reasoning level, highest priority first, with the session and the menu it is in', async () => {
    const slots = fakeSlots({ [OPTIONS_SLOT]: [row('输出详略', 0, 'b'), row('速度', 5, 'a')] })
    const h = renderPicker({ state: HARNESS_STATE, overrides: { slots, sessionId: 's1' } })
    await openPicker(h)
    expect(hostedRows()).toEqual(['速度', '输出详略'])
    expect(screen.getByRole('menuitem', { name: '速度' }).getAttribute('data-session')).toBe('s1')
    const menu = screen.getByRole('menuitem', { name: '速度' }).closest('[role="menu"]')
    expect(trigger().getAttribute('aria-controls')).toBe(menu?.id)
  })

  it('closes the picker and hands the keyboard back when a row opens a menu of its own', async () => {
    const h = renderPicker({
      state: HARNESS_STATE,
      overrides: { slots: fakeSlots({ [OPTIONS_SLOT]: [row('速度')] }), sessionId: 's1' },
    })
    await openPicker(h)
    await h.user.click(screen.getByRole('menuitem', { name: '速度' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('shows a failure a row reports in the picker toast', async () => {
    const h = renderPicker({
      state: HARNESS_STATE,
      overrides: { slots: fakeSlots({ [OPTIONS_SLOT]: [row('fail')] }), sessionId: 's1' },
    })
    await openPicker(h)
    await h.user.click(screen.getByRole('menuitem', { name: 'fail' }))
    expect((await screen.findByRole('alert')).textContent).toContain('切换失败：偏好保存失败')
  })

  it('locks the rows with the session', async () => {
    const h = renderPicker({
      state: HARNESS_STATE,
      session: { removed: true },
      overrides: { slots: fakeSlots({ [OPTIONS_SLOT]: [row('速度')] }), sessionId: 's1' },
    })
    expect(trigger()).toHaveProperty('disabled', true)
    h.session.set({ removed: false })
    await openPicker(h)
    expect(screen.getByRole('menuitem', { name: '速度' })).toHaveProperty('disabled', false)
  })

  it('follows rows coming and going, and leaves out a broken one or one that is no component', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const slots = fakeSlots()
    const h = renderPicker({ state: HARNESS_STATE, overrides: { slots, sessionId: 's1' } })
    await openPicker(h)
    expect(document.querySelector('.dsh-cli-picker-hosted')).toBeNull()
    expect(trigger().hasAttribute('aria-controls')).toBe(false)
    slots.set(OPTIONS_SLOT, [
      { component: Broken, options: {} },
      { component: 'not a component', options: {} },
      row('速度'),
    ])
    expect(hostedRows()).toEqual(['速度'])
  })

  it('shows nothing without a session id or a registry that lists entries', async () => {
    const h = renderPicker({ state: HARNESS_STATE, overrides: { slots: fakeSlots({ [OPTIONS_SLOT]: [row('速度')] }) } })
    await openPicker(h)
    expect(screen.queryByRole('menuitem', { name: '速度' })).toBeNull()
    cleanup()
    const bare = renderPicker({ state: HARNESS_STATE, overrides: { slots: {}, sessionId: 's1' } })
    await openPicker(bare)
    expect(document.querySelector('.dsh-cli-picker-hosted')).toBeNull()
  })
})

interface LabelProps {
  readonly provider: { readonly id: string }
  readonly model: { readonly id: string; readonly name: string }
  readonly placement: string
  readonly selected: boolean
  /** What the plugin's own `inject` supplies, as Codex Subscription's preference store. */
  readonly mark: string
}

function BoltLabel({ model, placement, selected, mark }: LabelProps): ReactElement {
  return (
    <span data-hosted-label={placement} data-selected={selected}>
      {mark}
      {model.name}
    </span>
  )
}

const label = (component: unknown = BoltLabel): Readonly<Record<string, readonly HostEntry[]>> => ({
  [LABEL_SLOT]: [{ component, options: { priority: 100 }, inject: () => ({ mark: '⚡' }) }],
})

describe("another plugin's model labels", () => {
  it("draws the harness's models through it, on the button and in the rows, with its own badge", async () => {
    const h = renderPicker({ state: HARNESS_STATE, overrides: { slots: fakeSlots(label()), sessionId: 's1' } })
    expect(trigger().querySelector('[data-hosted-label="trigger"]')?.textContent).toBe('⚡DeepSeek Chat')
    expect(trigger().getAttribute('aria-label')).toContain('DeepSeek Chat')
    await openPicker(h)
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map((item) => item.querySelector('[data-hosted-label="menu"]')?.getAttribute('data-selected'))).toEqual(
      ['true', 'false'],
    )
  })

  it("leaves a CLI's models to the picker", async () => {
    const h = renderPicker({ state: CODEX_STATE, overrides: { slots: fakeSlots(label()), sessionId: 's1' } })
    await openPicker(h)
    expect(document.querySelector('[data-hosted-label]')).toBeNull()
    // The picker's own badge stays.
    expect(document.querySelector('[data-tone="brand"]')?.textContent).toBe('New')
  })

  it('falls back to the plain name when the label breaks', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPicker({ state: HARNESS_STATE, overrides: { slots: fakeSlots(label(Broken)), sessionId: 's1' } })
    expect(trigger().textContent).toContain('DeepSeek Chat')
  })
})
