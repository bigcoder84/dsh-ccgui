/**
 * Moves the harness's default for new sessions off a CLI being switched off. The harness keeps
 * one default, the last selection made anywhere; left on a CLI that is no longer registered,
 * every new session would open on a provider that cannot answer.
 * @module dsh-ccgui/default-fallback
 */

import { DEFAULT_MODEL_ID } from './constants.ts'

/** A model selection as the harness's default keeps it. */
interface Selection {
  readonly provider: string
  readonly model: string
}

/** The parts of the harness's `agentDefaultModel` service used here. */
export interface DefaultModel {
  currentSelection(): Selection
  saveSelection(next: Selection): Promise<void>
}

/** What choosing a replacement needs to know. */
export interface FallbackDeps {
  /** Absent in a harness that does not offer the service. */
  readonly defaults: DefaultModel | undefined
  readonly isCli: (provider: string) => boolean
  /** Whether a CLI route is configured and switched on. */
  readonly isEnabledCli: (provider: string) => boolean
  /** The first model a harness provider lists, if it lists any. */
  readonly firstModel: (provider: string) => Promise<string | undefined>
}

/**
 * The model a provider would be selected with from the switcher: a CLI's own default, or a
 * harness provider's first model, as the switcher picks them.
 */
async function modelFor(provider: string, deps: FallbackDeps): Promise<string | undefined> {
  if (deps.isCli(provider)) return deps.isEnabledCli(provider) ? DEFAULT_MODEL_ID : undefined
  return deps.firstModel(provider)
}

/**
 * Move the default to the first provider still available, in the switcher's order.
 * @param provider - the CLI route being switched off.
 * @param order - provider ids in the order the switcher shows them.
 * @param deps - the harness's default and what is available.
 * @returns the provider the default moved to, or undefined when it did not move.
 */
export async function moveDefaultOff(
  provider: string,
  order: readonly string[],
  deps: FallbackDeps,
): Promise<string | undefined> {
  const { defaults } = deps
  if (defaults?.currentSelection().provider !== provider) return undefined
  for (const candidate of order.filter((id) => id !== provider)) {
    // One at a time: a harness provider is only asked for its models when it is next in line.
    const model = await modelFor(candidate, deps)
    if (model !== undefined) {
      await defaults.saveSelection({ provider: candidate, model })
      return candidate
    }
  }
  return undefined
}

/**
 * Read the harness's `agentDefaultModel` service, which this plugin does not depend on.
 * @param service - what the harness provides under that name, read as untrusted input.
 * @returns the service, or undefined when it is missing or not the shape expected.
 */
export function readDefaultModel(service: unknown): DefaultModel | undefined {
  if (typeof service !== 'object' || service === null) return undefined
  const { currentSelection, saveSelection } = service as Partial<Record<keyof DefaultModel, unknown>>
  if (typeof currentSelection !== 'function' || typeof saveSelection !== 'function') return undefined
  return service as DefaultModel
}
