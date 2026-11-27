/**
 * Maps harness sessions to their live CLI sessions, and follows each session's log
 * to know where its turns begin and end. It holds no framework state, so `index.ts`
 * can stay plain wiring.
 * @module dsh-ccgui/session-registry
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { CliSession, PermissionAsk } from './cli-session.ts'
import { CLI_TOOL_NAME, cliRoute, DEFAULT_MODEL_ID } from './constants.ts'
import type { CliChoiceList, CliModeList, CliSpeedList } from './model-options.ts'
import type { PtcWrap } from './session/ptc-call.ts'
import type { ToolOutcome } from './tool-record.ts'

/** One CLI that speaks ACP over stdio. */
export interface CliAgentConfig {
  /** Names the provider route: `cli-<id>`. */
  id: string
  /** Display name in menus and messages. */
  name: string
  /** Executable to start. */
  command: string
  /** Arguments that make it serve ACP on stdio. */
  args: string[]
  /** Added to the scrubbed environment; the place for this CLI's own credentials. */
  env: Record<string, string>
}

/** What a new CLI session inherits from the one it replaces. */
export interface SessionStart {
  readonly sentMessageIds: ReadonlySet<string>
  /** Settles once the previous process has stopped. */
  readonly after: Promise<void>
  /** A native mode picked before this session existed, for the same CLI. */
  readonly initialMode?: string
  /** Told when the CLI would not take that mode, so no replacement starts on it again. */
  readonly onModeRefused?: (mode: string) => void
  /** A fast mode picked before this session existed, for the same CLI. */
  readonly initialSpeed?: string
  /** Told when the CLI would not take that fast mode, so no replacement starts on it again. */
  readonly onSpeedRefused?: (value: string) => void
}

/** The harness facilities the registry uses. */
export interface RegistryDeps {
  getAgent(sessionId: string): Agent | undefined
  /** The preset this agent runs under, if any. */
  composedPreset(agent: Agent): string | undefined
  /** How the host's PTC runtime takes a mirrored call; undefined when it cannot. */
  ptcWrap(): PtcWrap | undefined
  ask(agent: Agent, request: PermissionAsk, signal: AbortSignal): Promise<ApprovalOutcome>
  warn(message: string): void
  /** Someone chose this CLI, so starting it is now acceptable. */
  onCliSelected(provider: string): void
  createSession(config: CliAgentConfig, sessionId: string, cwd: string, start: SessionStart): CliSession
}

/** The fields of a session log event the registry reads. */
export interface ObservedEvent {
  readonly type: string
  readonly data?: unknown
}

interface LiveSession {
  readonly provider: string
  readonly session: CliSession
}

/** The CLI settings a user can pick before the CLI has started. */
type Setting = 'mode' | 'speed'

/** A setting picked for one CLI route. */
interface PickedValue {
  readonly provider: string
  readonly value: string
}

/** What is known of one setting, and a pick the CLI has not confirmed. */
interface SettingState {
  readonly list?: CliChoiceList
  readonly pending?: string
}

const ERROR_CODES: Readonly<Record<Setting, string>> = { mode: 'CLI_MODE_FAILED', speed: 'CLI_SPEED_FAILED' }

const NO_MESSAGES: ReadonlySet<string> = new Set()
/** This preset's tool executor only accepts `run_code`, so mirrored calls go out wrapped in it. */
const PTC_PRESET = 'ptc'

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  return new Map([...map].filter(([candidate]) => candidate !== key))
}

/** Owns every live CLI session in this process. */
export class CliSessionRegistry {
  private readonly agentsByProvider: ReadonlyMap<string, CliAgentConfig>
  private sessions: ReadonlyMap<string, LiveSession> = new Map()
  private stopping: ReadonlyMap<string, Promise<void>> = new Map()
  private turnMessages: ReadonlyMap<string, ReadonlySet<string>> = new Map()
  /** Settings picked while their session had no CLI yet, by setting and harness session. */
  private picks: Readonly<Record<Setting, ReadonlyMap<string, PickedValue>>> = { mode: new Map(), speed: new Map() }

  constructor(
    agents: readonly CliAgentConfig[],
    private readonly deps: RegistryDeps,
  ) {
    this.agentsByProvider = new Map(agents.map((agent) => [cliRoute(agent.id), agent]))
  }

  /** Provider routes of all configured CLIs. */
  get providers(): readonly string[] {
    return [...this.agentsByProvider.keys()]
  }

