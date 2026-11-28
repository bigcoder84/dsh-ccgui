/// <reference lib="dom" />

/**
 * Browser half: one model picker in the composer's tool row (see picker/picker.tsx), which
 * takes the harness's own model seat for every session and reuses its model directory, so a
 * CLI and the harness's providers are chosen the same way. A terminal button in the
 * session header (see terminal-entry.tsx) saves the trip through the right sidebar, a startup
 * script control beside it (see launch-script-entry.tsx) runs saved commands there,
 * "添加到对话" in file context menus (see add-to-chat.tsx) mentions a path in the composer, and
 * the right sidebar opens on 工作区文件 rather than the guide (see files-default.ts), and a
 * workspace's context menu offers 新建 Worktree… (see worktree/worktree-register.tsx). A settings
 * page in the left sidebar (see settings-register.ts) orders the picker's providers and hides
 * some (see cli-prefs.ts), and switches the header buttons and the files default off for users
 * who prefer the harness's original interaction.
 * @module dsh-ccgui/client
 */

import { registerAddToChat } from './add-to-chat.tsx'
import type { AddToChatContext } from './add-to-chat.tsx'
import { createCliPrefs } from './cli-prefs.ts'
import { createCliSwitchApi } from './cli-switch-api.ts'
import { createCliSwitches } from './cli-switches.ts'
import { createCommitSettingsApi } from './commit-settings-api.ts'
import { contextApiFor } from './context-api.ts'
import { CliContextMeter } from './context-meter.tsx'
import { CONTEXT_METER_STYLES } from './context-meter-styles.ts'
import { createLastSelections } from './last-selections.ts'
import type { LastSelectionsStorage } from './last-selections.ts'
import type { CliPrefs, CliPrefsStorage } from './cli-prefs.ts'
import type { DirectorySelection, DirectoryState } from './choices.ts'
import { ProviderMark } from './marks.tsx'
import { modeApiFor } from './mode-api.ts'
import { registerPicker } from './picker/picker-register.ts'
import type { PickerContext, PickerFace } from './picker/picker-register.ts'
import { PICKER_STYLES } from './picker/picker-styles.ts'
import {
  SESSION_STATUS_SLOT,
  SESSION_STATUS_STYLES,
  SessionStatusMark,
  useSessionProvider,
} from './session-status-mark.tsx'
import type { SessionList } from './session-status-mark.tsx'
import type { SessionFacts } from './session-facts.ts'
import type { Store } from './store.ts'
import { TERMINAL_ENTRY_STYLES, registerTerminalEntry } from './terminal-entry.tsx'
import { registerFilesDefault } from './files-default.ts'
import { registerChanges } from './changes/changes-register.ts'
import type { ChangesContext } from './changes/changes-register.ts'
import { CHANGES_STYLES } from './changes/changes-styles.ts'
import type { FilesDefaultContext } from './files-default.ts'
import { LAUNCH_SCRIPT_STYLES } from './launch-script-styles.ts'
import { SESSION_TREE_STYLES } from './session-tree-styles.ts'
import { registerLaunchScripts } from './launch-script-register.ts'
import type { LaunchScriptContext } from './launch-script-register.ts'
import type { ScriptStorage } from './launch-scripts.ts'
import type { TerminalEntryContext } from './terminal-entry.tsx'
import { createFeatureSettings, whileEnabled } from './feature-settings.ts'
import { installCompactTabs } from './compact-tabs.ts'
import type { FeatureSettings, FeatureStorage } from './feature-settings.ts'
import { SETTINGS_PAGE_STYLES } from './settings-page.tsx'
import { gateInject, registerSettingsPage } from './settings-register.ts'
import { registerWorktree } from './worktree/worktree-register.tsx'
import type { WorktreeContext } from './worktree/worktree-register.tsx'
import type { ExpansionStorage } from './worktree/worktree-expansion.ts'
import { WORKTREE_GROUP_STYLES } from './worktree/worktree-group-styles.ts'
import { WORKTREE_STYLES } from './worktree/worktree-styles.ts'

type DirectoryFace = ReturnType<PickerFace['face']>

