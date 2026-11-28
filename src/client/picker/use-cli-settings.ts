/**
 * The CLI's own settings in the picker, its mode and its fast mode, read from the plugin's
 * mode route and written back in the CLI's own ids. A name read once would go stale as soon
 * as the CLI changed it, so it is read again when a turn ends and when the model changes,
 * and asked for a while when a pick waits for the CLI to take it.
 * @module dsh-ccgui/client/picker/use-cli-settings
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModeApi, ModeReply } from '../mode-api.ts'

/** How often to ask again while a pick waits for the CLI to take it. */
export const SETTINGS_POLL_MS = 1500
/** Enough tries to cover a process that starts slowly, and then the picker goes quiet. */
export const SETTINGS_POLL_TRIES = 40

/** A refused or failed change, shown once. */
export interface SettingsFailure {
  /** Gives each failure a toast of its own. */
  readonly seq: number
  readonly text: string
}

/** What the session tells the hook about itself. */
export interface SettingsSession {
  /** False before the first message, when there is no CLI process to change yet. */
  readonly started: boolean
  readonly running: boolean
  /** The model selected; a new one can change what the route answers, the fast mode above all. */
  readonly model: string | undefined
}

export interface CliSettings {
  readonly reply: ModeReply | undefined
  readonly busy: boolean
  readonly failure: SettingsFailure | undefined
  readonly clearFailure: () => void
  /** Pick a mode, or turn the fast mode on or off, by the value the CLI reported. */
  readonly choose: (setting: 'mode' | 'speed', value: string) => void
}

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/** What the CLI is on for one setting, counting a pick it has not taken yet. */
function inEffect(reply: ModeReply | undefined, setting: 'mode' | 'speed'): string | undefined {
  return setting === 'mode' ? (reply?.pending ?? reply?.modes?.current) : (reply?.speedPending ?? reply?.speed?.current)
}

function useReading(api: ModeApi | undefined, provider: string | undefined, model: string | undefined) {
  const [reply, setReply] = useState<ModeReply | undefined>()
  useEffect(() => {
    if (api === undefined || provider === undefined) {
      setReply(undefined)
      return undefined
    }
    let current = true
    api.read(provider).then(
      (next) => {
        if (current) setReply(next)
      },
      () => {
        if (current) setReply(undefined)
      },
    )
    return () => {
      current = false
    }
    // The model is not sent, but a new one can change what the route answers.
  }, [api, provider, model])
  const refresh = useCallback(() => {
    if (api === undefined || provider === undefined) return
    api.read(provider).then(setReply, () => {
      /* keep the last answer; the picker is still usable */
    })
  }, [api, provider])
  return { reply, setReply, refresh }
}

/** Ask again when a turn ends: it may have moved the CLI to another mode or model. */
function useRefreshAfterTurn(running: boolean, refresh: () => void): void {
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) refresh()
    wasRunning.current = running
  }, [running, refresh])
}

/** A pick only moves once a message runs, and nothing tells the picker when that happened. */
function usePollWhilePending(reply: ModeReply | undefined, started: boolean, refresh: () => void): void {
  // A new pick of either setting starts the budget over.
  const pending =
    reply?.pending === undefined && reply?.speedPending === undefined
      ? undefined
      : `${reply.pending ?? ''}\u0000${reply.speedPending ?? ''}`
  useEffect(() => {
    if (pending === undefined || !started) return undefined
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (tries > SETTINGS_POLL_TRIES) {
        clearInterval(timer)
        return
      }
      refresh()
    }, SETTINGS_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [pending, started, refresh])
}

/**
 * Read and change one CLI session's mode and fast mode.
 * @param api - the mode route, absent where the harness offers none.
 * @param provider - the CLI route the session is on, or undefined off a CLI.
 * @param session - whether it started, whether a turn runs, and the model selected.
 * @returns the settings and a way to change them.
 */
export function useCliSettings(
  api: ModeApi | undefined,
  provider: string | undefined,
  { started, running, model }: SettingsSession,
): CliSettings {
  const { reply, setReply, refresh } = useReading(api, provider, model)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SettingsFailure | undefined>()
  useRefreshAfterTurn(running, refresh)
  usePollWhilePending(reply, started, refresh)
  const choose = (setting: 'mode' | 'speed', value: string): void => {
    if (api === undefined || provider === undefined || value === inEffect(reply, setting)) return
    setBusy(true)
    api.write(provider, value, setting).then(
      (next) => {
        setBusy(false)
        setReply(next)
      },
      (reason: unknown) => {
        setBusy(false)
        setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text: textOf(reason) }))
      },
    )
  }
  return {
    reply,
    busy,
    failure,
    clearFailure: () => {
      setFailure(undefined)
    },
    choose,
  }
}
