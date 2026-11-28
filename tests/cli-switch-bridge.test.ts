import { describe, expect, it, vi } from 'vitest'
import { CliSwitchBridge } from '../src/cli-switch-bridge.ts'
import type { SwitchBridgeDeps } from '../src/cli-switch-bridge.ts'
import { CliSwitches } from '../src/cli-switches.ts'

const LABELS: Record<string, string> = { 'cli-claude': 'Claude Code', 'cli-codex': 'Codex CLI', 'cli-kimi': 'Kimi CLI' }

function setup({ stored, current = 'cli-claude' }: { stored?: readonly string[]; current?: string } = {}) {
  const switches = new CliSwitches(Object.keys(LABELS), stored, () => Promise.resolve())
  const replace = vi.fn((_providers: string[]) => {})
  const register = vi.fn((_providers: string[]) => ({ replace }))
  const saveSelection = vi.fn(() => Promise.resolve())
  const deps: SwitchBridgeDeps = {
    switches,
    registry: { labelFor: (provider) => LABELS[provider], stopProvider: vi.fn() },
    register,
    defaults: () => ({ currentSelection: () => ({ provider: current, model: 'default' }), saveSelection }),
    firstModel: () => Promise.resolve('deepseek-v4'),
  }
  const bridge = new CliSwitchBridge(deps)
  return { bridge, deps, register, replace, saveSelection, switches }
}

describe('CliSwitchBridge', () => {
  it('registers the CLIs that are on, and none of those switched off', () => {
    const { bridge, register } = setup({ stored: ['cli-kimi'] })
    bridge.publish()
    expect(register).toHaveBeenCalledWith(['cli-claude', 'cli-codex'])
  })

  // An adapter cannot be registered with no routes, so it waits for the first CLI turned on.
  it('registers nothing while every CLI is off, then registers the first one turned on', async () => {
    const { bridge, register } = setup({ stored: ['cli-claude', 'cli-codex', 'cli-kimi'] })
    bridge.publish()
    expect(register).not.toHaveBeenCalled()
    await bridge.set('cli-kimi', true, [])
    expect(register).toHaveBeenCalledWith(['cli-kimi'])
  })

  it('takes a CLI switched off out of the registration and stops its sessions', async () => {
    const { bridge, deps, replace } = setup()
    bridge.publish()
    await bridge.set('cli-kimi', false, [])
    expect(replace).toHaveBeenCalledWith(['cli-claude', 'cli-codex'])
    expect(deps.registry.stopProvider).toHaveBeenCalledWith('cli-kimi', '已在 CC GUI 设置里关闭')
  })

  it('puts a CLI switched back on into the registration', async () => {
    const { bridge, replace } = setup({ stored: ['cli-kimi'] })
    bridge.publish()
    await bridge.set('cli-kimi', true, [])
    expect(replace).toHaveBeenCalledWith(['cli-claude', 'cli-codex', 'cli-kimi'])
  })

  it('moves the default for new sessions off a CLI switched off', async () => {
    const { bridge, saveSelection } = setup({ current: 'cli-codex' })
    bridge.publish()
    await bridge.set('cli-codex', false, ['deepseek-official', 'cli-claude'])
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4' })
  })

  it('changes nothing when the switch is already that way', async () => {
    const { bridge, deps, replace } = setup()
    bridge.publish()
    await bridge.set('cli-codex', true, [])
    expect(replace).not.toHaveBeenCalled()
    expect(deps.registry.stopProvider).not.toHaveBeenCalled()
  })

  it('lists every configured CLI with its switch, by its name', () => {
    const { bridge } = setup({ stored: ['cli-kimi'] })
    expect(bridge.list()).toEqual({
      clis: [
        { id: 'cli-claude', label: 'Claude Code', enabled: true },
        { id: 'cli-codex', label: 'Codex CLI', enabled: true },
        { id: 'cli-kimi', label: 'Kimi CLI', enabled: false },
      ],
      saved: true,
    })
  })

  it('takes over a browser list once, and applies it', async () => {
    const { bridge, replace } = setup()
    bridge.publish()
    await bridge.adopt(['cli-kimi'])
    expect(replace).toHaveBeenCalledWith(['cli-claude', 'cli-codex'])
    expect(bridge.list().saved).toBe(true)
  })
})
