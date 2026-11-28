/**
 * The `_session/steering` extension: input sent into a CLI turn that is already
 * running. Core ACP has no such request; the Claude and Codex adapters agree on this
 * one and announce it in the initialize response.
 * @module dsh-ccgui/steering
 */

import type { ContentBlock } from '@agentclientprotocol/sdk'

/** The extension request's method name. */
export const STEERING_METHOD = '_session/steering'

/**
 * How the CLI took steered input. `declined` covers every answer but an injection: with
 * no turn to join, the message is still the plugin's to send as a prompt.
 */
export type SteerOutcome = 'injected' | 'declined'

/**
 * Build the request's parameters. Without `promptRequired`, a CLI with no running turn
 * starts one on its own, which this plugin would never read; with it, the CLI declines
 * and the plugin sends the message as an ordinary prompt.
 * @param sessionId - the CLI session.
 * @param blocks - the user's input.
 * @returns the parameters to send.
 */
export function steeringParams(sessionId: string, blocks: readonly ContentBlock[]): Record<string, unknown> {
  return { sessionId, prompt: [...blocks], _meta: { steering: { idleBehavior: 'promptRequired' } } }
}

/**
 * Read the CLI's answer, which comes from outside this plugin and is checked rather than trusted.
 * @param answer - the response's result.
 * @returns whether the input joined the running turn.
 */
export function readSteerOutcome(answer: unknown): SteerOutcome {
  return isRecord(answer) && answer.outcome === 'injected' ? 'injected' : 'declined'
}

/**
 * Whether the CLI announced the extension, under the initialize response's top-level `_meta`.
 * @param meta - that `_meta`, when the CLI sent one.
 * @returns true when the CLI takes steered input.
 */
export function declaresSteering(meta: Readonly<Record<string, unknown>> | null | undefined): boolean {
  const steering = meta?.steering
  return isRecord(steering) && steering.supported === true
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
