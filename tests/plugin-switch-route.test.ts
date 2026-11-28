import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE, SILENT, harness, load, stopStarted } from './fixtures/plugin-harness.ts'
import type { Harness } from './fixtures/plugin-harness.ts'

afterEach(stopStarted)

interface Route {
  readonly path: string
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>
}

/** Capture the routes the plugin serves once its web dependencies are there. */
async function switchRoute(h: Harness): Promise<Route> {
  const routes: Route[] = []
  h.root.provide('webServer', {
    register: (route: Route) => {
      routes.push(route)
      return () => undefined
    },
  })
  h.root.provide('connection', { requestRejection: () => undefined })
  await vi.waitFor(() => {
    expect(routes.some((route) => route.path === '/dsh-ccgui/clis')).toBe(true)
  })
  const route = routes.find((candidate) => candidate.path === '/dsh-ccgui/clis')
  if (route === undefined) throw new Error('no switch route')
  return route
}

async function post(route: Route, body: unknown): Promise<Record<string, unknown>> {
  let text = ''
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: {} })
  const res = {
    writeHead: () => undefined,
    end: (chunk?: string) => {
      text = chunk ?? ''
    },
  } as unknown as ServerResponse
  await route.handler(req as unknown as IncomingMessage, res)
  return JSON.parse(text) as Record<string, unknown>
}

const registered = (h: Harness): readonly string[] => h.adapters.flatMap((entry) => entry.providers)
const switchesFile = (h: Harness): string => join(h.dshHome, 'ccgui', 'cli-switches.json')

describe('CliBridge CLI switches', () => {
  it('registers only the CLIs switched on, as saved by an earlier run', async () => {
    const h = harness()
    mkdirSync(join(h.dshHome, 'ccgui'), { recursive: true })
    writeFileSync(switchesFile(h), JSON.stringify({ version: 1, disabled: ['cli-silent'] }))
    await load(h, { agents: [FAKE, SILENT] })
    expect(registered(h)).toEqual(['cli-fake'])
  })

  // Switched off, a CLI leaves the harness's providers at once; switched back on, it returns.
  it('takes a CLI out of the providers and puts it back, saving each choice', async () => {
    const h = harness()
    await load(h, { agents: [FAKE, SILENT] })
    const route = await switchRoute(h)
    expect(registered(h)).toEqual(['cli-fake', 'cli-silent'])

    await expect(post(route, { provider: 'cli-silent', enabled: false })).resolves.toEqual({
      success: true,
      data: {
        clis: [
          { id: 'cli-fake', label: 'Fake CLI', enabled: true },
          { id: 'cli-silent', label: 'Silent CLI', enabled: false },
        ],
        saved: true,
      },
    })
    expect(registered(h)).toEqual(['cli-fake'])
    expect(JSON.parse(readFileSync(switchesFile(h), 'utf8'))).toEqual({ version: 1, disabled: ['cli-silent'] })

    await post(route, { provider: 'cli-silent', enabled: true })
    expect(registered(h)).toEqual(['cli-fake', 'cli-silent'])
  })

  it('moves the default for new sessions off a CLI switched off', async () => {
    const h = harness()
    const saveSelection = vi.fn(() => Promise.resolve())
    h.root.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'cli-silent', model: 'default' }),
      saveSelection,
    })
    await load(h, { agents: [FAKE, SILENT] })
    const route = await switchRoute(h)
    await post(route, { provider: 'cli-silent', enabled: false, order: ['cli-silent', 'cli-fake'] })
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'cli-fake', model: 'default' })
  })
})
