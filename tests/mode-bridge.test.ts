import { describe, expect, it, vi } from 'vitest'
import { modeRoutes } from '../src/mode-bridge.ts'
import type { ModeBridgeDeps } from '../src/mode-bridge.ts'
import type { CliModelList, CliSpeedList } from '../src/model-options.ts'

const MODES = {
  configId: 'mode',
  current: 'agent',
  options: [
    { value: 'agent', name: 'Agent' },
    { value: 'read-only', name: 'Read Only' },
  ],
}

const FAST: CliSpeedList = {
  configId: 'fast-mode',
  current: 'off',
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
}

/** What a probe on a model without a fast tier saw. */
const KNOWN_SLOW: CliModelList = {
  configId: 'model',
  current: 'gpt-slow',
  options: [{ value: 'gpt-slow', name: 'GPT Slow' }],
  modes: MODES,
}

const KNOWN: CliModelList = { ...KNOWN_SLOW, current: 'gpt-fast', speed: FAST }

function setup(
  registry: Partial<ModeBridgeDeps['registry']> = {},
  known: () => CliModelList | undefined = () => KNOWN,
) {
  const deps: ModeBridgeDeps = {
    registry: {
      isCliRoute: (provider) => provider === 'cli-codex',
      isLive: () => false,
      selectedModel: () => undefined,
      modeStateFor: () => ({}),
      speedStateFor: () => ({}),
      switchMode: vi.fn(() => Promise.resolve(undefined)),
      switchSpeed: vi.fn(() => Promise.resolve(undefined)),
      ...registry,
    },
    catalog: { known },
  }
  return { deps, routes: modeRoutes(deps) }
}

describe('modeRoutes state', () => {
  it('fills in from the catalog before the CLI starts', () => {
    const { routes } = setup({ speedStateFor: () => ({ pending: 'on' }) })
    expect(routes.modeState('dsh-1', 'cli-codex')).toEqual({ modes: MODES, speed: FAST, speedPending: 'on' })
  })

  // The probe saw the CLI's default model only; another model may have no fast tier at all.
  it('borrows the probed fast mode only for the model the probe saw', () => {
    const on = (model: string | undefined) =>
      setup({ selectedModel: () => model }).routes.modeState('dsh-1', 'cli-codex')
    expect(on('default').speed).toEqual(FAST)
    expect(on('gpt-fast').speed).toEqual(FAST)
    expect(on('gpt-slow')).not.toHaveProperty('speed')
  })

  it("prefers the live CLI's own report", () => {
    const live = { ...FAST, current: 'on' }
    const { routes } = setup({ isLive: () => true, speedStateFor: () => ({ speed: live }) })
    expect(routes.modeState('dsh-1', 'cli-codex').speed).toEqual(live)
  })

  // A live CLI on a model without a fast tier has no fast mode, whatever the probe saw.
  it('shows no fast mode when the live CLI reports none', () => {
    const { routes } = setup({ isLive: () => true })
    expect(routes.modeState('dsh-1', 'cli-codex')).not.toHaveProperty('speed')
  })

  it('shows nothing the catalog does not know', () => {
    const { routes } = setup({}, () => undefined)
    expect(routes.modeState('dsh-1', 'cli-codex')).toEqual({})
  })
})

describe('modeRoutes switching', () => {
  it('passes a fast-mode pick the CLI offers to the registry', async () => {
    const { deps, routes } = setup()
    await routes.switchSpeed('dsh-1', 'cli-codex', 'on')
    expect(deps.registry.switchSpeed).toHaveBeenCalledWith('dsh-1', 'cli-codex', 'on')
  })

  // Stored before the CLI starts, a value it never offered would only fail at the first message.
  it('refuses a fast mode the CLI never offered before storing it', async () => {
    const { deps, routes } = setup()
    await expect(routes.switchSpeed('dsh-1', 'cli-codex', 'turbo')).rejects.toMatchObject({
      code: 'CLI_SPEED_FAILED',
      message: '这个 CLI 没有报告快速模式选项 turbo。',
    })
    expect(deps.registry.switchSpeed).not.toHaveBeenCalled()
  })

  it('refuses a fast mode before any is known', async () => {
    const { routes } = setup({}, () => KNOWN_SLOW)
    await expect(routes.switchSpeed('dsh-1', 'cli-codex', 'on')).rejects.toThrow(
      '还没有读到这个 CLI 的快速模式，请稍后再试。',
    )
  })

  it('checks a mode the same way it always has', async () => {
    const { deps, routes } = setup()
    await expect(routes.switchMode('dsh-1', 'cli-codex', 'yolo')).rejects.toThrow('这个 CLI 没有报告模式 yolo。')
    await routes.switchMode('dsh-1', 'cli-codex', 'read-only')
    expect(deps.registry.switchMode).toHaveBeenCalledWith('dsh-1', 'cli-codex', 'read-only')
  })

  // The registry has its own answer for a route that is not a CLI.
  it('leaves a route that is not a CLI to the registry', async () => {
    const { deps, routes } = setup()
    await routes.switchSpeed('dsh-1', 'deepseek', 'on')
    expect(deps.registry.switchSpeed).toHaveBeenCalledWith('dsh-1', 'deepseek', 'on')
  })
})
