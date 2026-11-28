/**
 * The picker's provider tabs: each switcher entry by its mark, the one in use named too.
 * Choosing a tab switches to that provider, back to the model last used there; once the
 * session has started it is bound to its provider, so the others are shown but refused.
 * @module dsh-ccgui/client/picker/provider-tabs
 */

import type { ReactElement } from 'react'
import { ProviderMark } from '../marks.tsx'
import type { PickerTabs } from './picker-model.ts'
import { PICKER_TAB_CLASS, PICKER_TAB_NAME_CLASS, PICKER_TABS_CLASS } from './picker-styles.ts'

const LOCKED_HINT = '要换 CLI，请新建会话'
const MARK_SIZE = 14

export interface ProviderTabsProps {
  readonly tabs: PickerTabs
  /** The session has a message, so it stays on its provider. */
  readonly started: boolean
  readonly disabled: boolean
  readonly onChoose: (id: string) => void
}

/**
 * Render the provider tabs.
 * @param props - the tabs, whether the session is bound and what to call on a choice.
 * @returns the tab row.
 */
export function ProviderTabs({ tabs, started, disabled, onChoose }: ProviderTabsProps): ReactElement {
  return (
    <div className={PICKER_TABS_CLASS} role="tablist" aria-label="提供方">
      {tabs.items.map((item) => {
        const current = item.id === tabs.currentId
        const locked = started && !current
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={PICKER_TAB_CLASS}
            aria-selected={current}
            aria-label={item.label}
            title={locked ? LOCKED_HINT : item.label}
            disabled={disabled || locked}
            onClick={() => {
              if (!current) onChoose(item.id)
            }}
          >
            <ProviderMark provider={item.id} size={MARK_SIZE} />
            <span className={PICKER_TAB_NAME_CLASS}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
