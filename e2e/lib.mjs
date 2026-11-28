// Drives the real DSH Web UI. Results are judged from files and the session log,
// because status labels stay in the DOM after a turn has moved on.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

export const E2E_ROOT = process.env.E2E_ROOT ?? '/tmp/dsh-ccgui-e2e'
export const WORKSPACE = join(E2E_ROOT, 'docs/deepseek-harness/default-workspace')
const SESSIONS = join(E2E_ROOT, 'home/sessions')
const DSH_REPO = process.env.DSH_REPO
if (DSH_REPO === undefined) throw new Error('set DSH_REPO to a built deepseek-harness checkout')

function serverUrl() {
  const urls = readFileSync(join(E2E_ROOT, 'server.log'), 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g)
  if (urls === null) throw new Error('server URL not found; is e2e/start-server.sh running?')
  return urls.at(-1)
}

async function launch() {
  const require = createRequire(join(DSH_REPO, 'packages/experimental/inspector/package.json'))
  const { chromium } = require('playwright')
  const executablePath = process.env.CHROMIUM_PATH
  return chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) })
}

async function dismissDialogs(page) {
  for (let i = 0; i < 4; i += 1) {
    const button = page
      .locator('[role=presentation]')
      .getByRole('button', { name: /继续|开始|知道了|完成|跳过/ })
      .first()
    if (!(await button.isVisible().catch(() => false))) return
    await button.click()
    await page.waitForTimeout(500)
  }
}

