import { describe, expect, it, vi } from 'vitest'
import type { StopReason } from '@agentclientprotocol/sdk'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'
import type { CliSession } from '../src/cli-session.ts'
import type { SteerOutcome } from '../src/transport.ts'
import type { PromptScript } from './fixtures/fake-transport.ts'
import {
  collect,
  finishOf,
  gate,
  never,
  setup,
  setupWith,
  text,
  textOf,
  toolCall,
  toolCallOf,
  toolResult,
  toolUpdate,
  user,
} from './fixtures/cli-session-helpers.ts'

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** A turn that runs one tool, waits for `more`, then says `reply`. */
function toolThen(released: Promise<void>, more: Promise<void>, reply: string): PromptScript {
  return async (t): Promise<StopReason> => {
    t.update(toolCall('a', { status: 'in_progress' }))
    await released
    t.update(toolUpdate('a', { status: 'completed' }))
    await more
    t.update(text(reply))
    return 'end_turn'
  }
}

/** Run the turn's first step up to its tool call and finish the mirror. */
async function firstStep(session: CliSession, release: () => void): Promise<RequestMessage[]> {
  const messages = [user('1', 'go')]
  const first = await collect(session.stream({ messages }))
  release()
  await session.waitForTool(toolCallOf(first).id, never)
  return [...messages, toolResult()]
}

