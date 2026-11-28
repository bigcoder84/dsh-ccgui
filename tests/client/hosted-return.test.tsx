// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * A row another plugin adds (Codex Subscription's speed and output detail) closes the picker
 * to open a choice list of its own. Once a choice is made there, the picker comes back with the
 * new value, as a drill-down would; leaving the list another way keeps the picker closed.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { OPTIONS_SLOT } from '../../src/client/picker/hosted-slots.tsx'
import type { HostEntry, HostSlots } from '../../src/client/picker/hosted-slots.tsx'
import { HARNESS_STATE, openPicker, renderPicker, trigger } from '../fixtures/picker-harness.tsx'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

/**
 * Opens a list the way Codex Subscription's row does: outside the picker, after asking the
 * picker to close, with focus moved into the list. Its choices hand focus back to the button
 * that named the menu.
 */
function OverlayRow({ dismiss }: { readonly dismiss: () => void }): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        const menu = event.currentTarget.closest('[role="menu"]')
        const opener = document.querySelector<HTMLButtonElement>(`button[aria-controls="${menu?.id ?? ''}"]`)
        if (opener === null) throw new Error('no button names the menu')
        dismiss()
        const list = document.createElement('div')
        list.setAttribute('data-overlay', '')
        const choice = document.createElement('button')
        choice.textContent = '高速'
        choice.addEventListener('click', () => {
          list.remove()
          opener.focus()
        })
        choice.addEventListener('keydown', (key) => {
          list.remove()
          if (key.key === 'Escape') opener.click()
          else if (key.key === 'Tab') opener.focus()
        })
        list.append(choice)
        document.body.append(list)
        choice.focus()
      }}
    >
      速度
    </button>
  )
}

const slots: HostSlots = {
  entries: (name) => (name === OPTIONS_SLOT ? [{ component: OverlayRow, options: {} } satisfies HostEntry] : []),
}

async function openList() {
  const h = renderPicker({ state: HARNESS_STATE, overrides: { slots, sessionId: 's1' } })
  await openPicker(h)
  await h.user.click(screen.getByRole('menuitem', { name: '速度' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  return { h, choice: screen.getByRole('button', { name: '高速' }) }
}

describe('coming back from a list another plugin opens', () => {
  it('reopens the picker once a choice is made', async () => {
    const { h, choice } = await openList()
    await h.user.click(choice)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('reopens it once when the list goes back with Escape', async () => {
    const { choice } = await openList()
    fireEvent.keyDown(choice, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    // Closing it now and coming back to the button later does not reopen it.
    fireEvent.keyDown(document, { key: 'Escape' })
    const elsewhere = document.body.appendChild(document.createElement('input'))
    act(() => {
      elsewhere.focus()
      trigger().focus()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays closed when the list is left with Tab', async () => {
    const { choice } = await openList()
    fireEvent.keyDown(choice, { key: 'Tab' })
    expect(document.activeElement).toBe(trigger())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays closed when the list is left by a press outside, and the button toggles as usual', async () => {
    const { h } = await openList()
    fireEvent.pointerDown(document.body)
    act(() => {
      document.querySelector('[data-overlay]')?.remove()
    })
    await h.user.click(trigger())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('does not reopen later when the row opened nothing', async () => {
    const h = renderPicker({
      state: HARNESS_STATE,
      overrides: {
        slots: { entries: (name) => (name === OPTIONS_SLOT ? [{ component: PlainRow, options: {} }] : []) },
        sessionId: 's1',
      },
    })
    await openPicker(h)
    await h.user.click(screen.getByRole('menuitem', { name: '速度' }))
    act(() => {
      trigger().blur()
      trigger().focus()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

function PlainRow({ dismiss }: { readonly dismiss: () => void }): ReactElement {
  return (
    <button type="button" role="menuitem" onClick={dismiss}>
      速度
    </button>
  )
}