/**
 * Open the UI and return the helpers scenarios use.
 * @returns the page, its helpers, and a reporter.
 */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function openHarness() {
  const browser = await launch()
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await page.goto(serverUrl())
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await dismissDialogs(page)
  await page.waitForTimeout(1000)

  const sleep = (ms) => page.waitForTimeout(ms)
  const bodyText = () => page.evaluate(() => document.body.innerText)
  const shot = (name) => page.screenshot({ path: join(E2E_ROOT, `${name}.png`) })

  async function until(check, label, timeout = 20_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await check()) return
      await sleep(200)
    }
    throw new Error(`timed out waiting for ${label}`)
  }

  async function newSession(preset) {
    await page.getByRole('button', { name: '新建会话' }).last().click()
    await sleep(700)
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
    await sleep(400)
    const name = new RegExp(preset)
    await page
      .getByRole('menuitemradio', { name })
      .or(page.getByRole('menuitem', { name }))
      .or(page.getByRole('option', { name }))
      .first()
      .click()
    await sleep(500)
  }

  // The model picker: one button in the composer, one popover with the provider tabs, the
  // model rows, the reasoning slider and the provider's own setting.
  const modelTrigger = () => page.getByRole('button', { name: /^选择模型和思考深度/ }).last()
  const pickerPopover = () => page.getByRole('dialog', { name: '选择模型和思考深度' })
  const pickerTab = (name) => pickerPopover().getByRole('tab', { name, exact: true })
  const rowNamed = (name) =>
    pickerPopover()
      .getByRole('menuitemradio')
      .filter({ has: page.locator('.dsh-cli-picker-row-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })

  async function openPicker() {
    if (
      await pickerPopover()
        .isVisible()
        .catch(() => false)
    )
      return
    await until(() => modelTrigger().isVisible(), 'model picker')
    await modelTrigger().click()
    await pickerPopover().waitFor({ timeout: 10_000 })
    await sleep(200)
  }

  async function closePicker() {
    for (
      let i = 0;
      i < 3 &&
      (await pickerPopover()
        .isVisible()
        .catch(() => false));
      i += 1
    ) {
      await page.keyboard.press('Escape')
      await sleep(250)
    }
  }

  /** The provider tab the open session is on. */
  async function currentTab() {
    await openPicker()
    const label = await pickerPopover().getByRole('tab', { selected: true }).getAttribute('aria-label')
    await closePicker()
    return label
  }

  /** Put the open session on a CLI with the picker's provider tabs. */
  async function chooseCli(name) {
    await openPicker()
    if ((await pickerTab(name).getAttribute('aria-selected')) !== 'true') await pickerTab(name).click()
    await until(async () => (await pickerTab(name).getAttribute('aria-selected')) === 'true', `picker on ${name}`)
    await closePicker()
  }

  /** Start a standard session and put it on a CLI with the picker. */
  async function newCliSession(name) {
    await newSession('标准模式')
    await chooseCli(name)
  }

  /** Read the rows the picker lists for a CLI, by name; the session must be on that CLI. */
  async function modelRows(cli) {
    await openPicker()
    const selected = await pickerPopover().getByRole('tab', { selected: true }).getAttribute('aria-label')
    if (selected !== cli) throw new Error(`the picker is on ${selected}, not ${cli}`)
    const rows = await pickerPopover()
      .getByRole('menuitemradio')
      .evaluateAll((items) =>
        items
          .filter((item) => item.closest('[aria-label="CLI 模式"]') === null)
          .map((item) => ({
            id: item.getAttribute('data-model-id'),
            name: item.querySelector('.dsh-cli-picker-row-name')?.textContent ?? '',
          })),
      )
    await closePicker()
    return rows
  }

  /** Read the names a CLI's list shows. */
  const modelNames = async (cli) => (await modelRows(cli)).map((row) => row.name)

  /** Pick a model, waiting for the list because a CLI reports it after starting up. */
  async function chooseModel(cli, name, timeout = 180_000) {
    if ((await currentTab()) !== cli) await chooseCli(cli)
    await until(async () => (await modelNames(cli)).includes(name), `model ${name}`, timeout)
    await openPicker()
    await rowNamed(name).click()
    // The picker stays open for the slider, so close it once the trigger names the model.
    await until(async () => ((await modelTrigger().textContent()) ?? '').includes(name), `trigger naming ${name}`)
    await closePicker()
  }

  /** Reopen a session from the sidebar, which unfolds a few older ones per click. */
  async function openSession(text) {
    const more = page.getByText(/展开其余/).first()
    while (await more.isVisible().catch(() => false)) {
      await more.click()
      await sleep(300)
    }
    await page.getByText(text).first().click()
    await sleep(2000)
  }

  async function send(text) {
    await page.locator('[contenteditable=true]').first().click()
    await page.keyboard.type(text)
    await page.getByRole('button', { name: '发送消息' }).click()
  }

  const settingsDialog = () => page.locator('[data-shortcut-modal="settings"]')

  /** The page is a section of the harness's Settings dialog, reached from the account menu. */
  async function openCcguiSettings() {
    if (!(await settingsDialog().isVisible())) {
      await page.getByRole('button', { name: '账号菜单' }).click()
      await page.getByRole('menuitem', { name: /^设置/ }).click()
      await until(() => settingsDialog().isVisible(), 'settings dialog')
    }
    await settingsDialog().getByRole('button', { name: 'CC GUI 设置' }).click()
  }

  async function closeSettings() {
    for (let i = 0; i < 3 && (await settingsDialog().isVisible()); i += 1) {
      await page.keyboard.press('Escape')
      await sleep(300)
    }
    if (await settingsDialog().isVisible()) throw new Error('the settings dialog did not close')
  }

  const results = []
  async function scenario(name, run) {
    const before = errors.length
    try {
      await run()
      if (errors.length > before) throw new Error(`browser errors: ${errors.slice(before).join(' | ')}`)
      results.push(['PASS', name])
    } catch (error) {
      results.push(['FAIL', name, String(error.message).slice(0, 300)])
      await shot(`fail-${name.split(':')[0]}`)
    }
  }

  async function finish() {
    for (const [status, name, detail] of results) console.log(status, name, detail ?? '')
    const failed = results.filter(([status]) => status === 'FAIL').length
    console.log(`\n${results.length - failed}/${results.length} passed`)
    await browser.close()
    process.exit(failed === 0 ? 0 : 1)
  }

  return {
    page,
    sleep,
    bodyText,
    shot,
    until,
    newSession,
    newCliSession,
    chooseCli,
    modelTrigger,
    pickerPopover,
    pickerTab,
    rowNamed,
    openPicker,
    closePicker,
    currentTab,
    modelRows,
    modelNames,
    chooseModel,
    openSession,
    openCcguiSettings,
    closeSettings,
    send,
    scenario,
    finish,
  }
}

/**
 * Read a session log as text. DSH appends each batch as its own zstd frame, and neither
 * the sync nor the streaming decompressor reads past the first one, so the log is split
 * on the frame magic and each frame is decoded on its own.
 * @param file - the log's file name, which says whether it is compressed.
 * @param raw - the file's bytes.
 * @returns the whole log.
 */
function readLog(file, raw) {
  if (!file.endsWith('.zstd')) return raw.toString()
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const frames = []
  let start = raw.indexOf(magic)
  while (start !== -1) {
    const next = raw.indexOf(magic, start + magic.length)
    frames.push(zstdDecompressSync(raw.subarray(start, next === -1 ? raw.length : next)))
    start = next
  }
  return Buffer.concat(frames).toString()
}

/**
 * Read the log of the session whose text contains a prompt.
 * @param prompt - text identifying the session.
 * @returns its events, or an empty list.
 */
export function sessionEvents(prompt) {
  if (!existsSync(SESSIONS)) return []
  for (const group of readdirSync(SESSIONS)) {
    for (const id of readdirSync(join(SESSIONS, group))) {
      const dir = join(SESSIONS, group, id)
      const file = readdirSync(dir).find((name) => name.startsWith('session') && name.includes('jsonl'))
      if (file === undefined) continue
      const text = readLog(file, readFileSync(join(dir, file)))
      if (text.includes(prompt))
        return text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
    }
  }
  return []
}

/**
 * Read a session's finished turns.
 * @param prompt - text identifying the session.
 * @returns its `turn/end` events.
 */
export const turnEnds = (prompt) => sessionEvents(prompt).filter((event) => event.type === 'turn/end')

/**
 * Read the CLI session ids a harness session recorded.
 * @param prompt - text identifying the session.
 * @returns the distinct native session ids.
 */
export const nativeSessionIds = (prompt) => [
  ...new Set(
    sessionEvents(prompt)
      .filter((event) => event.type === 'assistant/message')
      .map((event) => event.data.message?.source?.replayState?.response?.acpSessionId)
      .filter(Boolean),
  ),
]
