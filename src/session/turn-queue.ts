/**
 * CLI turns for one session: prompts waiting their turn, the turn in flight, and
 * cancelling it. Only one turn runs at a time. Steering sent mid-turn goes into the
 * running turn when the CLI takes it, and otherwise waits here to run as the next turn.
 * @module dsh-ccgui/session/turn-queue
 */

import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk'
import type { AcpTransport, PromptOutcome, SteerOutcome } from '../transport.ts'

/** How a CLI turn ended. */
export type TurnEnd =
  (PromptOutcome & { readonly type: 'turn-end' }) | { readonly type: 'failure'; readonly error: Error }

/** User input waiting to be sent as a CLI turn. */
export interface QueuedPrompt {
  readonly ids: readonly string[]
  readonly blocks: readonly AcpContentBlock[]
}

/** Where a turn is sent. */
interface TurnTarget {
  readonly transport: AcpTransport
  readonly acpSessionId: string
}

/** What the queue needs from its session. */
export interface TurnHooks {
  /** @returns where to send a turn, or undefined while the session cannot take one. */
  readonly target: () => TurnTarget | undefined
  /** A prompt is going out; its messages now count as sent. */
  readonly onSend: (prompt: QueuedPrompt) => void
  /**
   * A turn ended. `report` is false for a cancelled turn, whose reader already left it,
   * and for a turn whose end is held back until a steer on the wire is answered.
   */
  readonly onEnd: (event: TurnEnd, report: boolean) => void
  /** Whether the CLI takes input into a running turn. */
  readonly steers: () => boolean
  /** A steer failed outright; its input goes out as the next prompt instead. */
  readonly onSteerError: (error: unknown) => void
  /** A cancelled CLI did not finish its turn within the grace period. */
  readonly onCancelTimeout: () => void
  /** How long a cancelled CLI may take to finish its turn before it is abandoned. */
  readonly cancelGraceMs: number
}

/** The turn state machine of one CLI session. */
export class TurnQueue {
  private pending: readonly QueuedPrompt[] = []
  private running = false
  private stopping = false
  private ended = Promise.withResolvers<void>()
  /** Aborted when the CLI turn ends, which withdraws any question still on screen. */
  private lifetime = new AbortController()
  private cancelTimer: NodeJS.Timeout | undefined
  /** Steered prompts not answered yet, in the order they were sent. */
  private steering: readonly QueuedPrompt[] = []
  /** Steers go out one at a time, so a later one cannot overtake one the CLI turns away. */
  private steerChain: Promise<void> = Promise.resolve()
  /** Bumped when pending input is dropped, so a steer answered after that is dropped too. */
  private generation = 0
  /** The end of a turn that finished while a steer was on the wire. */
  private heldEnd: TurnEnd | undefined

  constructor(private readonly hooks: TurnHooks) {}

  /** Whether a CLI turn is in flight. */
  get active(): boolean {
    return this.running
  }

  /** Whether the turn in flight has been asked to stop. */
  get cancelling(): boolean {
    return this.stopping
  }

  /** Whether a turn is running or waiting, or a steer is still unanswered. */
  get busy(): boolean {
    return this.running || this.pending.length > 0 || this.steering.length > 0
  }

  /** Ids of the user messages queued or being steered but not sent yet. */
  get queuedIds(): readonly string[] {
    return [...this.steering, ...this.pending].flatMap((prompt) => prompt.ids)
  }

  /** Aborted when the current turn ends. */
  get signal(): AbortSignal {
    return this.lifetime.signal
  }

  /** @returns a promise that settles when the current turn ends. */
  untilEnded(): Promise<void> {
    return this.ended.promise
  }

  /**
   * Send user input: into the running turn when the CLI takes steering, otherwise as a
   * turn of its own once the CLI is free.
   * @param prompt - the input.
   */
  submit(prompt: QueuedPrompt): void {
    if (this.steering.length === 0 && !this.canSteer()) {
      this.enqueue(prompt)
      return
    }
    this.steering = [...this.steering, prompt]
    const generation = this.generation
    this.steerChain = this.steerChain.then(() => this.steer(prompt, generation))
  }

  clearPending(): void {
    this.pending = []
    this.steering = []
    this.heldEnd = undefined
    this.generation += 1
  }

  /** Withdraw anything still asked within the current turn. */
  abortLifetime(): void {
    this.lifetime.abort()
  }

  /**
   * Ask the CLI to stop the turn in flight.
   * @param sendCancel - sends `session/cancel` to the CLI.
   */
  beginCancel(sendCancel: () => void): void {
    this.stopping = true
    sendCancel()
    // A CLI that ignores session/cancel would block every later prompt and may keep
    // changing files, so it is stopped outright once the grace period ends.
    this.cancelTimer = setTimeout(() => {
      this.hooks.onCancelTimeout()
    }, this.hooks.cancelGraceMs)
    this.cancelTimer.unref()
  }

  end(event: TurnEnd): void {
    if (!this.running) return
    this.running = false
    clearTimeout(this.cancelTimer)
    const wasCancelling = this.stopping
    this.stopping = false
    this.lifetime.abort()
    // A steer the CLI declines becomes the next turn, and the reader must stay for it.
    this.heldEnd = !wasCancelling && this.steering.length > 0 ? event : undefined
    this.hooks.onEnd(event, !wasCancelling && this.heldEnd === undefined)
    this.ended.resolve()
    this.pump()
  }

  /** Send the next queued prompt if no turn is running and the session can take one. */
  pump(): void {
    if (this.running) return
    const target = this.hooks.target()
    if (target === undefined) return
    const [next, ...rest] = this.pending
    if (next === undefined) return
    this.pending = rest
    this.heldEnd = undefined
    this.hooks.onSend(next)
    this.running = true
    this.ended = Promise.withResolvers<void>()
    this.lifetime = new AbortController()
    target.transport.prompt(target.acpSessionId, next.blocks).then(
      (outcome) => {
        this.end({ type: 'turn-end', ...outcome })
      },
      (error: unknown) => {
        this.end({ type: 'failure', error: error instanceof Error ? error : new Error(String(error)) })
      },
    )
  }

  private enqueue(prompt: QueuedPrompt): void {
    this.pending = [...this.pending, prompt]
    this.pump()
  }

  private canSteer(): boolean {
    return this.running && !this.stopping && this.pending.length === 0 && this.hooks.steers()
  }

  private async steer(prompt: QueuedPrompt, generation: number): Promise<void> {
    if (generation !== this.generation) return
    const target = this.hooks.target()
    const outcome = target !== undefined && this.canSteer() ? await this.sendSteer(target, prompt) : 'declined'
    if (generation !== this.generation) return
    this.steering = this.steering.filter((waiting) => waiting !== prompt)
    if (outcome === 'injected') this.hooks.onSend(prompt)
    else this.enqueue(prompt)
    this.releaseHeldEnd()
  }

  private async sendSteer(target: TurnTarget, prompt: QueuedPrompt): Promise<SteerOutcome> {
    try {
      return await target.transport.steer(target.acpSessionId, prompt.blocks)
    } catch (error: unknown) {
      this.hooks.onSteerError(error)
      return 'declined'
    }
  }

  /** Report a held turn end once nothing is left to follow it. */
  private releaseHeldEnd(): void {
    const held = this.heldEnd
    if (held === undefined || this.busy) return
    this.heldEnd = undefined
    this.hooks.onEnd(held, true)
  }
}
