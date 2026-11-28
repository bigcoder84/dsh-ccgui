import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { commitMessageHandler, registerCommitMessageRoute } from '../../src/commit/commit-route.ts'
import type { CommitRouteDeps } from '../../src/commit/commit-route.ts'
import { CommitSuggestError } from '../../src/commit/commit-suggest.ts'
import type { SuggestLlm } from '../../src/commit/commit-suggest.ts'
import { COMMIT_MESSAGE_ROUTE } from '../../src/constants.ts'
import { collectingSpawn } from '../fixtures/collecting-subprocess.ts'

let repo = ''
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ccgui-commit-route-'))
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.ts'), 'changed\n')
})

afterEach(() => {
  // A git process may still be writing its index when the test ends, which a single pass races.
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A model that answers with `answer`, or never answers while `hang` is set. */
function llmAnswering(answer: string, hang = false): SuggestLlm {
  return {
    prepareCall: async (config) => ({
      config,
      async *stream(options) {
        if (hang) {
          await new Promise((resolve) => {
            if (options.signal?.aborted === true) resolve(undefined)
            options.signal?.addEventListener('abort', resolve)
          })
        }
        yield { type: 'text-delta', index: 0, text: answer } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }),
  }
}

/** A response that records its answer and can be closed early, as a cancelled fetch does. */
class FakeResponse extends EventEmitter {
  status = 0
  body = ''
  writableEnded = false
  writeHead(status: number): this {
    this.status = status
    return this
  }
  end(chunk?: string): this {
    this.body = chunk ?? ''
    this.writableEnded = true
    return this
  }
}

type Service = CommitRouteDeps['service']

const SERVICE: Service = {
  route: async () => ({ provider: 'deepseek', model: 'chat' }),
  prompt: () => '',
  view: async () => ({ model: null, prompt: '', defaultPrompt: 'p', fallback: null, models: [], errors: [] }),
  save: async () => ({ model: null, prompt: 'saved', defaultPrompt: 'p', fallback: null, models: [], errors: [] }),
}

interface PostOptions {
  readonly rejection?: 401
  readonly method?: string
  readonly url?: string
  readonly service?: Partial<Service>
  readonly deps?: Partial<CommitRouteDeps>
  readonly onResponse?: (res: FakeResponse) => void
}

async function post(body: unknown, options: PostOptions = {}) {
  const warn = vi.fn()
  const deps: CommitRouteDeps = {
    spawn: collectingSpawn,
    llm: () => llmAnswering('feat: add a'),
    service: { ...SERVICE, ...options.service },
    warn,
    ...options.deps,
  }
  const res = new FakeResponse()
  options.onResponse?.(res)
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign(Readable.from([Buffer.from(text)]), {
    method: options.method ?? 'POST',
    url: options.url ?? COMMIT_MESSAGE_ROUTE,
    headers: {},
  }) as unknown as IncomingMessage
  await commitMessageHandler(deps, { requestRejection: () => options.rejection })(req, res as unknown as ServerResponse)
  return { status: res.status, json: res.body === '' ? undefined : (JSON.parse(res.body) as unknown), warn }
}

describe('commit message route', () => {
  it('answers with a message for the selected files', async () => {
    const result = await post({ cwd: repo, paths: ['a.ts'] })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({
      success: true,
      data: { message: 'feat: add a', model: { provider: 'deepseek', model: 'chat' } },
    })
  })

  it('refuses a request the connection rejects, and anything but POST', async () => {
    expect((await post({ cwd: repo, paths: ['a.ts'] }, { rejection: 401 })).status).toBe(401)
    expect((await post({}, { method: 'GET' })).status).toBe(405)
  })

  it.each([
    ['a body that is not JSON', 'nope'],
    ['a relative directory', { cwd: 'repo', paths: ['a.ts'] }],
    ['no paths', { cwd: '/tmp', paths: [] }],
    ['a path leaving the repository', { cwd: '/tmp', paths: ['../x'] }],
    ['an absolute path', { cwd: '/tmp', paths: ['/etc/passwd'] }],
  ])('answers 400 for %s', async (_name, body) => {
    expect((await post(body)).status).toBe(400)
  })

  it('answers 400 outside a repository', async () => {
    const result = await post({ cwd: tmpdir(), paths: ['a.ts'] })
    expect(result).toMatchObject({ status: 400, json: { success: false, error: '当前工作区不是 Git 仓库' } })
  })

  it('answers 409 with what the user can do about a missing model', async () => {
    const route = async () => {
      throw new CommitSuggestError('还没有模型')
    }
    const result = await post({ cwd: repo, paths: ['a.ts'] }, { service: { route } })
    expect(result).toMatchObject({ status: 409, json: { success: false, error: '还没有模型' } })
    expect(result.warn).not.toHaveBeenCalled()
  })

  it('logs a failure that is not the user’s doing', async () => {
    const route = async () => {
      throw new Error('boom')
    }
    const result = await post({ cwd: repo, paths: ['a.ts'] }, { service: { route } })
    expect(result.status).toBe(500)
    expect(result.warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  // The panel's 停止 aborts its fetch; the model call must not keep running for nobody.
  it('stops the model call when the request goes away, answering nothing', async () => {
    let stopped = false
    const llm = llmAnswering('feat: never', true)
    const hanging: SuggestLlm = {
      prepareCall: async (config, signal, configure) => {
        const stop = (): void => {
          stopped = true
        }
        if (signal?.aborted === true) stop()
        signal?.addEventListener('abort', stop)
        return llm.prepareCall(config, signal, configure)
      },
    }
    const result = await post(
      { cwd: repo, paths: ['a.ts'] },
      {
        deps: { llm: () => hanging },
        onResponse: (res) => {
          setTimeout(() => res.emit('close'), 50)
        },
      },
    )
    expect(stopped).toBe(true)
    expect(result.json).toBeUndefined()
  })

  it('reads and saves the settings below the route', async () => {
    const save = vi.fn(SERVICE.save)
    const read = await post({}, { url: `${COMMIT_MESSAGE_ROUTE}/settings` })
    expect(read.json).toMatchObject({ success: true, data: { defaultPrompt: 'p' } })
    const saved = await post(
      { model: null, prompt: 'x' },
      { url: `${COMMIT_MESSAGE_ROUTE}/save?v=1`, service: { save } },
    )
    expect(saved.json).toMatchObject({ success: true, data: { prompt: 'saved' } })
    expect(save).toHaveBeenCalledWith({ model: null, prompt: 'x' })
  })

  it('answers 400 for an operation it does not know', async () => {
    expect((await post({}, { url: `${COMMIT_MESSAGE_ROUTE}/nope` })).status).toBe(400)
  })

  it('registers under its path', () => {
    const register = vi.fn(() => () => {})
    registerCommitMessageRoute({ register }, {} as CommitRouteDeps, { requestRejection: () => undefined })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: COMMIT_MESSAGE_ROUTE }))
  })
})
