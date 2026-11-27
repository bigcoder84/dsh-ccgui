import { describe, expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { SpeedState } from '../../src/session/speed-state.ts'
import type { ModelTarget } from '../../src/session/model-state.ts'
import type { CliSpeedList } from '../../src/model-options.ts'
import { FakeTransport } from '../fixtures/fake-transport.ts'

const OFF: CliSpeedList = {
  configId: 'fast-mode',
  current: 'off',
  options: [
    { value: 'off', name: 'Off' },
    { value: 'on', name: 'On' },
  ],
}

const model = (current = 'gpt-fast'): SessionConfigOption => ({
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

const fast = (current: string): SessionConfigOption => ({
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

function target(fake: FakeTransport): ModelTarget {
  return { transport: fake, acpSessionId: 'acp-1', label: 'Codex CLI' }
}

describe('SpeedState.observe', () => {
  it('follows the fast mode the CLI reports', () => {
    const state = new SpeedState(() => OFF, vi.fn())
    expect(state.observe([model(), fast('on')])?.current).toBe('on')
  })

  // codex-acp drops the option when the new model has no fast tier, and a toggle left on
  // screen would claim a speed the CLI no longer runs at.
  it('forgets the fast mode when a full report leaves it out', () => {
    const state = new SpeedState(() => OFF, vi.fn())
    expect(state.observe([model('gpt-slow')])).toBeUndefined()
  })

  // A report without the model option may describe only what changed.
  it('keeps what it knows when a report carries neither the model nor the fast mode', () => {
    const state = new SpeedState(() => OFF, vi.fn())
    expect(state.observe([])).toEqual(OFF)
  })

  it('clears a pick once the CLI reports it', () => {
    const state = new SpeedState(() => OFF, vi.fn(), 'on')
    state.observe([model(), fast('on')])
    expect(state.pending).toBeUndefined()
  })
})

describe('SpeedState.apply', () => {
  it('sends the pick under the id the CLI reported', async () => {
    const fake = new FakeTransport()
    fake.setConfigResult = [model(), fast('on')]
    const report = vi.fn()
    const state = new SpeedState(() => OFF, report)
    state.choose('on')
    await state.apply(target(fake), undefined)
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'fast-mode', value: 'on' }])
    expect(report).toHaveBeenCalledWith(fake.setConfigResult)
    expect(state.pending).toBeUndefined()
  })

  it('refuses a value the CLI never offered', () => {
    const state = new SpeedState(() => OFF, vi.fn())
    expect(() => {
      state.choose('turbo')
    }).toThrow('这个 CLI 没有报告快速模式选项 turbo。')
  })

  it('refuses a pick before any fast mode is known', () => {
    const state = new SpeedState(() => undefined, vi.fn())
    expect(() => {
      state.choose('on')
    }).toThrow('还没有读到这个 CLI 的快速模式，请稍后再试。')
  })

  it('names the change the CLI refused', async () => {
    const fake = new FakeTransport()
    fake.setConfigError = new Error('no')
    const state = new SpeedState(() => OFF, vi.fn())
    state.choose('on')
    await expect(state.apply(target(fake), undefined)).rejects.toThrow('Codex CLI 无法开启快速模式：no')
    expect(state.pending).toBeUndefined()
  })
})

describe('SpeedState.settle', () => {
  it('reports a refused pick as a notice naming the speed the message runs at', async () => {
    const fake = new FakeTransport()
    fake.setConfigError = new Error('no')
    const state = new SpeedState(() => OFF, vi.fn(), 'on')
    const refusal = await state.settle(target(fake), undefined)
    expect(refusal?.value).toBe('on')
    expect(refusal?.notice).toBe(
      '（Codex CLI 无法开启快速模式：no。这条消息按 CLI 当前的设置（快速模式关闭）发送，可以用输入框旁的「快速」开关重新切换。）\n\n',
    )
  })

  // Kept, the pick would turn fast mode on unasked the moment a later turn moved to a model
  // with a fast tier; the user is told now, while it is about this message.
  it('refuses a pick to turn it on when the model the turn runs on has no fast mode', async () => {
    const fake = new FakeTransport()
    const state = new SpeedState(() => undefined, vi.fn(), 'on')
    const refusal = await state.settle(target(fake), undefined)
    expect(refusal).toEqual({
      value: 'on',
      notice: '（Codex CLI 无法开启快速模式：当前模型不支持快速模式。这条消息按普通速度发送。）\n\n',
    })
    expect(state.pending).toBeUndefined()
    expect(fake.setConfigCalls).toEqual([])
  })

  // A model without a fast tier already runs at normal speed, which is what was asked for.
  it('drops a pick to turn it off without a word when the model has no fast mode', async () => {
    const fake = new FakeTransport()
    const state = new SpeedState(() => undefined, vi.fn(), 'off')
    await expect(state.settle(target(fake), undefined)).resolves.toBeUndefined()
    expect(state.pending).toBeUndefined()
  })
})
