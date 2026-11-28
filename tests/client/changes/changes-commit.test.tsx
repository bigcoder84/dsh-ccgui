// @vitest-environment jsdom
/// <reference lib="dom" />

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangesPanel } from '../../../src/client/changes/changes-panel.tsx'
import type { CwdList } from '../../../src/client/changes/changes-panel.tsx'
import type { Fetch } from '../../../src/client/changes/changes-api.ts'
import type { RepoStatus } from '../../../src/client/changes/changes-model.ts'

const STATUS: RepoStatus = {
  repo: true,
  root: '/work',
  branch: 'main',
  ahead: 0,
  behind: 0,
  staged: [{ path: 'src/a.ts', status: 'M', additions: 3, deletions: 1 }],
  unstaged: [],
  untracked: [{ path: 'notes.md', status: '?', additions: 4 }],
}

const ok = (data: unknown): Response => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const refused = (error: string): Response => new Response(JSON.stringify({ success: false, error }), { status: 409 })

type Suggest = (body: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<Response>

function server(suggest: Suggest, status: RepoStatus = STATUS) {
  const bodies: Record<string, unknown>[] = []
  const fetchFn = vi.fn<Fetch>((url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
    if (url !== '/dsh-ccgui/commit-message') return Promise.resolve(ok(status))
    bodies.push(body)
    return suggest(body, init.signal ?? undefined)
  })
  return { fetchFn, bodies }
}

const list: CwdList = { subscribe: () => () => undefined, getSnapshot: () => ({ byId: { s1: { cwd: '/work' } } }) }
const message = (): string => screen.getByLabelText<HTMLTextAreaElement>('提交信息').value

afterEach(() => {
  cleanup()
})

describe('AI commit message', () => {
  it('writes a message for the selected files into the box', async () => {
    const suggestion = {
      message: 'feat: add a',
      model: { provider: 'd', model: 'm' },
      coverage: { files: 1, diffFiles: 1, truncated: false },
    }
    const { fetchFn, bodies } = server(() => Promise.resolve(ok(suggestion)))
    const user = userEvent.setup()
    render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    await user.click(await screen.findByRole('button', { name: 'AI 生成提交信息' }))
    await waitFor(() => {
      expect(message()).toBe('feat: add a')
    })
    expect(bodies).toEqual([{ cwd: '/work', paths: ['src/a.ts'] }])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says how much of a large change the model saw, and passes on its warning', async () => {
    const suggestion = {
      message: 'feat: many',
      model: { provider: 'd', model: 'm' },
      coverage: { files: 40, diffFiles: 12, truncated: true },
      warning: '模型的输出被截断',
    }
    const { fetchFn } = server(() => Promise.resolve(ok(suggestion)))
    const user = userEvent.setup()
    render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    await user.click(await screen.findByRole('button', { name: 'AI 生成提交信息' }))
    expect(await screen.findByText('模型的输出被截断 改动较多，模型只看了 12 / 40 个文件的 diff')).toBeTruthy()
    // Editing the message makes the note about the old answer stale.
    await user.type(screen.getByLabelText('提交信息'), '!')
    expect(screen.queryByText(/模型只看了/)).toBeNull()
  })

  it('shows why it failed and leaves the message alone', async () => {
    const { fetchFn } = server(() => Promise.resolve(refused('还没有生成提交信息用的模型')))
    const user = userEvent.setup()
    render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    await user.type(await screen.findByLabelText('提交信息'), 'draft')
    await user.click(screen.getByRole('button', { name: 'AI 生成提交信息' }))
    expect((await screen.findByRole('alert')).textContent).toBe('还没有生成提交信息用的模型')
    expect(message()).toBe('draft')
  })

  it('turns into 停止 while it runs, and stopping cancels the request', async () => {
    let seen: AbortSignal | undefined
    const { fetchFn } = server(
      (_body, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const user = userEvent.setup()
    render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    await user.click(await screen.findByRole('button', { name: 'AI 生成提交信息' }))
    await user.click(await screen.findByRole('button', { name: '停止生成' }))
    expect(seen?.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: 'AI 生成提交信息' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels a run still going when the panel goes away', async () => {
    let seen: AbortSignal | undefined
    const { fetchFn } = server((_body, signal) => {
      seen = signal
      return new Promise(() => undefined)
    })
    const user = userEvent.setup()
    const view = render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    await user.click(await screen.findByRole('button', { name: 'AI 生成提交信息' }))
    view.unmount()
    expect(seen?.aborted).toBe(true)
  })

  it('cannot run with nothing selected', async () => {
    const { fetchFn } = server(() => Promise.resolve(ok({})), { ...STATUS, staged: [] })
    render(<ChangesPanel sessionId="s1" list={list} fetch={fetchFn} />)
    expect(await screen.findByRole('button', { name: 'AI 生成提交信息' })).toHaveProperty('disabled', true)
  })
})
