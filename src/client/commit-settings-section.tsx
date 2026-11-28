/**
 * The settings page's 提交信息 tab: which harness model writes the 变更 panel's AI commit
 * message, and the prompt it is given. Choosing nothing follows the plugin config, then the
 * harness's default model; CLIs are never offered, since the call would go back into the
 * user's CLI conversation. Changes are drafts until 保存.
 * @module dsh-ccgui/client/commit-settings-section
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CommitModelRoute,
  CommitSettingsApi,
  CommitSettingsValue,
  CommitSettingsView,
} from './commit-settings-api.ts'

const SECTION_CLASS = 'dsh-ccgui-commit-settings'
const PAGE_CLASS = 'dsh-ccgui-settings'
/** The Node half refuses a longer prompt (commit-settings.ts MAX_COMMIT_PROMPT). */
const MAX_PROMPT = 8000

const INTRO =
  '「变更」面板的「AI 生成」用这里选的模型，根据选中文件的改动写提交信息。改动内容会发给所选模型的提供方，CLI 不在可选之列。'
const MODEL_LABEL = '模型'
const MODEL_HINT = '不选时依次用插件配置里的 commitProvider、reviewProvider，再用 DSH 的默认模型（不能是 CLI）。'
const PROMPT_LABEL = '提示词'
const PROMPT_HINT = `留空使用内置提示词，最多 ${String(MAX_PROMPT)} 字。`
const LOADING = '正在读取…'
const SAVED = '已保存，下一次生成时生效'
const followLabel = (fallback: CommitModelRoute | null, models: CommitSettingsView['models']): string => {
  if (fallback === null) return '跟随默认（当前没有可用模型，请选一个）'
  const listed = models.find((model) => model.provider === fallback.provider && model.id === fallback.model)
  return `跟随默认（${listed === undefined ? `${fallback.provider}/${fallback.model}` : `${listed.providerName} · ${listed.name}`}）`
}

export const COMMIT_SETTINGS_STYLES = `
.${SECTION_CLASS} { display: flex; flex-direction: column; gap: 16px; }
.${SECTION_CLASS}-field { display: flex; flex-direction: column; gap: 6px; }
.${SECTION_CLASS}-label { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
.${SECTION_CLASS}-hint { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-warn { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS}-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; }
.${SECTION_CLASS}-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
.${SECTION_CLASS} select, .${SECTION_CLASS} textarea { box-sizing: border-box; width: 100%; padding: 6px 10px; border-radius: var(--dsw-radius-sm, 8px);
  border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; outline: none; }
.${SECTION_CLASS} select { height: 32px; padding: 0 8px; }
.${SECTION_CLASS} textarea { resize: vertical; min-height: 140px; }
.${SECTION_CLASS} select:focus, .${SECTION_CLASS} textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.${SECTION_CLASS}-actions { display: flex; align-items: center; gap: 8px; }
`

/** The select's value for a model; '' follows the default. */
const keyOf = (model: CommitModelRoute | null): string =>
  model === null ? '' : JSON.stringify([model.provider, model.model])

function modelOf(key: string): CommitModelRoute | null {
  if (key === '') return null
  const parsed: unknown = JSON.parse(key)
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null
  return { provider: parsed[0], model: parsed[1] }
}

const sameDraft = (view: CommitSettingsView, draft: CommitSettingsValue): boolean =>
  keyOf(view.model) === keyOf(draft.model) && view.prompt.trim() === draft.prompt.trim()

function ModelOptions({ view }: { readonly view: CommitSettingsView }): ReactElement {
  const providers = [...new Map(view.models.map((model) => [model.provider, model.providerName]))]
  const saved = keyOf(view.model)
  const listed =
    saved === '' || view.models.some((model) => keyOf({ provider: model.provider, model: model.id }) === saved)
  return (
    <>
      <option value="">{followLabel(view.fallback, view.models)}</option>
      {providers.map(([provider, name]) => (
        <optgroup key={provider} label={name}>
          {view.models
            .filter((model) => model.provider === provider)
            .map((model) => (
              <option key={model.id} value={keyOf({ provider, model: model.id })}>
                {model.name}
              </option>
            ))}
        </optgroup>
      ))}
      {listed || view.model === null ? null : (
        <option value={saved}>{`${view.model.provider}/${view.model.model}（当前不可用）`}</option>
      )}
    </>
  )
}

type Notice = { readonly tone: 'ok' | 'error'; readonly text: string } | undefined

