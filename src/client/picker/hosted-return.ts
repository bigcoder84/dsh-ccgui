/// <reference lib="dom" />

/**
 * Brings the picker back after a row another plugin added hands over to a list of its own.
 * Codex Subscription's speed and output-detail rows close the picker, move focus into their
 * choices outside it, and on a choice move focus back to the picker's button; that focus is
 * the only sign the choice was made, so it is what reopens the picker. Escape in that list
 * clicks the button instead, which opens the picker without this. A press outside the list,
 * Tab, or focus leaving for nothing means the user went elsewhere, and the picker stays closed.
 * @module dsh-ccgui/client/picker/hosted-return
 */

/** The list focus went into: its menu, or failing that the focused element's parent. */
function listOf(target: EventTarget | null): Element | undefined {
  if (!(target instanceof Element)) return undefined
  return target.closest('[role="menu"]') ?? target.parentElement ?? target
}

/**
 * Wait for the plugin's list to hand focus back to the button, then reopen once.
 * @param button - the picker's button, focused when the list takes over.
 * @param reopen - opens the picker.
 * @returns stops waiting.
 */
export function awaitHandBack(button: HTMLElement, reopen: () => void): () => void {
  const doc = button.ownerDocument
  // Unset until focus moves into the list; a row that opened nothing never sets it.
  let list: Element | undefined
  const onLeave = (event: FocusEvent): void => {
    list = listOf(event.relatedTarget)
    if (list === undefined) stop()
  }
  const onReturn = (): void => {
    if (list === undefined) return
    stop()
    reopen()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab' && !event.shiftKey) stop()
  }
  const onPress = (event: PointerEvent): void => {
    if (list === undefined || !(event.target instanceof Node) || !list.contains(event.target)) stop()
  }
  const stop = (): void => {
    button.removeEventListener('blur', onLeave)
    button.removeEventListener('focus', onReturn)
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('pointerdown', onPress, true)
  }
  button.addEventListener('blur', onLeave)
  button.addEventListener('focus', onReturn)
  doc.addEventListener('keydown', onKey, true)
  doc.addEventListener('pointerdown', onPress, true)
  return stop
}
