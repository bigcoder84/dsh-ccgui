import { describe, expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { probeModels } from '../src/model-probe.ts'
import { FakeTransport } from './fixtures/fake-transport.ts'

/**
 * Codex reports a fast mode only for the model a session is on, so the probe switches its
 * throwaway session to each model in turn and keeps what each one reported. Before a session
 * starts, the picker then knows whether the model selected there has a fast tier.
 */

const MODELS = ['sol', 'astra', 'luna', 'terra']
const FAST_MODELS = new Set(['sol', 'astra'])

const fastOption = (current: string): SessionConfigOption => ({
  id: 'fast-mode',
  name: 'Fast mode',
  category: 'speed',
  type: 'select',
  currentValue: current,
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
})

const optionsOn = (model: string): SessionConfigOption[] => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: MODELS.map((value) => ({ value, name: value.toUpperCase() })),
  },
  ...(FAST_MODELS.has(model) ? [fastOption('on')] : []),
]

const FAST = {
  configId: 'fast-mode',
  current: 'on',
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
}

function setup(answer: (value: string) => Promise<readonly SessionConfigOption[] | undefined>, timeoutMs = 1_000) {
  const fake = new FakeTransport()
  fake.configOptions = optionsOn('sol')
  fake.capabilities = { sessionCapabilities: { delete: {} } }
  fake.setConfigAnswer = answer
  return { fake, probe: () => probeModels((handlers) => fake.attach(handlers), '/tmp/x', timeoutMs) }
}

describe('probeModels, fast tier of each model', () => {
  it('switches through the other models, keeps what each reported, and switches back', async () => {
    const { fake, probe } = setup((value) => Promise.resolve(optionsOn(value)))
    const list = await probe()
    expect(list?.current).toBe('sol')
    expect(list?.speed).toEqual(FAST)
    expect(list?.speeds).toEqual({ sol: FAST, astra: FAST, luna: null, terra: null })
    // Put back on the model it started on before it is removed.
    await vi.waitFor(() => {
      expect(fake.deletedSessions).toEqual(['acp-1'])
    })
    expect(fake.setConfigCalls.map(({ configId, value }) => `${configId}=${value}`)).toEqual([
      'model=astra',
      'model=luna',
      'model=terra',
      'model=sol',
    ])
    expect(fake.prompts).toEqual([])
  })

  it('leaves a model it could not switch to unknown, and still learns the rest', async () => {
    const { probe } = setup((value) =>
      value === 'astra' ? Promise.reject(new Error('refused')) : Promise.resolve(optionsOn(value)),
    )
    const list = await probe()
    expect(list?.speeds).toEqual({ sol: FAST, luna: null, terra: null })
  })

  it('leaves a model unknown when the CLI answers a switch without its options', async () => {
    const { probe } = setup((value) => Promise.resolve(value === 'luna' ? undefined : optionsOn(value)))
    expect((await probe())?.speeds).toEqual({ sol: FAST, astra: FAST, terra: null })
  })

  // A CLI slow to switch must not cost the model list, which the menu needs at once.
  it('stops switching when it takes too long, and keeps the list and what it learned', async () => {
    const { probe } = setup(
      (value) => (value === 'luna' ? new Promise<never>(() => undefined) : Promise.resolve(optionsOn(value))),
      200,
    )
    const list = await probe()
    expect(list?.current).toBe('sol')
    expect(list?.speeds).toEqual({ sol: FAST, astra: FAST })
  })

  it('switches nothing for a CLI with one model', async () => {
    const { fake, probe } = setup((value) => Promise.resolve(optionsOn(value)))
    fake.configOptions = [{ ...optionsOn('sol')[0], options: [{ value: 'sol', name: 'SOL' }] } as SessionConfigOption]
    const list = await probe()
    expect(fake.setConfigCalls).toEqual([])
    expect(list?.speeds).toEqual({ sol: null })
  })
})
