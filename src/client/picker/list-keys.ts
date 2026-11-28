/// <reference lib="dom" />

/**
 * The keyboard in the picker's model list, as in the harness's own model menu: the search
 * field takes the focus when the picker opens, the arrows move between it and the rows, and
 * Enter in the field chooses the first row that matches. The slider and the footer keep
 * their own keys, so only presses in the field or on a row are handled here.
 * @module dsh-ccgui/client/picker/list-keys
 */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { isMobileDevice, observeComposition } from '@deepseek-ai/dsh-client-ui-primitives'

const ROW_SELECTOR = '[role="menuitemradio"]:not(:disabled)'

/** Safari sends the Enter that commits pinyin after composition ends, not flagged as composing. */
function useCompositionGuard(): (event: globalThis.KeyboardEvent) => boolean {
  const composition = useRef<ReturnType<typeof observeComposition>>()
  useEffect(() => {
    const observed = observeComposition(document)
    composition.current = observed
    return () => {
      observed.dispose()
    }
  }, [])
  return (event) => composition.current?.guards(event) ?? false
}

/** Where focus goes from `index` (-1 for the field) one step in `step`; -1 means the field. */
function nextIndex(index: number, step: 1 | -1, count: number): number {
  if (index === -1) return step === 1 ? 0 : count - 1
  const next = index + step
  return next < 0 || next >= count ? -1 : next
}

/**
 * Bind the list's keys, and focus the field once the list shows.
 * @param searchRef - the search field.
 * @returns the handler for the element holding the field and the rows.
 */
export function useListKeys(searchRef: RefObject<HTMLInputElement>): (event: KeyboardEvent<HTMLElement>) => void {
  const composing = useCompositionGuard()
  useEffect(() => {
    // A phone would raise its keyboard over the list it just opened.
    if (!isMobileDevice()) searchRef.current?.focus()
  }, [searchRef])
  return (event) => {
    const search = searchRef.current
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    const from = event.target === search ? -1 : rows.findIndex((row) => row === event.target)
    if ((from === -1 && event.target !== search) || composing(event.nativeEvent)) return
    if (event.key === 'Enter' && from === -1) {
      event.preventDefault()
      rows[0]?.click()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : undefined
    if (step === undefined || rows.length === 0) return
    event.preventDefault()
    const next = nextIndex(from, step, rows.length)
    ;(next === -1 ? search : rows[next])?.focus()
  }
}
