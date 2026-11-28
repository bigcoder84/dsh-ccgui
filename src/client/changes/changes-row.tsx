/**
 * One file in the 变更 list: commit checkbox, a tinted status mark, the path (its name first,
 * its directory dimmed and cut from the left), line counts, and the stage, unstage and
 * discard controls that appear on hover. An untracked file is marked A, as a new file.
 * @module dsh-ccgui/client/changes/changes-row
 */

import type { ReactElement } from 'react'
import type { DiffSide } from './changes-api.ts'
import { MinusIcon, PlusIcon, UndoIcon } from './changes-icons.tsx'
import { STATUS_LABELS, splitPath } from './changes-model.ts'
import type { ChangeEntry, GroupId } from './changes-model.ts'
import { CLS } from './changes-styles.ts'

/** What the list asks the panel to do. */
export interface ListActions {
  readonly select: (paths: readonly string[], selected: boolean) => void
  readonly stage: (paths: readonly string[]) => void
  readonly unstage: (paths: readonly string[]) => void
  /** Asks for confirmation first; the panel owns the dialog. */
  readonly discard: (group: GroupId, entries: readonly ChangeEntry[]) => void
  readonly open: (entry: ChangeEntry, side: DiffSide) => void
}

const SIDE_OF: Readonly<Record<GroupId, DiffSide>> = { staged: 'staged', unstaged: 'unstaged', untracked: 'untracked' }

interface RowProps {
  readonly group: GroupId
  readonly entry: ChangeEntry
  readonly busy: boolean
  readonly actions: ListActions
}

function RowActions({ group, entry, busy, actions }: RowProps): ReactElement {
  const staged = group === 'staged'
  return (
    <span className={CLS.rowActions}>
      {staged ? null : (
        <button
          type="button"
          className={CLS.iconButton}
          title="撤销更改"
          aria-label="撤销更改"
          disabled={busy}
          onClick={() => {
            actions.discard(group, [entry])
          }}
        >
          <UndoIcon size={14} />
        </button>
      )}
      <button
        type="button"
        className={CLS.iconButton}
        title={staged ? '取消暂存' : '暂存'}
        aria-label={staged ? '取消暂存' : '暂存'}
        disabled={busy}
        onClick={() => {
          if (staged) actions.unstage([entry.path])
          else actions.stage([entry.path])
        }}
      >
        {staged ? <MinusIcon size={14} /> : <PlusIcon size={14} />}
      </button>
    </span>
  )
}

function PathButton({ group, entry, actions }: Omit<RowProps, 'busy'>): ReactElement {
  const { dir, name } = splitPath(entry.path)
  return (
    <button
      type="button"
      className={CLS.path}
      title={entry.origPath === undefined ? entry.path : `${entry.origPath} → ${entry.path}`}
      onClick={() => {
        actions.open(entry, SIDE_OF[group])
      }}
    >
      <span className={CLS.name}>{name}</span>
      {dir === '' ? null : (
        <span className={CLS.dir} dir="rtl">
          <bdo dir="ltr">{dir}</bdo>
        </span>
      )}
    </button>
  )
}

function LineStats({ entry }: { readonly entry: ChangeEntry }): ReactElement {
  // CC GUI hides a zero on either side.
  return (
    <span className={CLS.stats}>
      {entry.additions === undefined || entry.additions === 0 ? null : (
        <span className={CLS.add}>+{entry.additions}</span>
      )}
      {entry.deletions === undefined || entry.deletions === 0 ? null : (
        <span className={CLS.del}>−{entry.deletions}</span>
      )}
    </span>
  )
}

/** One row of a group. */
export function FileRow(props: RowProps & { readonly selected: boolean }): ReactElement {
  const { entry, selected, actions } = props
  return (
    <div className={CLS.row} data-status={entry.status === '?' ? 'untracked' : entry.status}>
      <input
        type="checkbox"
        className={CLS.checkbox}
        checked={selected}
        aria-label={`选择 ${entry.path}`}
        onChange={(event) => {
          actions.select([entry.path], event.target.checked)
        }}
      />
      <span className={CLS.letter} title={STATUS_LABELS[entry.status]}>
        {entry.status === '?' ? 'A' : entry.status}
      </span>
      <PathButton {...props} />
      <LineStats entry={entry} />
      <RowActions {...props} />
    </div>
  )
}
