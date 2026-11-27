/**
 * The facts the composer's controls need from a session: whether it is gone, whether it has
 * started, and whether a turn is under way. All come from the harness's own store, and all are
 * read as plain booleans so a re-render only happens when the answer really changes.
 * @module dsh-ccgui/client/session-facts
 */

import { useSyncExternalStore } from 'react'
import type { Store } from './store.ts'

/** What the harness publishes about one session. */
export type SessionFacts = Store<Facts>

interface Facts {
  blank?: boolean
  removed?: boolean
  running?: boolean
}

const NOTHING = (): void => {
  /* no session, nothing to unsubscribe */
}

function useFact(session: SessionFacts | undefined, read: (facts: Facts) => boolean): boolean {
  return useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? NOTHING,
    () => (session === undefined ? false : read(session.getSnapshot())),
  )
}

/**
 * Whether the session has been removed.
 * @param session - its store, when the harness has one.
 * @returns true once it is gone.
 */
export function useRemoved(session: SessionFacts | undefined): boolean {
  return useFact(session, (facts) => facts.removed === true)
}

/**
 * Whether the session has a message yet. Before that its CLI has no process of its own,
 * so a mode picked now can only apply with the first message.
 * @param session - its store, when the harness has one.
 * @returns true once it has started.
 */
export function useStarted(session: SessionFacts | undefined): boolean {
  return useFact(session, (facts) => facts.blank === false)
}

/**
 * Whether a turn is under way. A turn can change what the CLI reports about itself, such as
 * its mode or, after a model switch, whether it has a fast mode at all.
 * @param session - its store, when the harness has one.
 * @returns true while the session runs a turn.
 */
export function useRunning(session: SessionFacts | undefined): boolean {
  return useFact(session, (facts) => facts.running === true)
}