/** The parts of the harness's client context this plugin uses. */
interface ClientContext {
  effect(run: () => () => void, label?: string): void
  inject: TerminalEntryContext['inject'] &
    AddToChatContext['inject'] &
    LaunchScriptContext['inject'] &
    FilesDefaultContext['inject'] &
    ChangesContext['inject'] &
    WorktreeContext['inject'] &
    PickerContext['inject']
  slots: {
    inject(name: string, add: () => unknown): void
    register(
      options: { name: string; id: string; order?: number; inject(sessionId: string): unknown },
      component: unknown,
    ): unknown
  }
  modelDirectories: {
    directoryFor(sessionId: string): {
      store: Store<DirectoryState>
      load(): Promise<unknown>
      select(selection: DirectorySelection): Promise<{ error?: { message?: string } }>
    }
  }
  sessions: {
    binding(sessionId: string): { session: SessionFacts } | undefined
    list: SessionList
    subagentAddress(sessionId: string): unknown
  }
}

/** Below the composer card, where the harness shows its own context meter for its models. */
const DOCK_SLOT = 'conversation.composer.dock'
const SESSION_ROW_SLOT = 'sidebar.session.row.leading'
/** Runs after the harness's own marks, which outrank this one in the row's single cell. */
const SESSION_MARK_ORDER = 20
const SESSION_MARK_CLASS = 'dsh-cli-session-mark'

// A session row has one 16px cell, so this mark gives way to whichever occupant the harness
// put there first.
const STYLES = `
.${SESSION_MARK_CLASS} { display: inline-flex; color: var(--dsw-alias-label-secondary); }
[data-slot="${SESSION_ROW_SLOT}"] > * ~ .${SESSION_MARK_CLASS} { display: none; }
`

// Looked up on each call: touching `localStorage` can throw where storage is blocked, and
// that should cost the startup scripts, not the plugin's start.
const BROWSER_STORAGE: ScriptStorage & FeatureStorage & CliPrefsStorage & ExpansionStorage & LastSelectionsStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value)
  },
}

function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-ccgui'
  tag.textContent = `${STYLES}${PICKER_STYLES}${TERMINAL_ENTRY_STYLES}${LAUNCH_SCRIPT_STYLES}${SESSION_TREE_STYLES}${SESSION_STATUS_STYLES}${SETTINGS_PAGE_STYLES}${CHANGES_STYLES}${WORKTREE_STYLES}${WORKTREE_GROUP_STYLES}${CONTEXT_METER_STYLES}`
  document.head.append(tag)
  return () => {
    tag.remove()
  }
}

function SessionMark({ sessionId, list }: { readonly sessionId: string; readonly list: SessionList }) {
  const provider = useSessionProvider(list, sessionId)
  if (provider === undefined) return null
  return (
    <span className={SESSION_MARK_CLASS}>
      <ProviderMark provider={provider} size={14} />
    </span>
  )
}

function directoryFace(ctx: ClientContext, sessionId: string): DirectoryFace {
  const directory = ctx.modelDirectories.directoryFor(sessionId)
  return {
    directory: directory.store,
    load: () => {
      directory.load().catch(() => {
        /* a failed catalog load lands in the directory's error, which the picker shows */
      })
    },
    select: (selection: DirectorySelection) => directory.select(selection),
    session: ctx.sessions.binding(sessionId)?.session,
  }
}

/**
 * Register the switchable features, each through a context whose `inject` makes its
 * registrations come and go with the feature's switch.
 * @param ctx - the plugin's client context.
 * @param settings - the feature settings.
 */
function registerSwitchableFeatures(ctx: ClientContext, settings: FeatureSettings): void {
  const terminal: TerminalEntryContext = {
    slots: ctx.slots,
    inject: gateInject(ctx, settings, 'terminalEntry', (deps, apply) => ctx.inject(deps, apply)),
  }
  const files: FilesDefaultContext = {
    inject: gateInject(ctx, settings, 'filesDefault', (deps, apply) => ctx.inject(deps, apply)),
  }
  const scripts: LaunchScriptContext = {
    slots: ctx.slots,
    inject: gateInject(ctx, settings, 'launchScripts', (deps, apply) => ctx.inject(deps, apply)),
  }
  registerTerminalEntry(terminal)
  const changes: ChangesContext = {
    inject: gateInject(ctx, settings, 'gitChanges', (deps, apply) => ctx.inject(deps, apply)),
  }
  const worktree: WorktreeContext = {
    inject: gateInject(ctx, settings, 'worktree', (deps, apply) => ctx.inject(deps, apply)),
  }
  registerFilesDefault(files)
  // window.fetch needs its receiver, so it is wrapped rather than passed bare.
  const fetchFn = (input: string, init: RequestInit): Promise<Response> => window.fetch(input, init)
  registerChanges(changes, ctx.sessions.list, fetchFn)
  registerWorktree(worktree, fetchFn, BROWSER_STORAGE)
  registerLaunchScripts(scripts, ctx.sessions.list, BROWSER_STORAGE, () => crypto.randomUUID())
  ctx.effect(() => whileEnabled(settings, 'compactTabs', () => installCompactTabs(document)), 'ccgui: compact tabs')
}

