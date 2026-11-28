/**
 * The 变更 panel's commit box: the message, the commit button, and the AI button that asks a
 * harness model to write the message from the selected files. The AI run can be stopped, and
 * leaving the panel stops it too; either way the model call on the server ends with it.
 * @module dsh-ccgui/client/changes/changes-commit
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { GitApi } from './changes-api.ts'
import { SparkleIcon, StopIcon } from './changes-icons.tsx'
import { commitPaths } from './changes-model.ts'
import { CLS } from './changes-styles.ts'
import { canCommit, selectedCount } from './use-changes.ts'
import type { ChangesActions, ChangesState } from './use-changes.ts'

const AI_LABEL = 'AI 生成提交信息'
const AI_TEXT = 'AI 生成'
const STOP_LABEL = '停止生成'
const STOP_TEXT = '停止'
const partial = (shown: number, total: number): string =>
  `改动较多，模型只看了 ${String(shown)} / ${String(total)} 个文件的 diff`
const CUT = '部分文件的 diff 只取了开头'

/** Where the AI run is; a note belongs to the message it produced and goes once that is edited. */
type Suggestion =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running' }
  | { readonly phase: 'error'; readonly error: string }
  | { readonly phase: 'done'; readonly message: string; readonly note: string; readonly warn: boolean }

function noteOf(value: Awaited<ReturnType<GitApi['suggestMessage']>>): string {
  const { coverage } = value
  const scope = !coverage.truncated
    ? undefined
    : coverage.diffFiles < coverage.files
      ? partial(coverage.diffFiles, coverage.files)
      : CUT
  return [value.warning, scope].filter((part) => part !== undefined).join(' ')
}

function useSuggestion(api: GitApi, apply: (message: string) => void) {
  const [state, setState] = useState<Suggestion>({ phase: 'idle' })
  const running = useRef<AbortController | undefined>(undefined)
  useEffect(
    () => () => {
      running.current?.abort()
    },
    [],
  )
  const run = (paths: readonly string[]): void => {
    if (running.current !== undefined) return
    const controller = new AbortController()
    running.current = controller
    setState({ phase: 'running' })
    api.suggestMessage(paths, controller.signal).then(
      (value) => {
        if (running.current !== controller) return
        running.current = undefined
        apply(value.message)
        setState({ phase: 'done', message: value.message, note: noteOf(value), warn: value.warning !== undefined })
      },
      (error: unknown) => {
        // A stopped run already went back to idle; its rejection is the abort itself.
        if (running.current !== controller) return
        running.current = undefined
        setState({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      },
    )
  }
  const stop = (): void => {
    running.current?.abort()
    running.current = undefined
    setState({ phase: 'idle' })
  }
  return { state, run, stop }
}

function AiButton({
  running,
  disabled,
  onRun,
  onStop,
}: {
  readonly running: boolean
  readonly disabled: boolean
  readonly onRun: () => void
  readonly onStop: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={CLS.aiButton}
      title={running ? STOP_LABEL : AI_LABEL}
      aria-label={running ? STOP_LABEL : AI_LABEL}
      aria-busy={running || undefined}
      // Never disabled while running: 停止 must stay reachable.
      disabled={running ? false : disabled}
      onClick={running ? onStop : onRun}
    >
      {running ? <StopIcon size={13} /> : <SparkleIcon size={14} />}
      <span>{running ? STOP_TEXT : AI_TEXT}</span>
    </button>
  )
}

function SuggestionNote({ state, message }: { readonly state: Suggestion; readonly message: string }) {
  if (state.phase === 'error') {
    return (
      <div className={CLS.commitNote} data-tone="error" role="alert">
        {state.error}
      </div>
    )
  }
  if (state.phase !== 'done' || state.note === '' || state.message !== message) return null
  return (
    <div className={CLS.commitNote} data-tone={state.warn ? 'warn' : undefined}>
      {state.note}
    </div>
  )
}

/**
 * Render the commit box.
 * @param props - the panel's state and actions, and the API the AI button posts to.
 * @returns the box.
 */
export function CommitBox({
  api,
  state,
  actions,
}: {
  readonly api: GitApi
  readonly state: ChangesState
  readonly actions: ChangesActions
}): ReactElement {
  const count = selectedCount(state)
  const suggestion = useSuggestion(api, actions.setMessage)
  const running = suggestion.state.phase === 'running'
  return (
    <div className={CLS.commit}>
      <textarea
        className={CLS.commitInput}
        rows={2}
        placeholder="提交信息…"
        aria-label="提交信息"
        value={state.message}
        readOnly={running}
        onChange={(event) => {
          actions.setMessage(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit(state)) actions.commit()
        }}
      />
      <SuggestionNote state={suggestion.state} message={state.message} />
      <div className={CLS.commitRow}>
        <AiButton
          running={running}
          disabled={count === 0 || state.busy !== undefined}
          onRun={() => {
            if (state.answer?.repo === true) suggestion.run(commitPaths(state.selection, state.answer))
          }}
          onStop={suggestion.stop}
        />
        <button
          type="button"
          className={CLS.commitButton}
          disabled={running || !canCommit(state)}
          onClick={actions.commit}
        >
          {state.busy === 'commit' ? '提交中…' : `提交 (${String(count)})`}
        </button>
      </div>
    </div>
  )
}
