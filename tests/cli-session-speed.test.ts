import { describe, expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { CliModelList } from '../src/model-options.ts'
import { collect, finishOf, setupWith, textOf, user } from './fixtures/cli-session-helpers.ts'

const modelOption = (current = 'gpt-fast'): SessionConfigOption => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: current,
  options: [
    { value: 'gpt-fast', name: 'GPT Fast' },
    { value: 'gpt-slow', name: 'GPT Slow' },
  ],
})

/** As codex-acp reports it while the active model has a fast tier. */
const fastOption = (current = 'off'): SessionConfigOption => ({
  id: 'fast-mode',
  name: 'Fast mode',
  category: 'model_config',
  type: 'select',
  currentValue: current,
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
})

const known: CliModelList = {
  configId: 'model',
  current: 'gpt-fast',
  options: [{ value: 'gpt-fast', name: 'GPT Fast' }],
  speed: {
    configId: 'fast-mode',
    current: 'off',
    options: [
      { value: 'off', name: 'Off' },
      { value: 'on', name: 'On' },
    ],
  },
}

const end = () => 'end_turn' as const

describe('CliSession fast mode', () => {
  it('knows the fast mode from the catalog before the CLI starts', () => {
    const { session } = setupWith({ knownModels: () => known }, end)
    expect(session.speed).toEqual(known.speed)
    expect(session.pendingSpeed).toBeUndefined()
  })

  it('switches a running CLI at once', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption(), fastOption()]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigResult = [modelOption(), fastOption('on')]
    await expect(session.switchSpeed('on')).resolves.toMatchObject({ current: 'on' })
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'fast-mode', value: 'on' }])
    expect(session.speed?.current).toBe('on')
  })

  // There is no CLI session to change before the first message.
  it('holds a pick made before the CLI started and sends it with the first message', async () => {
    const { fake, session } = setupWith({ knownModels: () => known }, end)
    fake.configOptions = [modelOption(), fastOption()]
    fake.setConfigResult = [modelOption(), fastOption('on')]
    await expect(session.switchSpeed('on')).resolves.toMatchObject({ current: 'off' })
    expect(session.pendingSpeed).toBe('on')
    expect(fake.setConfigCalls).toEqual([])
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'fast-mode', value: 'on' }])
    expect(session.pendingSpeed).toBeUndefined()
  })

  it('starts on a pick handed over from the session it replaces', async () => {
    const { fake, session } = setupWith({ knownModels: () => known, initialSpeed: 'on' }, end)
    fake.configOptions = [modelOption(), fastOption()]
    fake.setConfigResult = [modelOption(), fastOption('on')]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'fast-mode', value: 'on' }])
  })

  // A model is applied first, and switching to one without a fast tier takes the option away.
  it('drops the fast mode once the CLI moves to a model without it', async () => {
    const { fake, session } = setupWith({}, end, end)
    fake.configOptions = [modelOption(), fastOption('on')]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(session.speed?.current).toBe('on')
    fake.setConfigResult = [modelOption('gpt-slow')]
    await collect(session.stream({ messages: [user('1', 'hi'), user('2', 'again')], model: 'gpt-slow' }))
    expect(session.speed).toBeUndefined()
  })

  it('follows a fast mode the CLI changed by itself', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption(), fastOption()]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.update({ sessionUpdate: 'config_option_update', configOptions: [modelOption(), fastOption('on')] })
    expect(session.speed?.current).toBe('on')
  })

  it('sends the message anyway when the CLI refuses the pick, and says so', async () => {
    const onSpeedRefused = vi.fn((_value: string) => {})
    const { fake, session } = setupWith({ knownModels: () => known, initialSpeed: 'on', onSpeedRefused }, end)
    fake.configOptions = [modelOption(), fastOption()]
    fake.setConfigError = new Error('tier unavailable')
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(textOf(chunks)).toContain('OpenCode 无法开启快速模式：tier unavailable')
    expect(textOf(chunks)).toContain('快速模式关闭')
    expect(finishOf(chunks)?.reason.kind).toBe('stop')
    expect(fake.prompts).toHaveLength(1)
    expect(onSpeedRefused).toHaveBeenCalledWith('on')
    expect(session.pendingSpeed).toBeUndefined()
  })

  it('refuses a value the CLI never offered', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption(), fastOption()]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    await expect(session.switchSpeed('turbo')).rejects.toMatchObject({ code: 'CLI_SPEED_FAILED' })
    expect(fake.setConfigCalls).toEqual([])
  })

  // The model is applied first; once it has no fast tier, the pick made for the default model
  // cannot apply, and must not linger to turn fast mode on for some later model.
  it('refuses a pick when the model the first message runs on has no fast mode', async () => {
    const onSpeedRefused = vi.fn((_value: string) => {})
    const { fake, session } = setupWith({ knownModels: () => known, initialSpeed: 'on', onSpeedRefused }, end)
    fake.configOptions = [modelOption(), fastOption()]
    fake.setConfigResult = [modelOption('gpt-slow')]
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')], model: 'gpt-slow' }))
    expect(textOf(chunks)).toContain('OpenCode 无法开启快速模式：当前模型不支持快速模式。这条消息按普通速度发送。')
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'model', value: 'gpt-slow' }])
    expect(onSpeedRefused).toHaveBeenCalledWith('on')
    expect(session.pendingSpeed).toBeUndefined()
  })
})