describe('CliSession steering into a running turn', () => {
  it('injects steering into the running turn when the CLI declares support', async () => {
    const released = gate()
    const steered = gate()
    const { fake, session } = setup(toolThen(released.wait, steered.wait, 'changed course'))
    fake.steering = true
    fake.steerScript = () => {
      // The CLI answers the steer before it goes on with the turn.
      setImmediate(steered.open)
      return 'injected'
    }
    const history = await firstStep(session, released.open)
    const second = await collect(session.stream({ messages: [...history, user('2', 'stop that')] }))
    expect(textOf(second)).toBe('changed course')
    expect(finishOf(second)?.reason).toEqual({ kind: 'stop' })
    expect(fake.steered).toEqual([[{ type: 'text', text: 'stop that' }]])
    expect(fake.prompts).toHaveLength(1)
    expect(session.sentMessageIds).toContain('2')
  })

  it('queues steering for a CLI that does not declare support', async () => {
    const released = gate()
    const { fake, session } = setup(toolThen(released.wait, Promise.resolve(), 'first'), (t) => {
      t.update(text('second'))
      return 'end_turn' as const
    })
    const history = await firstStep(session, released.open)
    const second = await collect(session.stream({ messages: [...history, user('2', 'also')] }))
    expect(textOf(second)).toBe('firstsecond')
    expect(fake.steered).toEqual([])
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'also' }])
  })

  it('sends declined steering as the next prompt', async () => {
    const released = gate()
    const answered = gate()
    const { fake, session } = setup(toolThen(released.wait, answered.wait, 'first'), (t) => {
      t.update(text('second'))
      return 'end_turn' as const
    })
    fake.steering = true
    fake.steerScript = () => {
      setImmediate(answered.open)
      return 'declined'
    }
    const history = await firstStep(session, released.open)
    const second = await collect(session.stream({ messages: [...history, user('2', 'also')] }))
    expect(textOf(second)).toBe('firstsecond')
    expect(fake.operations.filter((op) => op === 'prompt' || op === 'steer')).toEqual(['prompt', 'steer', 'prompt'])
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'also' }])
  })

  it('falls back to the next prompt and reports the error when steering fails', async () => {
    const released = gate()
    const answered = gate()
    const onError = vi.fn()
    const { fake, session } = setupWith({ onError }, toolThen(released.wait, answered.wait, 'first'), (t) => {
      t.update(text('second'))
      return 'end_turn' as const
    })
    fake.steering = true
    const failure = new Error('steer refused')
    fake.steerScript = () => {
      setImmediate(answered.open)
      return Promise.reject(failure)
    }
    const history = await firstStep(session, released.open)
    const second = await collect(session.stream({ messages: [...history, user('2', 'also')] }))
    expect(textOf(second)).toBe('firstsecond')
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'also' }])
    expect(onError).toHaveBeenCalledWith(failure)
  })

  // The CLI can finish its turn while the steer is on the wire. The step must wait for
  // the answer instead of finishing, or the declined message would never be sent.
  it('keeps the step open when the turn ends while a declined steer is on the wire', async () => {
    const released = gate()
    const steerSent = gate()
    const answer = gate()
    const { fake, session } = setup(toolThen(released.wait, steerSent.wait, 'first'), (t) => {
      t.update(text('second'))
      return 'end_turn' as const
    })
    fake.steering = true
    fake.steerScript = async (): Promise<SteerOutcome> => {
      steerSent.open()
      await answer.wait
      return 'declined'
    }
    const history = await firstStep(session, released.open)
    const reading = collect(session.stream({ messages: [...history, user('2', 'also')] }))
    await steerSent.wait
    await settle()
    answer.open()
    const second = await reading
    expect(textOf(second)).toBe('firstsecond')
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'also' }])
  })

  it('finishes the step when the turn ends before an accepted steer is answered', async () => {
    const released = gate()
    const steerSent = gate()
    const answer = gate()
    const { fake, session } = setup(toolThen(released.wait, steerSent.wait, 'answered'))
    fake.steering = true
    fake.steerScript = async (): Promise<SteerOutcome> => {
      steerSent.open()
      await answer.wait
      return 'injected'
    }
    const history = await firstStep(session, released.open)
    const reading = collect(session.stream({ messages: [...history, user('2', 'also')] }))
    await steerSent.wait
    await settle()
    answer.open()
    const second = await reading
    expect(textOf(second)).toBe('answered')
    expect(finishOf(second)?.reason).toEqual({ kind: 'stop' })
    expect(fake.prompts).toHaveLength(1)
  })

  // A later message must not overtake an earlier one that the CLI turned away.
  it('keeps order when steering arrives while an earlier steer is on the wire', async () => {
    const released = gate()
    const nextTool = gate()
    const answer = gate()
    const { fake, session } = setup(
      async (t) => {
        t.update(toolCall('a', { status: 'in_progress' }))
        await released.wait
        t.update(toolUpdate('a', { status: 'completed' }))
        t.update(toolCall('b', { status: 'in_progress' }))
        await nextTool.wait
        t.update(toolUpdate('b', { status: 'completed' }))
        await answer.wait
        await settle()
        return 'end_turn' as const
      },
      (t) => {
        t.update(text('two;'))
        return 'end_turn' as const
      },
      (t) => {
        t.update(text('three'))
        return 'end_turn' as const
      },
    )
    fake.steering = true
    const steers: string[] = []
    fake.steerScript = async (blocks): Promise<SteerOutcome> => {
      const [first] = blocks
      steers.push(first?.type === 'text' ? first.text : '')
      if (steers.length === 1) {
        await answer.wait
        return 'declined'
      }
      return 'injected'
    }
    const history = await firstStep(session, released.open)
    const withSecond = [...history, user('2', 'two')]
    const second = await collect(session.stream({ messages: withSecond }))
    nextTool.open()
    await session.waitForTool(toolCallOf(second).id, never)
    const reading = collect(session.stream({ messages: [...withSecond, toolResult(), user('3', 'three')] }))
    await settle()
    answer.open()
    expect(textOf(await reading)).toBe('two;three')
    expect(steers).toEqual(['two'])
    expect(fake.prompts.slice(1)).toEqual([[{ type: 'text', text: 'two' }], [{ type: 'text', text: 'three' }]])
  })

  it('drops a declined steer once the harness has abandoned the turn', async () => {
    const released = gate()
    const steerSent = gate()
    const answer = gate()
    const { fake, session } = setup(toolThen(released.wait, new Promise(() => undefined), 'never'))
    fake.steering = true
    fake.steerScript = async (): Promise<SteerOutcome> => {
      steerSent.open()
      await answer.wait
      return 'declined'
    }
    const history = await firstStep(session, released.open)
    const controller = new AbortController()
    const reading = collect(
      session.stream({ messages: [...history, user('2', 'also')], signal: controller.signal }),
    ).catch((error: unknown) => error)
    await steerSent.wait
    controller.abort()
    await reading
    answer.open()
    await settle()
    expect(fake.prompts).toHaveLength(1)
    expect(fake.cancelled).toEqual(['acp-1'])
  })

  it('does not steer while the running turn is being cancelled', async () => {
    const { fake, session } = setup(
      async (t) => {
        t.update(toolCall('a', { status: 'in_progress' }))
        await new Promise(() => undefined)
        return 'end_turn' as const
      },
      (t) => {
        t.update(text('fresh'))
        return 'end_turn' as const
      },
    )
    fake.steering = true
    await collect(session.stream({ messages: [user('1', 'go')] }))
    session.abandonTurn()
    await expect(collect(session.stream({ messages: [user('1', 'go'), user('2', 'next')] }))).rejects.toThrow(
      '没有响应取消',
    )
    expect(fake.steered).toEqual([])
  })
})
