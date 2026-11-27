/**
 * What the composer's mode route reads and changes, put together from the live CLI sessions
 * and the catalog. A live CLI's own report wins; before it starts, the catalog's last answer
 * for that route fills in. A pick made before the CLI starts is only stored, so it is checked
 * here against what that CLI reported: a value it never offered would otherwise wait for the
 * first message and fail there.
 * @module dsh-ccgui/mode-bridge
 */

import { DEFAULT_MODEL_ID } from './constants.ts'
import type { CliChoiceList, CliModelList, CliSpeedList } from './model-options.ts'
import type { ModeRoutes, ModeRouteState } from './mode-routes.ts'
import type { CliSessionRegistry } from './session-registry.ts'
import { assertOffered } from './session/choice-state.ts'
import type { ChoiceKind } from './session/choice-state.ts'
import { MODE_KIND } from './session/mode-state.ts'
import { SPEED_KIND } from './session/speed-state.ts'

/** What the route needs from the bridge. */
export interface ModeBridgeDeps {
  readonly registry: Pick<
    CliSessionRegistry,
    'isCliRoute' | 'isLive' | 'selectedModel' | 'modeStateFor' | 'speedStateFor' | 'switchMode' | 'switchSpeed'
  >
  readonly catalog: { known(provider: string): CliModelList | undefined }
}

/**
 * The fast mode a probe saw belongs to the model it ran on, the CLI's default. A session that
 * has selected another model may find no fast tier there, so it borrows nothing until its CLI
 * starts and reports for itself.
 */
function probedSpeed(known: CliModelList | undefined, model: string | undefined): CliSpeedList | undefined {
  if (known === undefined) return undefined
  return model === undefined || model === DEFAULT_MODEL_ID || model === known.current ? known.speed : undefined
}

/**
 * Build what the mode route reads and changes.
 * @param deps - the live sessions and the catalog.
 * @returns the route's view of a session's CLI settings.
 */
export function modeRoutes({ registry, catalog }: ModeBridgeDeps): ModeRoutes {
  const modeState = (sessionId: string, provider: string): ModeRouteState => {
    const { modes, pending } = registry.modeStateFor(sessionId, provider)
    const { speed, pending: speedPending } = registry.speedStateFor(sessionId, provider)
    const known = catalog.known(provider)
    // A live CLI's fast mode belongs to the model it is on, and may be gone; only a CLI not
    // started yet borrows the catalog's.
    const shownSpeed = registry.isLive(sessionId, provider)
      ? speed
      : probedSpeed(known, registry.selectedModel(sessionId))
    const shownModes = modes ?? known?.modes
    return {
      ...(shownModes === undefined ? {} : { modes: shownModes }),
      ...(pending === undefined ? {} : { pending }),
      ...(shownSpeed === undefined ? {} : { speed: shownSpeed }),
      ...(speedPending === undefined ? {} : { speedPending }),
    }
  }
  const check = (kind: ChoiceKind, list: CliChoiceList | undefined, provider: string, value: string): void => {
    if (registry.isCliRoute(provider)) assertOffered(kind, list, value)
  }
  return {
    modeState,
    switchMode: async (sessionId, provider, mode) => {
      check(MODE_KIND, modeState(sessionId, provider).modes, provider, mode)
      return registry.switchMode(sessionId, provider, mode)
    },
    switchSpeed: async (sessionId, provider, value) => {
      check(SPEED_KIND, modeState(sessionId, provider).speed, provider, value)
      return registry.switchSpeed(sessionId, provider, value)
    },
  }
}