  /**
   * Read a route's display name.
   * @param provider - a provider route.
   * @returns the CLI's name, or undefined for any other route.
   */
  labelFor(provider: string): string | undefined {
    return this.agentsByProvider.get(provider)?.name
  }

  /**
   * Check whether a provider route is one of the configured CLIs.
   * @param provider - a provider route.
   * @returns whether it is.
   */
  isCliRoute(provider: string): boolean {
    return this.agentsByProvider.has(provider)
  }

  /**
   * Read the CLI behind a route.
   * @param provider - a provider route.
   * @returns its configuration, if it is a CLI.
   */
  configFor(provider: string): CliAgentConfig | undefined {
    return this.agentsByProvider.get(provider)
  }

  /**
   * Point an agent at the CLI its preset stands for. A preset whose id is a CLI route
   * selects that CLI, unless the session already chose one of its models. A session that
   * opens on a CLI counts as choosing it.
   * @param agent - the agent being announced or switched.
   */
  routeAgent(agent: Agent): void {
    const preset = this.deps.composedPreset(agent)
    if (preset !== undefined && this.agentsByProvider.has(preset) && agent.model.current()?.provider !== preset) {
      agent.model.select({ provider: preset, model: DEFAULT_MODEL_ID })
    }
    this.noticeSelection(agent.model.current()?.provider)
  }

