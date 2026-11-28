/**
 * How much of its context window a CLI session holds, as the CLI reports it with ACP's
 * `usage_update`. Kept apart from the harness's token accounting: the harness reads each
 * step's usage as one model request, which a CLI turn of many steps is not.
 * @module dsh-ccgui/session/context-usage
 */

/** Tokens in context, and the context window they are out of. */
export interface ContextUsage {
  readonly used: number
  readonly size: number
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Read a `usage_update`, checked as the SDK does not validate it.
 * @param update - the update as the CLI sent it.
 * @returns the figures, or undefined when they cannot be shown as an occupancy.
 */
export function readContextUsage(update: {
  readonly used?: unknown
  readonly size?: unknown
}): ContextUsage | undefined {
  const { used, size } = update
  return isCount(used) && isCount(size) && size > 0 ? { used, size } : undefined
}
