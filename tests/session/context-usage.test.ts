import { describe, expect, it } from 'vitest'
import { readContextUsage } from '../../src/session/context-usage.ts'

describe('readContextUsage', () => {
  it('reads the tokens in context and the window size', () => {
    expect(readContextUsage({ used: 90_000, size: 200_000 })).toEqual({
      used: 90_000,
      size: 200_000,
    })
  })

  // The SDK does not validate what a CLI sends; a bad figure must not reach the meter.
  it.each([
    ['no window', { used: 10, size: 0 }],
    ['a negative count', { used: -1, size: 100 }],
    ['a count that is not a number', { used: '10', size: 100 }],
    ['a window that is not finite', { used: 10, size: Number.POSITIVE_INFINITY }],
  ])('ignores %s', (_name, fields) => {
    expect(readContextUsage(fields)).toBeUndefined()
  })
})