  /**
   * Follow one session log event. Tracking turns live is what keeps a prompt from
   * being sent twice: a failed turn leaves its message at the end of the history, and
   * only messages logged since the latest `turn/start` count as new. That holds across
   * a closed session, a replaced process, and a restart, with nothing extra to persist.
   * @param sessionId - the harness session.
   * @param event - the logged event.
   */
  observeEvent(sessionId: string, event: ObservedEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.turnMessages = new Map([...this.turnMessages, [sessionId, new Set<string>()]])
        return
      case 'user/message':
        this.recordTurnMessage(sessionId, (event.data as { id?: unknown } | undefined)?.id)
        return
      case 'turn/end':
        this.turnMessages = without(this.turnMessages, sessionId)
        this.sessions.get(sessionId)?.session.abandonTurn()
        return
      case 'model/selection':
        this.noticeSelection((event.data as { provider?: unknown } | undefined)?.provider)
        return
      default:
    }
  }

  /**
   * Read which user messages belong to a session's open turn.
   * @param sessionId - the harness session.
   * @returns their ids; empty outside a turn.
   */
  currentTurnMessageIds(sessionId: string): ReadonlySet<string> {
    return this.turnMessages.get(sessionId) ?? NO_MESSAGES
  }

  /**
   * Read the model a session has selected, which applies with its next message.
   * @param sessionId - the harness session.
   * @returns the model id, or undefined when the session or its selection is unknown.
   */
  selectedModel(sessionId: string): string | undefined {
    return this.deps.getAgent(sessionId)?.model.current()?.model
  }

  /**
   * Whether a session has a CLI session on this route, started or about to start.
   * @param sessionId - the harness session.
   * @param provider - the CLI route the composer is showing.
   * @returns true once the first step has created it, until it is stopped.
   */
  isLive(sessionId: string, provider: string): boolean {
    return this.sessions.get(sessionId)?.provider === provider
  }

  /**
   * Read the native modes a CLI reported for a session. A live CLI's own answer wins: it
   * may have changed mode during a turn, after the catalog last heard from it, and only it
   * knows whether a pick is still on its way.
   * @param sessionId - the harness session.
   * @param provider - the CLI route the menu is showing.
   * @returns the modes in the CLI's own ids and names, and a pick the CLI has not confirmed.
   */
  modeStateFor(sessionId: string, provider: string): { readonly modes?: CliModeList; readonly pending?: string } {
    const { list, ...pending } = this.stateFor('mode', sessionId, provider)
    return { ...(list === undefined ? {} : { modes: list }), ...pending }
  }

  /**
   * Read the fast mode a CLI reported for a session, read like {@link modeStateFor}.
   * @param sessionId - the harness session.
   * @param provider - the CLI route the composer is showing.
   * @returns the fast mode in the CLI's own values, and a pick the CLI has not confirmed.
   */
  speedStateFor(sessionId: string, provider: string): { readonly speed?: CliSpeedList; readonly pending?: string } {
    const { list, ...pending } = this.stateFor('speed', sessionId, provider)
    return { ...(list === undefined ? {} : { speed: list }), ...pending }
  }

  /**
   * Switch a session to one of its CLI's own modes, by the id that CLI reported. A pick
   * made before the CLI started is kept and sent with its first step, and is what a
   * replacement session starts on.
   * @param sessionId - the harness session.
   * @param provider - the CLI route the menu is showing.
   * @param mode - the mode id, unchanged.
   * @returns the modes as the CLI reports them, or undefined while there is no CLI to ask.
   * @throws when the route is not a configured CLI, or the CLI refuses the change.
   */
  async switchMode(sessionId: string, provider: string, mode: string): Promise<CliModeList | undefined> {
    return this.switchSetting('mode', sessionId, provider, mode)
  }

  /**
   * Turn a session's fast mode on or off, held and handed over like a mode; see {@link switchMode}.
   * @param sessionId - the harness session.
   * @param provider - the CLI route the composer is showing.
   * @param value - the value, unchanged.
   * @returns the fast mode as the CLI reports it, or undefined while there is no CLI to ask.
   * @throws when the route is not a configured CLI, or the CLI refuses the change.
   */
  async switchSpeed(sessionId: string, provider: string, value: string): Promise<CliSpeedList | undefined> {
    return this.switchSetting('speed', sessionId, provider, value)
  }

  /**
   * Decide whether a step's tool calls go out wrapped in `run_code`.
   * @param provider - the requested CLI route.
   * @param sessionId - the harness session.
   * @returns the wrap in PTC mode, otherwise undefined.
   * @throws when the PTC runtime cannot run the wrapping program: every mirrored call
   *   would be refused while the CLI carried on doing the work unseen.
   */
  ptcWrapFor(provider: string, sessionId: string): PtcWrap | undefined {
    const agent = this.deps.getAgent(sessionId)
    if (agent === undefined || this.deps.composedPreset(agent) !== PTC_PRESET) return undefined
    const wrap = this.deps.ptcWrap()
    if (wrap !== undefined) return wrap
    const name = this.labelFor(provider) ?? provider
    throw new LlmError(`${name} 不支持当前的 PTC 运行时，请切回标准模式。`, 'CLI_WRONG_PRESET')
  }

  /**
   * Find or create the CLI session for a harness session.
   * @param provider - the requested CLI route.
   * @param sessionId - the harness session.
   * @returns a CLI session; a dead one is returned until its failure has been read.
   */
  resolveSession(provider: string, sessionId: string): CliSession {
    const config = this.agentsByProvider.get(provider)
    if (config === undefined) throw new LlmError(`未知的 CLI 路由：${provider}`, 'CLI_START_FAILED')
    const agent = this.deps.getAgent(sessionId)
    if (agent === undefined) throw new LlmError(`找不到会话 ${sessionId}。`, 'CLI_START_FAILED')
    const current = this.sessions.get(sessionId)
    if (current?.provider === provider && !current.session.replaceable) return current.session
    this.stopSession(sessionId)
    const { cwd } = agent.session.header
    if (cwd === undefined) throw new LlmError(`${config.name} 需要工作目录，但这个会话没有。`, 'CLI_START_FAILED')
    const session = this.deps.createSession(config, sessionId, cwd, {
      sentMessageIds: current?.session.sentMessageIds ?? NO_MESSAGES,
      after: this.stopping.get(sessionId) ?? Promise.resolve(),
      ...this.startSettings(sessionId, provider),
    })
    this.sessions = new Map([...this.sessions, [sessionId, { provider, session }]])
    return session
  }

  /**
   * Wait for the CLI's result of one mirrored call. A CLI asks for permission only
   * when its own native mode says to; the bridge forwards that request unchanged and
   * never grants a call on the harness's behalf.
   * @param exec - the tool execution; its call id identifies the CLI call.
   * @returns the finished call's outcome.
   */
  async waitForTool(exec: ToolRunContext): Promise<ToolOutcome> {
    const { agent, callId, signal } = exec
    const session = agent === undefined ? undefined : this.sessions.get(agent.id)?.session
    if (agent === undefined || session === undefined) {
      throw new Error(`${CLI_TOOL_NAME} 只记录 CLI 发出的调用，不能直接使用。`)
    }
    return session.waitForTool(callId, (request, askSignal) => this.deps.ask(agent, request, askSignal), signal)
  }

  /**
   * Forget a harness session and stop its CLI, if it has one.
   * @param sessionId - the harness session.
   */
  disposeSession(sessionId: string): void {
    this.turnMessages = without(this.turnMessages, sessionId)
    this.picks = { mode: without(this.picks.mode, sessionId), speed: without(this.picks.speed, sessionId) }
    this.stopSession(sessionId)
  }

  /**
   * Stop every CLI.
   * @param reason - why, shown to any turn this cuts off.
   */
  disposeAll(reason?: string): void {
    for (const sessionId of this.sessions.keys()) {
      this.turnMessages = without(this.turnMessages, sessionId)
      this.stopSession(sessionId, reason)
    }
  }

  private noticeSelection(provider: unknown): void {
    if (typeof provider === 'string' && this.agentsByProvider.has(provider)) this.deps.onCliSelected(provider)
  }

  /** A live CLI's own answer wins: only it knows whether a pick is still on its way. */
  private stateFor(setting: Setting, sessionId: string, provider: string): SettingState {
    const live = this.sessions.get(sessionId)
    if (live?.provider === provider) {
      const { session } = live
      const [list, pending] =
        setting === 'mode' ? [session.modes, session.pendingMode] : [session.speed, session.pendingSpeed]
      return { ...(list === undefined ? {} : { list }), ...(pending === undefined ? {} : { pending }) }
    }
    const picked = this.pickFor(setting, sessionId, provider)
    return picked === undefined ? {} : { pending: picked }
  }

  private async switchSetting(
    setting: Setting,
    sessionId: string,
    provider: string,
    value: string,
  ): Promise<CliChoiceList | undefined> {
    if (!this.agentsByProvider.has(provider)) throw new LlmError(`未知的 CLI 路由：${provider}`, ERROR_CODES[setting])
    this.picks = { ...this.picks, [setting]: new Map([...this.picks[setting], [sessionId, { provider, value }]]) }
    const live = this.sessions.get(sessionId)
    if (live?.provider !== provider) return undefined
    try {
      return await (setting === 'mode' ? live.session.switchMode(value) : live.session.switchSpeed(value))
    } catch (error: unknown) {
      // The CLI refused the change, so the pick must not resurface with a later step.
      this.forgetPick(setting, sessionId, value)
      throw error
    }
  }

  /** The value picked for this route, if any. */
  private pickFor(setting: Setting, sessionId: string, provider: string): string | undefined {
    const picked = this.picks[setting].get(sessionId)
    return picked?.provider === provider ? picked.value : undefined
  }

  /**
   * Settings picked before the CLI started, if they were picked for this route. The refusal
   * callbacks go with every session: a pick made while its CLI is still starting is settled
   * with the first message too, and a refused one must not come back with a replacement.
   */
  private startSettings(
    sessionId: string,
    provider: string,
  ): Pick<SessionStart, 'initialMode' | 'onModeRefused' | 'initialSpeed' | 'onSpeedRefused'> {
    const mode = this.pickFor('mode', sessionId, provider)
    const speed = this.pickFor('speed', sessionId, provider)
    return {
      ...(mode === undefined ? {} : { initialMode: mode }),
      ...(speed === undefined ? {} : { initialSpeed: speed }),
      onModeRefused: (value) => this.forgetPick('mode', sessionId, value),
      onSpeedRefused: (value) => this.forgetPick('speed', sessionId, value),
    }
  }

  /** Drop a refused pick, unless the user has picked another since. */
  private forgetPick(setting: Setting, sessionId: string, value: string): void {
    if (this.picks[setting].get(sessionId)?.value !== value) return
    this.picks = { ...this.picks, [setting]: without(this.picks[setting], sessionId) }
  }

  private recordTurnMessage(sessionId: string, id: unknown): void {
    const messages = this.turnMessages.get(sessionId)
    if (messages === undefined || typeof id !== 'string') return
    this.turnMessages = new Map([...this.turnMessages, [sessionId, new Set([...messages, id])]])
  }

  /** Stop the process only; the harness session and its open turn carry on. */
  private stopSession(sessionId: string, reason?: string): void {
    const live = this.sessions.get(sessionId)
    if (live === undefined) return
    this.sessions = without(this.sessions, sessionId)
    const stoppedSelf = live.session.dispose(false, reason).catch((error: unknown) => {
      this.deps.warn(`ccgui: failed to stop ${live.provider}: ${String(error)}`)
    })
    // Chained so that quick replacements still wait for the oldest process, not
    // only the latest one, which may never have started.
    const stopped = Promise.all([this.stopping.get(sessionId), stoppedSelf]).then(() => {
      if (this.stopping.get(sessionId) === stopped) this.stopping = without(this.stopping, sessionId)
    })
    this.stopping = new Map([...this.stopping, [sessionId, stopped]])
  }
}
