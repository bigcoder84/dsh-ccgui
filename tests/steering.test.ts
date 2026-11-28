import { describe, expect, it } from 'vitest'
import { declaresSteering, readSteerOutcome, steeringParams } from '../src/steering.ts'

describe('steering extension', () => {
  it('reads support only from an explicit announcement', () => {
    expect(declaresSteering({ steering: { supported: true } })).toBe(true)
    expect(declaresSteering({ steering: { supported: 'yes' } })).toBe(false)
    expect(declaresSteering({ steering: true })).toBe(false)
    expect(declaresSteering({})).toBe(false)
    expect(declaresSteering(null)).toBe(false)
    expect(declaresSteering(undefined)).toBe(false)
  })

  // Codex adds a `failed` outcome; anything but an injection leaves the message unsent.
  it('takes only an injection as delivered', () => {
    expect(readSteerOutcome({ outcome: 'injected' })).toBe('injected')
    expect(readSteerOutcome({ outcome: 'promptRequired', reason: 'noRunningTurn' })).toBe('declined')
    expect(readSteerOutcome({ outcome: 'failed' })).toBe('declined')
    expect(readSteerOutcome({ outcome: 'startedNewTurn' })).toBe('declined')
    expect(readSteerOutcome(null)).toBe('declined')
    expect(readSteerOutcome('injected')).toBe('declined')
  })

  it('opts into the host-owned fallback and copies the input', () => {
    const blocks = [{ type: 'text' as const, text: 'stop' }]
    const params = steeringParams('s1', blocks)
    expect(params).toEqual({
      sessionId: 's1',
      prompt: blocks,
      _meta: { steering: { idleBehavior: 'promptRequired' } },
    })
    expect(params.prompt).not.toBe(blocks)
  })
})
