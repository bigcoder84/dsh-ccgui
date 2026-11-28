/// <reference lib="dom" />

/**
 * The picker's keyboard shortcut. The harness's shortcut registry owns the key, so users can
 * rebind it and the harness reports conflicts; pressing it toggles the picker of the composer
 * on screen. Several composers can be mounted at once, so each picker says where its button
 * is, and the first one visible answers.
 * @module dsh-ccgui/client/picker/picker-shortcut
 */

/** The parts of the harness's shortcut registry used here. */
export interface ShortcutRegistry {
  register(command: {
    id: string
    label: () => string
    aliases: readonly string[]
    defaults: Readonly<Record<string, { code: string; modifiers: readonly string[] }>>
    regions: readonly string[]
    modals: readonly string[]
    resolve: (context: unknown) => { status: 'handled'; run: () => void } | { status: 'pass' }
  }): () => void
}

interface Mounted {
  readonly button: () => HTMLElement | null
  readonly toggle: () => void
}

const COMMAND_ID = 'dsh-ccgui.picker.toggle'
const COMMAND_LABEL = '选择模型和思考深度'
/**
 * Desktop only: the harness refuses Control+Shift+M as a web default, and one refused default
 * fails the whole registration. On the web the command is listed without a key to bind.
 */
const DEFAULTS = {
  'desktop:macos': { code: 'KeyM', modifiers: ['control', 'shift'] },
  'desktop:windows': { code: 'KeyM', modifiers: ['primary', 'shift'] },
  'desktop:linux': { code: 'KeyM', modifiers: ['primary', 'shift'] },
} as const

let mounted: readonly Mounted[] = []

const visible = (element: HTMLElement | null): boolean => element !== null && element.getClientRects().length > 0
const onScreen = (): Mounted | undefined => mounted.find((entry) => visible(entry.button()))

/**
 * Say where a picker's button is, so the shortcut can reach it.
 * @param entry - the button, read when the shortcut fires, and what toggles the picker.
 * @returns forgets the picker.
 */
export function mountPicker(entry: Mounted): () => void {
  mounted = [...mounted, entry]
  return () => {
    mounted = mounted.filter((candidate) => candidate !== entry)
  }
}

/**
 * Toggle the picker of the composer on screen.
 * @returns whether a picker answered.
 */
export function togglePicker(): boolean {
  const target = onScreen()
  target?.toggle()
  return target !== undefined
}

/**
 * Register the shortcut with the harness.
 * @param registry - the harness's shortcut registry.
 * @returns removes the command.
 */
export function registerPickerShortcut(registry: ShortcutRegistry): () => void {
  return registry.register({
    id: COMMAND_ID,
    label: () => COMMAND_LABEL,
    aliases: ['model', '模型', 'reasoning', '思考深度'],
    defaults: DEFAULTS,
    regions: ['page', 'editable'],
    modals: [],
    // With no composer on screen the key is left to whatever else wants it.
    resolve: () =>
      onScreen() === undefined ? { status: 'pass' } : { status: 'handled', run: () => void togglePicker() },
  })
}
