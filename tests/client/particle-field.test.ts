// @vitest-environment jsdom
/// <reference lib="dom" />

import { describe, expect, it, vi } from 'vitest'
import { startParticles } from '../../src/client/picker/particle-field.ts'
import type { ParticleClock } from '../../src/client/picker/particle-field.ts'

/** A host for the field, with a 2D context that records what was drawn; jsdom has no canvas of its own. */
function canvas() {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 200 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 30 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return { element: document.createElement('div'), context }
}

function clock(reducedMotion = false) {
  const steps: (() => void)[] = []
  const fake: ParticleClock & { steps: (() => void)[] } = {
    steps,
    request: vi.fn((step: () => void) => steps.push(step)),
    cancel: vi.fn(),
    reducedMotion,
  }
  return fake
}

describe('startParticles', () => {
  it('draws a frame at once and keeps animating until stopped', () => {
    const { element, context } = canvas()
    const frames = clock()
    const stop = startParticles(element, () => ({ intensity: 0, top: false }), frames)
    expect(context.arc).toHaveBeenCalledTimes(5)
    frames.steps.at(-1)?.()
    expect(frames.request).toHaveBeenCalledTimes(2)
    expect(element.querySelector('canvas')).not.toBeNull()
    stop()
    expect(frames.cancel).toHaveBeenCalledWith(2)
    expect(element.querySelector('canvas')).toBeNull()
  })

  it('shows more points as the level rises, and a burst more at the top', () => {
    const { element, context } = canvas()
    startParticles(element, () => ({ intensity: 1, top: true }), clock())
    expect(context.arc).toHaveBeenCalledTimes(5 + 18 + 8)
  })

  // Users who ask for less motion still see the field, just not moving.
  it('draws one still frame when the user asks for reduced motion', () => {
    const { element, context } = canvas()
    const frames = clock(true)
    const stop = startParticles(element, () => ({ intensity: 0.5, top: false }), frames)
    expect(context.arc).toHaveBeenCalled()
    expect(frames.request).not.toHaveBeenCalled()
    stop()
    expect(frames.cancel).not.toHaveBeenCalled()
  })
})