export const inject = ['slots', 'modelDirectories', 'sessions']

/**
 * Put the model picker in the composer and the CLI's mark on each session row.
 * @param ctx - the plugin's client context.
 * @param cliPrefs - the remembered provider order, which the picker's tabs follow.
 */
function registerComposerSlots(ctx: ClientContext, cliPrefs: CliPrefs): void {
  registerPicker(ctx, {
    face: (sessionId) => directoryFace(ctx, sessionId),
    available: (sessionId) => ctx.sessions.subagentAddress(sessionId) === undefined,
    // `window.fetch` needs its receiver, so it is wrapped rather than passed bare.
    modes: (sessionId) => modeApiFor((input, init) => window.fetch(input, init), sessionId),
    prefs: cliPrefs,
    lastSelections: createLastSelections(BROWSER_STORAGE),
  })
  ctx.slots.inject(SESSION_ROW_SLOT, () =>
    ctx.slots.register(
      {
        name: SESSION_ROW_SLOT,
        id: 'dsh-ccgui.session-mark',
        order: SESSION_MARK_ORDER,
        inject: () => ({ list: ctx.sessions.list }),
      },
      SessionMark,
    ),
  )
}

/**
 * Put the CLI session's context meter below the composer, where the harness shows its own. The
 * harness's meter stays empty on a CLI session, so the two never show together.
 * @param ctx - the plugin's client context.
 */
function registerContextMeter(ctx: ClientContext): void {
  ctx.slots.inject(DOCK_SLOT, () =>
    ctx.slots.register(
      {
        name: DOCK_SLOT,
        id: 'dsh-ccgui.context-meter',
        inject: (sessionId) => ({
          ...directoryFace(ctx, sessionId),
          // `window.fetch` needs its receiver, so it is wrapped rather than passed bare.
          context: contextApiFor((input, init) => window.fetch(input, init), sessionId),
        }),
      },
      CliContextMeter,
    ),
  )
}

/**
 * Mark each session row and its header with the CLI it runs on.
 * @param ctx - the plugin's client context.
 */
function registerSessionMarks(ctx: ClientContext): void {
  ctx.slots.inject(SESSION_STATUS_SLOT, () =>
    ctx.slots.register(
      { name: SESSION_STATUS_SLOT, id: 'dsh-ccgui.session-status-mark', inject: () => ({ list: ctx.sessions.list }) },
      SessionStatusMark,
    ),
  )
}

/**
 * Add the model picker to the composer, and a terminal button to the header.
 * @param ctx - the plugin's client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'ccgui: styles')
  const cliPrefs = createCliPrefs(BROWSER_STORAGE)
  registerComposerSlots(ctx, cliPrefs)
  registerContextMeter(ctx)
  registerSessionMarks(ctx)
  const settings = createFeatureSettings(BROWSER_STORAGE)
  // window.fetch needs its receiver, so it is wrapped rather than passed bare.
  const cliSwitches = createCliSwitches(
    createCliSwitchApi((input, init) => window.fetch(input, init)),
    () => cliPrefs.getSnapshot().hidden,
  )
  registerSettingsPage(ctx, settings, {
    cliPrefs,
    cliSwitches,
    // `window.fetch` needs its receiver, so it is wrapped rather than passed bare.
    commitSettings: createCommitSettingsApi((input, init) => window.fetch(input, init)),
  })
  registerSwitchableFeatures(ctx, settings)
  registerAddToChat(ctx)
}
