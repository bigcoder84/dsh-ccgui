/**
 * The settings page's CLI 列表 tab: the order of the composer's CLI switcher, and which CLIs
 * the plugin offers at all. A CLI switched off here is no provider anywhere in the harness.
 * @module dsh-ccgui/client/cli-prefs-section
 */

import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isBuiltInChoice, settingsEntries } from './cli-prefs.ts'
import type { CliEntry, CliPrefs } from './cli-prefs.ts'
import type { CliSwitches } from './cli-switches.ts'
import { ProviderMark } from './marks.tsx'
import { useStore } from './store.ts'

const SECTION_INTRO =
  '输入框模型选择器里提供方标签的顺序，以及启用哪些 CLI。关闭的 CLI 不再作为提供方出现在 DSH 的任何地方。'
const EMPTY_HINT = '正在读取 CLI 列表…'
const OFF_HINT = '已关闭，不作为提供方出现'
const LOCKED_HINT = '内置提供方，始终显示'
const SWITCH_ON_TITLE = '关闭后不再作为提供方出现，正在运行的会话会被停止'
const SWITCH_OFF_TITLE = '开启后重新作为提供方出现'
const FAILURE_PREFIX = 'CLI 开关出错：'
const MORE_CLIS_HINT = '更多 CLI 适配中…'
const MARK_SIZE = 16
const ARROW_SIZE = 14
const SECTION_CLASS = 'dsh-ccgui-cli-prefs'

export const CLI_PREFS_STYLES = `
.${SECTION_CLASS} { margin: 0; }
.${SECTION_CLASS}-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.${SECTION_CLASS}-row + .${SECTION_CLASS}-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.${SECTION_CLASS}-name { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.${SECTION_CLASS}-off { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-locked { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-moves { display: flex; gap: 2px; }
.${SECTION_CLASS}-failure { margin: 8px 0 0; color: var(--dsw-alias-state-danger, var(--dsw-alias-label-secondary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-more { display: flex; align-items: center; gap: 10px; margin: 14px 0 0; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-more::before, .${SECTION_CLASS}-more::after { content: ''; flex: 1; border-top: 1px dashed var(--dsw-alias-border-l2); }
`

interface RowProps {
  readonly entry: CliEntry
  readonly first: boolean
  readonly last: boolean
  readonly prefs: CliPrefs
  /** The ids as listed, which a move reorders. */
  readonly listed: readonly string[]
}

function MoveButtons({ entry, first, last, prefs, listed }: RowProps) {
  return (
    <span className={`${SECTION_CLASS}-moves`}>
      <Button
        size="sm"
        aria-label={`上移 ${entry.label}`}
        disabled={first}
        icon={<IconChevronUpOutlineRegular size={ARROW_SIZE} />}
        onClick={() => {
          prefs.move(entry.id, -1, listed)
        }}
      />
      <Button
        size="sm"
        aria-label={`下移 ${entry.label}`}
        disabled={last}
        icon={<IconChevronDownOutlineRegular size={ARROW_SIZE} />}
        onClick={() => {
          prefs.move(entry.id, 1, listed)
        }}
      />
    </span>
  )
}

interface SwitchProps {
  /** Takes the switch while it is on its way to the plugin. */
  readonly busy: boolean
  readonly onSwitch: (id: string, enabled: boolean) => void
}

function CliRow(props: RowProps & SwitchProps) {
  const { entry, busy, onSwitch } = props
  const locked = isBuiltInChoice(entry.id)
  return (
    <li className={`${SECTION_CLASS}-row`} aria-label={entry.label}>
      <span className={`${SECTION_CLASS}-name`}>
        <ProviderMark provider={entry.id} size={MARK_SIZE} />
        <span>{entry.label}</span>
        {entry.enabled ? null : (
          <span className={`${SECTION_CLASS}-off`} role="status">
            {OFF_HINT}
          </span>
        )}
      </span>
      <MoveButtons {...props} />
      {locked ? (
        <span className={`${SECTION_CLASS}-locked`}>{LOCKED_HINT}</span>
      ) : (
        <Switch
          checked={entry.enabled}
          label={`启用 ${entry.label}`}
          title={entry.enabled ? SWITCH_ON_TITLE : SWITCH_OFF_TITLE}
          disabled={busy}
          onChange={(next) => {
            onSwitch(entry.id, next)
          }}
        />
      )}
    </li>
  )
}

/**
 * @param props.prefs - the switcher order the list reads and writes.
 * @param props.switches - the plugin's CLI switches the list reads and writes.
 * @returns the section.
 */
export function CliPrefsSection({
  prefs,
  switches,
}: {
  readonly prefs: CliPrefs
  readonly switches: CliSwitches
}): ReactElement {
  const { clis, pending, failure } = useStore(switches)
  const entries = settingsEntries(useStore(prefs), clis)
  const listed = entries.map((entry) => entry.id)
  useEffect(() => {
    switches.load()
  }, [switches])
  const onSwitch = (id: string, enabled: boolean): void => {
    switches.set(id, enabled, listed)
  }
  return (
    <section className={SECTION_CLASS}>
      <p className="dsh-ccgui-settings-intro">{clis === undefined ? EMPTY_HINT : SECTION_INTRO}</p>
      {entries.length === 0 ? null : (
        <ul className="dsh-ccgui-settings-list">
          {entries.map((entry, index) => (
            <CliRow
              key={entry.id}
              entry={entry}
              first={index === 0}
              last={index === entries.length - 1}
              prefs={prefs}
              listed={listed}
              busy={pending.includes(entry.id)}
              onSwitch={onSwitch}
            />
          ))}
        </ul>
      )}
      {failure === undefined ? null : (
        <p className={`${SECTION_CLASS}-failure`} role="alert">
          {FAILURE_PREFIX}
          {failure}
        </p>
      )}
      <p className={`${SECTION_CLASS}-more`}>{MORE_CLIS_HINT}</p>
    </section>
  )
}
