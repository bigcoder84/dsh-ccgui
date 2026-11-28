/**
 * The picker's search field and model rows for the provider in use. A row shows the model
 * maker's mark (see model-marks.ts), the model's name with its compact cost label and badge,
 * and on the right the level it runs at: the one in effect for the selected row, the model's
 * default for the others. Choosing a row selects it at once; the picker stays open.
 * @module dsh-ccgui/client/picker/model-list
 */

import { useRef } from 'react'
import type { ReactElement } from 'react'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { compactDescription } from '../../constants.ts'
import type { DirectoryBadge, DirectoryState } from '../choices.ts'
import { isRow } from '../menu-models.ts'
import type { MenuModels, MenuRow, MenuSection } from '../menu-models.ts'
import { MarkGlyph } from '../marks.tsx'
import { modelMarkOf } from '../model-marks.ts'
import type { LabelFor } from './hosted-slots.tsx'
import { useListKeys } from './list-keys.ts'
import { BoltIcon, SearchIcon } from './picker-icons.tsx'
import { effortStops, shownName } from './picker-model.ts'
import {
  PICKER_BADGE_CLASS,
  PICKER_BOLT_CLASS,
  PICKER_HEADING_CLASS,
  PICKER_HINT_CLASS,
  PICKER_LIST_CLASS,
  PICKER_ROW_CLASS,
  PICKER_ROW_MARK_CLASS,
  PICKER_ROW_META_CLASS,
  PICKER_ROW_NAME_CLASS,
  PICKER_ROW_NOTE_CLASS,
  PICKER_SEARCH_CLASS,
} from './picker-styles.ts'

const SEARCH_LABEL = '搜索模型…'
const NO_MATCH_LABEL = '没有匹配的模型。'
const LOADING_LABEL = '正在加载模型…'
const NO_MODELS_LABEL = '暂无可用模型'
const RETRY_LABEL = '重试'
const MARK_SIZE = 14
const CONTENTS = { display: 'contents' } as const
/** Badges carry translations keyed by language; these are tried in order. */
const BADGE_LANGUAGES = ['zh', 'zh-cn', 'en']

export interface ModelListProps {
  readonly models: MenuModels
  readonly state: DirectoryState
  /** The level in effect, as the slider names it. */
  readonly levelLabel: string | undefined
  readonly fastOn: boolean
  readonly query: string
  readonly disabled: boolean
  readonly onQuery: (query: string) => void
  readonly onChoose: (row: MenuRow) => void
  readonly onRetry: () => void
  /** Another plugin's way of drawing a model's name, which then brings its own badge. */
  readonly labelFor?: LabelFor
}

function badgeText({ text }: DirectoryBadge): string | undefined {
  if (typeof text === 'string') return text
  return BADGE_LANGUAGES.map((language) => text[language]).find((value) => value !== undefined)
}

/** The level a row that is not selected would start at: its own default, if it has levels. */
function defaultLabel(row: MenuRow): string | undefined {
  const reasoning = row.reasoning
  if (reasoning === undefined) return undefined
  const levels = reasoning.efforts.map(({ id, name }) => ({ key: `effort:${id}`, effort: id, name }))
  const level = levels.find((candidate) => candidate.effort === reasoning.defaultEffort)
  return level === undefined
    ? undefined
    : effortStops(levels, level).stops.find((stop) => stop.key === level.key)?.label
}

function Row(props: { readonly row: MenuRow; readonly list: ModelListProps }): ReactElement {
  const { row, list } = props
  const selected = isRow(row, list.state.current)
  const note = compactDescription(row.description)
  const hosted = list.labelFor?.(row, 'menu', selected, shownName(row.name))
  const badge = row.badge === undefined || hosted !== undefined ? undefined : badgeText(row.badge)
  const level = selected ? list.levelLabel : defaultLabel(row)
  const mark = modelMarkOf(row)
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={PICKER_ROW_CLASS}
      data-model-id={row.model}
      disabled={list.disabled}
      onClick={() => {
        list.onChoose(row)
      }}
    >
      {/* The maker's mark, not the CLI's: a CLI may list models from several makers. The slot
          stays when there is none, so every name starts at the same place. */}
      <span className={PICKER_ROW_MARK_CLASS}>
        {mark === undefined ? null : <MarkGlyph id={mark} size={MARK_SIZE} />}
      </span>
      <span className={PICKER_ROW_NAME_CLASS}>{hosted ?? shownName(row.name)}</span>
      {note === undefined ? null : <span className={PICKER_ROW_NOTE_CLASS}>{note}</span>}
      {badge === undefined || row.badge === undefined ? null : (
        <span className={PICKER_BADGE_CLASS} data-tone={row.badge.tone}>
          {badge}
        </span>
      )}
      <span className={PICKER_ROW_META_CLASS}>
        {level}
        {selected && list.fastOn ? (
          <span className={PICKER_BOLT_CLASS}>
            <BoltIcon size={11} on />
          </span>
        ) : null}
      </span>
    </button>
  )
}

function matching(sections: readonly MenuSection[], query: string): readonly MenuSection[] {
  const text = query.trim()
  if (text === '') return sections
  return sections
    .map((section) => ({ ...section, rows: rankByName(section.rows, text) }))
    .filter((section) => section.rows.length > 0)
}

/** What to say when there are no rows to show, and whether a retry helps. */
function emptyState({ models, state, query }: ModelListProps): { text: string; retry: boolean } | undefined {
  if (state.error !== undefined && state.error !== null) return { text: state.error, retry: true }
  if (models.loading) return { text: LOADING_LABEL, retry: false }
  if (query.trim() !== '') return { text: NO_MATCH_LABEL, retry: false }
  return { text: NO_MODELS_LABEL, retry: false }
}

function Failures({ state }: { readonly state: DirectoryState }): ReactElement | null {
  const failures = state.failures ?? []
  if (failures.length === 0) return null
  return <div className={PICKER_HINT_CLASS}>{failures.map(({ name }) => name).join('、')} 的模型没有加载出来</div>
}

/**
 * Render the search field and the model rows.
 * @param props - the models, the selection and what to call on a change.
 * @returns the list.
 */
export function ModelList(props: ModelListProps): ReactElement {
  const searchRef = useRef<HTMLInputElement>(null)
  const onKeyDown = useListKeys(searchRef)
  const sections = matching(props.models.sections, props.query)
  const empty = sections.length === 0 ? emptyState(props) : undefined
  return (
    // Only gathers the keys of the field and the rows inside; the layout stays the popover's.
    <div style={CONTENTS} onKeyDown={onKeyDown}>
      <label className={PICKER_SEARCH_CLASS}>
        <SearchIcon size={13} />
        <input
          ref={searchRef}
          value={props.query}
          placeholder={SEARCH_LABEL}
          aria-label={SEARCH_LABEL}
          autoComplete="off"
          onChange={(event) => {
            props.onQuery(event.target.value)
          }}
        />
      </label>
      <div className={PICKER_LIST_CLASS} role="menu" aria-label="模型">
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.name}>
            {section.headed ? <div className={PICKER_HEADING_CLASS}>{section.name}</div> : null}
            {section.rows.map((row) => (
              <Row key={`${row.provider}\u0000${row.model}`} row={row} list={props} />
            ))}
          </div>
        ))}
        {empty === undefined ? null : (
          <div className={PICKER_HINT_CLASS}>
            {empty.text}
            {empty.retry ? (
              <button type="button" onClick={props.onRetry}>
                {RETRY_LABEL}
              </button>
            ) : null}
          </div>
        )}
        <Failures state={props.state} />
      </div>
    </div>
  )
}
