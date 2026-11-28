/**
 * Asks a CLI which models it offers. ACP only reports them on a session, so this
 * opens one and removes it again. It sends no prompt, so no model is called.
 * @module dsh-ccgui/model-probe
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { SessionCapabilities } from '@agentclientprotocol/sdk'
import { abortable } from './abortable.ts'
import { readModelList } from './model-options.ts'
import type { CliModelList } from './model-options.ts'
import { readSpeeds, SPEED_WALK_LIMIT_MS } from './model-speeds.ts'
import type { AcpTransport, TransportHandlers } from './transport.ts'

const IGNORING_HANDLERS: TransportHandlers = {
  onUpdate: () => {
    /* a probe only reads the model list */
  },
  onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
  onClosed: () => {
    /* the caller's dispose handles the close */
  },
}

const CLEANUP_LIMIT_MS = 3_000

/**
 * Otherwise every probe would leave an empty session in the CLI's history. Failing to
 * clean up does not make the answer any less true, so it gets its own short limit and
 * can never cost the list already in hand.
 */
async function discardSession(
  transport: AcpTransport,
  sessionId: string,
  capabilities: SessionCapabilities | null | undefined,
  limitMs: number,
): Promise<void> {
  const discarding =
    capabilities?.delete != null
      ? transport.deleteSession(sessionId)
      : capabilities?.close != null
        ? transport.closeSession(sessionId)
        : undefined
  if (discarding === undefined) return
  await Promise.race([
    discarding.catch(() => {
      /* a failed cleanup does not change the answer in hand */
    }),
    delay(limitMs, undefined, { ref: false }),
  ])
}

/**
 * Runs behind the answer, because removing the session takes Pi seconds and exiting takes
 * Codex as long, with the user watching a menu that could already be filled.
 */
async function cleanUp(
  transport: AcpTransport,
  discard: (limitMs: number) => Promise<void>,
  limitMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  await abortable(discard(limitMs), signal).catch(() => {
    /* a failed cleanup does not change the answer in hand */
  })
  await transport.dispose(signal?.aborted === true).catch(() => {
    /* likewise */
  })
}

interface Asked {
  readonly list: CliModelList | undefined
  readonly sessionId: string
  readonly discard: (limitMs: number) => Promise<void>
}

async function askModels(transport: AcpTransport, cwd: string): Promise<Asked> {
  const { agentCapabilities } = await transport.initialize()
  const { sessionId, configOptions } = await transport.newSession(cwd)
  const list = readModelList(configOptions)
  const capabilities = agentCapabilities?.sessionCapabilities
  return {
    list,
    sessionId,
    discard: async (limitMs) => {
      // Put the session back on the model it started on, in case a CLI carries a session's
      // switch over to its own settings.
      if (list !== undefined && list.options.length > 1) {
        await Promise.race([
          transport.setConfigOption(sessionId, list.configId, list.current).catch(() => {
            /* the session is removed next either way */
          }),
          delay(limitMs, undefined, { ref: false }),
        ])
      }
      await discardSession(transport, sessionId, capabilities, limitMs)
    },
  }
}

/** The list with each model's fast mode, learned within its own limit, after the start's. */
async function withSpeeds(
  transport: AcpTransport,
  { list, sessionId }: Asked,
  limitMs: number,
): Promise<CliModelList | undefined> {
  if (list === undefined) return undefined
  return { ...list, speeds: await readSpeeds(transport, sessionId, list, limitMs) }
}

/**
 * Start a CLI just long enough to read its model list.
 * @param open - starts the CLI.
 * @param cwd - working directory for the temporary session.
 * @param timeoutMs - how long to wait, which must allow for a cold `npx` download.
 * @param signal - stops the CLI at once when the bridge is shutting down.
 * @returns the model list with each model's fast mode, or undefined when the CLI offers none.
 */
export async function probeModels(
  open: (handlers: TransportHandlers) => AcpTransport,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CliModelList | undefined> {
  signal?.throwIfAborted()
  const transport = open(IGNORING_HANDLERS)
  const { promise: timedOut, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    reject(new Error('超时，CLI 没有响应'))
  }, timeoutMs)
  const cleanupLimitMs = Math.min(CLEANUP_LIMIT_MS, timeoutMs / 2)
  try {
    const asked = await abortable(Promise.race([askModels(transport, cwd), timedOut]), signal)
    clearTimeout(timer)
    const list = await abortable(withSpeeds(transport, asked, Math.min(SPEED_WALK_LIMIT_MS, timeoutMs / 2)), signal)
    void cleanUp(transport, asked.discard, cleanupLimitMs, signal).catch(() => {
      /* background cleanup; nobody to report to */
    })
    return list
  } catch (error: unknown) {
    await transport.dispose(true).catch(() => {
      /* the original error is rethrown; a failed dispose must not replace it */
    })
    throw error
  } finally {
    clearTimeout(timer)
  }
}
