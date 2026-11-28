/**
 * Applies the CLI switches to the harness. Only the CLIs switched on are registered as
 * providers; switching one off takes it out of the registration at once, stops what it is
 * running and moves the default for new sessions off it. Serves the settings page's route.
 * @module dsh-ccgui/cli-switch-bridge
 */

import type { CliSwitchList, CliSwitchRoutes } from './cli-switch-routes.ts'
import type { CliSwitches } from './cli-switches.ts'
import { isCliRoute } from './constants.ts'
import { moveDefaultOff } from './default-fallback.ts'
import type { DefaultModel } from './default-fallback.ts'

/** Shown to a turn cut off because its CLI was switched off. */
const STOP_REASON = '已在 CC GUI 设置里关闭'

/** What `ctx.llm.registerAdapter` returns, as far as this module uses it. */
interface Registration {
  replace(providers: string[]): void
}

/** What the bridge needs from the plugin. */
export interface SwitchBridgeDeps {
  readonly switches: CliSwitches
  readonly registry: {
    labelFor(provider: string): string | undefined
    stopProvider(provider: string, reason: string): void
  }
  /** Registers the CLI adapter for these routes; an adapter cannot start with none. */
  readonly register: (providers: string[]) => Registration
  /** The harness's default for new sessions, read when needed; absent when it offers none. */
  readonly defaults: () => DefaultModel | undefined
  /** The first model a harness provider lists, if it lists any. */
  readonly firstModel: (provider: string) => Promise<string | undefined>
}

/** Keeps the registration in step with the switches. */
export class CliSwitchBridge implements CliSwitchRoutes {
  private registration: Registration | undefined

  constructor(private readonly deps: SwitchBridgeDeps) {}

  /** Register the CLIs switched on, or swap the registered set for them. */
  publish(): void {
    const enabled = [...this.deps.switches.enabled()]
    if (this.registration !== undefined) {
      this.registration.replace(enabled)
      return
    }
    if (enabled.length > 0) this.registration = this.deps.register(enabled)
  }

  /** @returns every configured CLI with its switch. */
  list(): CliSwitchList {
    const { switches, registry } = this.deps
    const clis = switches.configured().map((id) => ({
      id,
      label: registry.labelFor(id) ?? id,
      enabled: switches.isEnabled(id),
    }))
    return { clis, saved: switches.everSaved }
  }

  /**
   * Switch one CLI on or off.
   * @param provider - a configured CLI route.
   * @param enabled - whether it should be on.
   * @param order - the switcher's provider order, to choose where the default goes.
   */
  async set(provider: string, enabled: boolean, order: readonly string[]): Promise<void> {
    const { switches, registry } = this.deps
    if (!(await switches.set(provider, enabled))) return
    this.publish()
    if (enabled) return
    registry.stopProvider(provider, STOP_REASON)
    await moveDefaultOff(provider, order, {
      defaults: this.deps.defaults(),
      isCli: isCliRoute,
      isEnabledCli: (candidate) => switches.isEnabled(candidate),
      firstModel: this.deps.firstModel,
    })
  }

  /**
   * Take over a list a browser kept before the switches moved here.
   * @param disabled - the CLIs that list left out.
   */
  async adopt(disabled: readonly string[]): Promise<void> {
    if (await this.deps.switches.adopt(disabled)) this.publish()
  }
}
