/// <reference lib="dom" />

/**
 * The drifting, twinkling points inside the reasoning slider's filled part. More and faster
 * as the level rises, a burst more at the top level. Runs only while it is shown, and draws
 * one still frame instead when the user asks for reduced motion.
 * @module dsh-ccgui/client/picker/particle-field
 */

/** How lively the field is: 0 at the lowest level, 1 at the highest. */
export interface ParticleLevel {
  readonly intensity: number
  readonly top: boolean
}

/** What the field needs from the page, so tests can hand in a frame clock of their own. */
export interface ParticleClock {
  readonly request: (step: () => void) => number
  readonly cancel: (handle: number) => void
  readonly reducedMotion: boolean
}

interface Dot {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly speed: number
  readonly phase: number
  readonly twinkle: number
}

/** The canvas the field draws on; picker-styles.ts makes it fill the slider's filled part. */
export const PARTICLE_CANVAS_CLASS = 'dsh-cli-picker-particles'

const BASE_DOTS = 5
const DOTS_PER_LEVEL = 18
const TOP_EXTRA_DOTS = 8
const BASE_SPEED = 0.6
const SPEED_PER_LEVEL = 1.6
const TOP_EXTRA_SPEED = 0.8
const EDGE = 3
const FULL_TURN = Math.PI * 2

function spawn(width: number, height: number, x = Math.random() * width): Dot {
  return {
    x,
    y: EDGE + Math.random() * Math.max(0, height - EDGE * 2),
    radius: 0.4 + Math.random() * 0.9,
    speed: 0.15 + Math.random() * 0.45,
    phase: Math.random() * FULL_TURN,
    twinkle: 0.03 + Math.random() * 0.05,
  }
}

const countFor = ({ intensity, top }: ParticleLevel): number =>
  Math.round(BASE_DOTS + intensity * DOTS_PER_LEVEL + (top ? TOP_EXTRA_DOTS : 0))
const speedFor = ({ intensity, top }: ParticleLevel): number =>
  BASE_SPEED + intensity * SPEED_PER_LEVEL + (top ? TOP_EXTRA_SPEED : 0)

/** The dots one frame on: as many as the level wants, moved, the ones gone right back at the left. */
function nextDots(dots: readonly Dot[], level: ParticleLevel, width: number, height: number): readonly Dot[] {
  const want = countFor(level)
  const kept = dots.slice(0, want)
  const all = [...kept, ...Array.from({ length: want - kept.length }, () => spawn(width, height))]
  const speed = speedFor(level)
  return all.map((dot) => {
    const x = dot.x + dot.speed * speed
    return x > width ? spawn(width, height, 0) : { ...dot, x, phase: dot.phase + dot.twinkle }
  })
}

const alphaOf = (dot: Dot): string => (0.25 + 0.65 * (0.5 + 0.5 * Math.sin(dot.phase))).toFixed(3)

/**
 * Animate the field in the slider's filled part until the returned function is called. The
 * field draws on a canvas of its own, which it puts in `host` and takes out again.
 * @param host - the filled part; the canvas fills it.
 * @param level - read every frame, so the field follows the slider as it moves.
 * @param clock - the frame clock and the user's motion preference.
 * @returns stops the animation and removes the canvas.
 */
export function startParticles(host: HTMLElement, level: () => ParticleLevel, clock: ParticleClock): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = PARTICLE_CANVAS_CLASS
  host.append(canvas)
  let dots: readonly Dot[] = []
  let handle: number | undefined
  const step = (): void => {
    // Matched to the box every frame, so the points stay sharp on any display and any width.
    const { clientWidth: width, clientHeight: height } = canvas
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const context = canvas.getContext('2d')
    if (context !== null) {
      dots = nextDots(dots, level(), width, height)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      for (const dot of dots) {
        context.beginPath()
        context.arc(dot.x, dot.y, dot.radius, 0, FULL_TURN)
        context.fillStyle = `rgba(255, 255, 255, ${alphaOf(dot)})`
        context.fill()
      }
    }
    if (!clock.reducedMotion) handle = clock.request(step)
  }
  step()
  return () => {
    if (handle !== undefined) clock.cancel(handle)
    canvas.remove()
  }
}

/**
 * The browser's frame clock and the user's motion preference.
 * @returns the clock the slider runs its field on.
 */
export function browserClock(): ParticleClock {
  return {
    request: (step) => window.requestAnimationFrame(step),
    cancel: (handle) => {
      window.cancelAnimationFrame(handle)
    },
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}