function useCommitSettings(api: CommitSettingsApi) {
  const [view, setView] = useState<CommitSettingsView | undefined>()
  const [draft, setDraft] = useState<CommitSettingsValue | undefined>()
  const [notice, setNotice] = useState<Notice>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let live = true
    api.read().then(
      (read) => {
        if (!live) return
        setView(read)
        setDraft({ model: read.model, prompt: read.prompt })
      },
      (error: unknown) => {
        if (live) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [api])
  const save = (next: CommitSettingsValue): void => {
    setSaving(true)
    setNotice(undefined)
    api.save(next).then(
      (saved) => {
        setView(saved)
        setDraft({ model: saved.model, prompt: saved.prompt })
        setNotice({ tone: 'ok', text: SAVED })
        setSaving(false)
      },
      (error: unknown) => {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
        setSaving(false)
      },
    )
  }
  const edit = (change: Partial<CommitSettingsValue>): void => {
    setNotice(undefined)
    setDraft((previous) => (previous === undefined ? previous : { ...previous, ...change }))
  }
  return { view, draft, notice, saving, save, edit }
}

function NoticeLine({ notice }: { readonly notice: Notice }): ReactElement | null {
  if (notice === undefined) return null
  return notice.tone === 'ok' ? (
    <div className={`${SECTION_CLASS}-ok`} role="status">
      {notice.text}
    </div>
  ) : (
    <div className={`${SECTION_CLASS}-error`} role="alert">
      {notice.text}
    </div>
  )
}

type Edit = (change: Partial<CommitSettingsValue>) => void

function ModelField({
  view,
  draft,
  saving,
  edit,
}: {
  readonly view: CommitSettingsView
  readonly draft: CommitSettingsValue
  readonly saving: boolean
  readonly edit: Edit
}): ReactElement {
  return (
    <label className={`${SECTION_CLASS}-field`}>
      <span className={`${SECTION_CLASS}-label`}>{MODEL_LABEL}</span>
      <select
        value={keyOf(draft.model)}
        disabled={saving}
        onChange={(event) => {
          edit({ model: modelOf(event.target.value) })
        }}
      >
        <ModelOptions view={view} />
      </select>
      <span className={`${SECTION_CLASS}-hint`}>{MODEL_HINT}</span>
      {view.errors.length > 0 ? (
        <span className={`${SECTION_CLASS}-warn`}>{`这些提供方的模型没读到：${view.errors.join('；')}`}</span>
      ) : null}
    </label>
  )
}

function PromptField({
  view,
  draft,
  saving,
  edit,
}: {
  readonly view: CommitSettingsView
  readonly draft: CommitSettingsValue
  readonly saving: boolean
  readonly edit: Edit
}): ReactElement {
  return (
    <label className={`${SECTION_CLASS}-field`}>
      <span className={`${SECTION_CLASS}-label`}>{PROMPT_LABEL}</span>
      <textarea
        rows={8}
        value={draft.prompt}
        placeholder={view.defaultPrompt}
        maxLength={MAX_PROMPT}
        disabled={saving}
        onChange={(event) => {
          edit({ prompt: event.target.value })
        }}
      />
      <span className={`${SECTION_CLASS}-hint`}>{PROMPT_HINT}</span>
    </label>
  )
}

/**
 * @param props.api - reads and saves the settings.
 * @returns the tab.
 */
export function CommitSettingsSection({ api }: { readonly api: CommitSettingsApi }): ReactElement {
  const { view, draft, notice, saving, save, edit } = useCommitSettings(api)
  if (view === undefined || draft === undefined) {
    return (
      <section className={SECTION_CLASS}>
        {notice === undefined ? (
          <div className={`${SECTION_CLASS}-hint`}>{LOADING}</div>
        ) : (
          <NoticeLine notice={notice} />
        )}
      </section>
    )
  }
  return (
    <section className={SECTION_CLASS}>
      <p className={`${PAGE_CLASS}-intro`}>{INTRO}</p>
      <ModelField view={view} draft={draft} saving={saving} edit={edit} />
      <PromptField view={view} draft={draft} saving={saving} edit={edit} />
      <div className={`${SECTION_CLASS}-actions`}>
        <Button
          variant="primary"
          size="sm"
          disabled={saving || sameDraft(view, draft)}
          onClick={() => {
            save({ model: draft.model, prompt: draft.prompt.trim() === '' ? '' : draft.prompt })
          }}
        >
          保存
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={saving || draft.prompt === ''}
          onClick={() => {
            edit({ prompt: '' })
          }}
        >
          恢复内置提示词
        </Button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  )
}
