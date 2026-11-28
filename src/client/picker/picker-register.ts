/**
 * Puts the model picker in the composer, in the seat the harness's own model control takes,
 * for every session, and registers its shortcut and the harness's teamwork remote it writes
 * through. Both are optional services: a harness without them keeps the picker, only without
 * the shortcut or the teamwork row.
 * @module dsh-ccgui/client/picker/picker-register
 */

import type { CliPrefs } from '../cli-prefs.ts'
import type { LastSelections } from '../last-selections.ts'
import type { ModeApi } from '../mode-api.ts'
import { CliPicker } from './picker.tsx'
import type { PickerInjected } from './picker.tsx'
import { registerPickerShortcut } from './picker-shortcut.ts'
import type { ShortcutRegistry } from './picker-shortcut.ts'
import type { HostSlots } from './hosted-slots.tsx'
import type { TeamApi } from './use-picker-actions.ts'

/** The harness's teamwork remote, as far as the picker uses it. */
interface AgentTeamsRemote {
  setEnabled(
    sessionId: string,
    enabled: boolean,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>
}

interface Slots extends HostSlots {
  inject(name: string, add: () => unknown): void
  register(
    options: { name: string; id: string; order?: number; inject(sessionId: string): unknown },
    component: unknown,
  ): unknown
}

/** The parts of the harness's client context the picker uses. */
export interface PickerContext {
  slots: Slots
  effect(run: () => () => void, label?: string): void
  inject(
    deps: readonly string[],
    apply: (
      child: PickerContext & { shortcuts?: ShortcutRegistry; remote?: { agentTeams?: AgentTeamsRemote } },
    ) => void,
  ): unknown
}

/** What the picker needs for one session that the plugin's entry assembles. */
export interface PickerFace {
  readonly face: (sessionId: string) => Pick<PickerInjected, 'directory' | 'load' | 'select' | 'session'>
  readonly available: (sessionId: string) => boolean
  readonly modes: (sessionId: string) => ModeApi
  readonly prefs: CliPrefs
  readonly lastSelections: LastSelections
}

/** The composer's right-hand seat, where the harness's own model control sits. */
const SLOT = 'conversation.input.right'
/** Last in its slot, which is where the harness's own control would be. */
const ORDER = 1000
const UNAVAILABLE = '当前环境不支持修改智能体团队协作'

/**
 * Register the picker, its shortcut and its teamwork writer.
 * @param ctx - the plugin's client context.
 * @param deps - what the picker reads for each session.
 */
export function registerPicker(ctx: PickerContext, deps: PickerFace): void {
  // The remote arrives as its own service and can come and go; the picker reads it per call.
  let agentTeams: AgentTeamsRemote | undefined
  ctx.inject(['remote', 'remote.agentTeams'], (child) => {
    child.effect(() => {
      agentTeams = child.remote?.agentTeams
      return () => {
        agentTeams = undefined
      }
    }, 'ccgui: picker teamwork')
  })
  ctx.inject(['shortcuts'], (child) => {
    const { shortcuts } = child
    if (shortcuts !== undefined) child.effect(() => registerPickerShortcut(shortcuts), 'ccgui: picker shortcut')
  })
  const teamFor = (sessionId: string): TeamApi => ({
    set: async (enabled) => {
      if (agentTeams === undefined) return UNAVAILABLE
      const response = await agentTeams.setEnabled(sessionId, enabled)
      return response.ok ? null : response.error.message
    },
  })
  ctx.slots.inject(SLOT, () =>
    ctx.slots.register(
      {
        name: SLOT,
        id: 'dsh-ccgui.picker',
        order: ORDER,
        inject: (sessionId): Omit<PickerInjected, 'useProjection'> => ({
          ...deps.face(sessionId),
          available: deps.available(sessionId),
          prefs: deps.prefs,
          lastSelections: deps.lastSelections,
          modes: deps.modes(sessionId),
          team: teamFor(sessionId),
          slots: ctx.slots,
        }),
      },
      CliPicker,
    ),
  )
}
