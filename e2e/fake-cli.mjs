// Deterministic scenarios against tests/fixtures/fake-acp-agent.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openHarness, sessionEvents, turnEnds, WORKSPACE } from './lib.mjs'

const {
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
  openPicker,
  closePicker,
  modelRows,
  modelNames,
  chooseModel,
  send,
  scenario,
  finish,
  openCcguiSettings,
  closeSettings,
} = await openHarness()
const FAKE = 'Fake CLI'
const FAILED_PROMPT = 'CRASH before restart'
const inWorkspace = (file) => join(WORKSPACE, file)
const untilText = (text, timeout) => until(async () => (await bodyText()).includes(text), `text "${text}"`, timeout)
const idle = (prompt, turns = 1) => until(() => turnEnds(prompt).length >= turns, `turn end of ${prompt}`)
const harnessSeatDisplays = () =>
  page
    .locator('[data-slot="conversation.input.model"]')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))
// The CLI's native modes, the last row of the model picker; open the picker first.
const modeRow = () => pickerPopover().getByRole('button', { name: /^CLI 模式/ })
const modeOption = (name) =>
  pickerPopover().getByRole('menu', { name: 'CLI 模式' }).getByRole('menuitemradio', { name })
// Codex's fast mode, the bolt beside the reasoning level, which the fake CLI offers on its
// default model only; open the picker first.
const speedToggle = () => pickerPopover().getByRole('button', { name: /^(开启快速模式|快速模式已开启)/ })
const speedPressed = async () => (await speedToggle().getAttribute('aria-pressed')) === 'true'
const PENDING = '下一条消息发送时生效'
/** Read an attribute of something in the picker, opening it and closing it again. */
async function inPicker(read) {
  await openPicker()
  const value = await read()
  await closePicker()
  return value
}

/** Switch the harness's access mode, confirming 完全权限's own risk dialog. */
async function setAccessMode(name) {
  await page
    .getByRole('button', { name: /^访问模式/ })
    .last()
    .click()
  await sleep(400)
  await page.getByRole('menuitemradio', { name }).or(page.getByRole('menuitem', { name })).first().click()
  await sleep(600)
  const confirm = page.getByRole('button', { name: /启用完全权限|确定|确认/ }).first()
  if (await confirm.isVisible().catch(() => false)) {
    const box = page.getByRole('checkbox').first()
    if (await box.isVisible().catch(() => false)) await box.click()
    await confirm.click()
    await sleep(600)
  }
  await until(
    async () =>
      (
        await page
          .getByRole('button', { name: /^访问模式/ })
          .last()
          .innerText()
      ).includes(name),
    `access mode ${name}`,
  )
}

// Must stay first, on a fresh server: for `npx` commands, starting a CLI downloads and runs
// a package, which nobody should get just by opening the app.
await scenario('lazy: opening the app starts no CLI', async () => {
  await sleep(2000)
  await newSession('标准模式')
  await sleep(1000)
  const running = (() => {
    try {
      return execFileSync('pgrep', ['-f', 'fixtures/fake-acp-agent.mjs']).toString().trim()
    } catch {
      return ''
    }
  })()
  if (running !== '') throw new Error(`already running: ${running}`)
})

// The picker takes the harness's own model seat on every session, the harness's included:
// there it lists the harness's providers and carries the agent-team switch.
await scenario('seat: a harness session gets the picker in place of the native model control', async () => {
  const seats = await harnessSeatDisplays()
  if (!seats.every((display) => display === 'none')) throw new Error(`harness seat: ${seats.join()}`)
  if ((await page.getByRole('button', { name: /^选择模型和思考深度/ }).count()) !== 1)
    throw new Error('not exactly one model control')
  await openPicker()
  if ((await pickerTab('DeepSeek').getAttribute('aria-selected')) !== 'true') throw new Error('not on the harness tab')
  if ((await pickerTab(FAKE).count()) !== 1) throw new Error('the CLI has no tab')
  await shot('picker-harness')
  await closePicker()
  // This session is the harness's own, so the access control keeps the composer's seat.
  if ((await page.getByRole('button', { name: /^访问模式/ }).count()) === 0) throw new Error('no access control')
  if ((await modelTrigger().getAttribute('data-cli-modes')) !== null)
    throw new Error('a harness session claims the access control seat')
})

// The access mode is DSH's stance for sessions it runs. A CLI decides for itself whether to
// ask, so even 完全权限 must not answer its question with a silent refusal. This runs on the
// harness session the previous scenario left open: the preset belongs to it, so it cannot
// follow the suite into later scenarios.
await scenario('approvals: a 完全权限 session still lets the CLI ask', async () => {
  await setAccessMode('完全权限')
  await chooseCli(FAKE)
  await send('WRITE full.txt')
  await untilText('等待审批')
  if (existsSync(inWorkspace('full.txt'))) throw new Error('written before anyone answered')
  await page.getByRole('button', { name: '允许一次' }).click()
  await untilText('done')
  await idle('WRITE full.txt')
  if (!existsSync(inWorkspace('full.txt'))) throw new Error('missing after approval')
  // The stance is the user's setting: lifted only while the CLI asked, then put back.
  const policies = sessionEvents('WRITE full.txt')
    .filter((event) => event.type === 'approval/policy')
    .map((event) => event.data.policy)
  if (policies.slice(-2).join() !== 'ask,never') throw new Error(`access mode not restored: ${policies.join()}`)
  await shot('full-access-asked')
})

await scenario('allow: permission gates the write, then the file appears', async () => {
  await newCliSession(FAKE)
  await send('WRITE allow.txt')
  await untilText('等待审批')
  if (existsSync(inWorkspace('allow.txt'))) throw new Error('file written before approval')
  await page.getByRole('button', { name: '允许一次' }).click()
  await untilText('done')
  await idle('WRITE allow.txt')
  if (!existsSync(inWorkspace('allow.txt'))) throw new Error('file missing after approval')
})

await scenario('diff: the turn shows the CLI file change in the native card', async () => {
  await until(async () => /已编辑\s*allow\.txt/.test(await bodyText()), 'diff summary card')
  const types = sessionEvents('WRITE allow.txt').map((event) => event.type)
  if (!types.includes('tool/call') || !types.includes('tool/result'))
    throw new Error(`tool events missing: ${types.join(',')}`)
})

await scenario('reject: the CLI is told no and the file never appears', async () => {
  await newCliSession(FAKE)
  await send('WRITE reject.txt')
  await untilText('等待审批')
  await page.getByRole('button', { name: '拒绝' }).click()
  await untilText('The write was rejected.')
  await idle('WRITE reject.txt')
  if (existsSync(inWorkspace('reject.txt'))) throw new Error('file written after rejection')
})

await scenario('auto: a call the CLI does not ask about still shows and finishes', async () => {
  await newCliSession(FAKE)
  await send('AUTO auto.txt')
  await untilText('done')
  await idle('AUTO auto.txt')
  if (!existsSync(inWorkspace('auto.txt'))) throw new Error('file missing')
  const toolResults = sessionEvents('AUTO auto.txt').filter((event) => event.type === 'tool/result')
  if (toolResults.length !== 1 || toolResults[0].data.isError) throw new Error('bad tool result')
})

await scenario('silent end: a turn ending after a tool with no text is not an error', async () => {
  await newCliSession(FAKE)
  await send('READ')
  await idle('READ')
  const [end] = turnEnds('READ')
  if (end.data.reason.kind !== 'completed')
    throw new Error(`turn ended as ${JSON.stringify(end.data.reason).slice(0, 200)}`)
})

await scenario('cancel: stop ends the turn and the session still works', async () => {
  await newCliSession(FAKE)
  await send('HANG')
  await untilText('working')
  await sleep(300)
  await page
    .getByRole('button', { name: /停止|中断|取消/ })
    .last()
    .click()
  await idle('HANG')
  const [end] = turnEnds('HANG')
  if (end.data.reason.kind !== 'aborted')
    throw new Error(`turn ended as ${JSON.stringify(end.data.reason).slice(0, 200)}`)
  await sleep(500)
  await send('after cancel')
  await untilText('echo: after cancel')
  await idle('HANG', 2)
})

await scenario('crash: a dead CLI reports an error and the next message recovers without replaying', async () => {
  await newCliSession(FAKE)
  await send('CRASH')
  await untilText('退出码 3')
  await sleep(500)
  await send('after crash')
  // The fake CLI crashes again if it receives CRASH twice, so this also proves no replay.
  await untilText('echo: after crash')
  await idle('CRASH', 2)
})

await scenario('approval text: the person deciding sees what would be written', async () => {
  await newCliSession(FAKE)
  await send('WRITE shown.txt')
  await untilText('等待审批')
  const text = await bodyText()
  if (!text.slice(text.indexOf('等待审批')).includes('shown.txt:'))
    throw new Error('no file preview in the approval card')
  await page.getByRole('button', { name: '拒绝' }).click()
  await idle('WRITE shown.txt')
})

// Left in this state on purpose; e2e/fake-cli-resume.mjs reopens it after a restart.
await scenario('setup: leave a session whose last turn failed', async () => {
  await newCliSession(FAKE)
  await send(FAILED_PROMPT)
  await untilText('退出码 3')
  await idle(FAILED_PROMPT)
})

// The CLI's mode now lives in the picker, so the harness's access control, which would
// answer for a session the harness runs, steps out of the row once the CLI reports modes.
await scenario('position: the picker sits after the + button, and the access control steps aside', async () => {
  await newCliSession(FAKE)
  const left = (await page.getByRole('button', { name: '添加文件或调用指令' }).last().boundingBox())?.x
  const picker = await modelTrigger().boundingBox()
  if (!(left < picker.x)) throw new Error(`order: + ${left}, picker ${picker.x}`)
  await until(async () => (await modelTrigger().getAttribute('data-cli-modes')) !== null, 'the CLI modes', 30_000)
  await shot('picker-trigger')
  const access = await page.getByRole('button', { name: /^访问模式/ }).count()
  if (access !== 0) throw new Error('the access control is still in the row')
})

// The default row stands for Fake Small, so Fake Small gets no second row of its own. The
// row comes first and the picker shows it without the catalog's 「（默认）」.
await scenario('models: the picker shows what the CLI reports, its own setting first', async () => {
  await newCliSession(FAKE)
  await until(async () => (await modelNames(FAKE)).length === 2, 'two model rows', 30_000)
  const rows = await modelRows(FAKE)
  const shown = rows.map(({ id, name }) => `${id}:${name}`).join()
  if (shown !== 'default:Fake Small,fake-large:Fake Large') throw new Error(`rows: ${shown}`)
})

await scenario("picker: one click shows this CLI's models and its own setting, and Escape closes it", async () => {
  await openPicker()
  if ((await modeRow().count()) !== 1) throw new Error('no CLI mode row')
  await shot('model-picker')
  await page.keyboard.press('Escape')
  await sleep(250)
  if (await pickerPopover().isVisible()) throw new Error('Escape left the picker open')
})

// A CLI's own logo names the CLI, not the maker of every model it happens to list.
await scenario('model marks: an unidentifiable model gets a neutral mark, never a brand', async () => {
  const marks = await inPicker(() =>
    pickerPopover()
      .getByRole('menu', { name: '模型' })
      .getByRole('menuitemradio')
      .evaluateAll((rows) => rows.map((row) => row.querySelector('[data-cli-mark]')?.getAttribute('data-cli-mark'))),
  )
  if (marks.join() !== 'unknown,unknown') throw new Error(`model marks: ${marks.join()}`)
})

await scenario('picker: the search takes the keys, and Enter picks the first match', async () => {
  await openPicker()
  await page.keyboard.type('Large')
  await page.keyboard.press('Enter')
  await until(
    async () => ((await modelTrigger().textContent()) ?? '').includes('Fake Large'),
    'trigger naming Fake Large',
  )
  // The picker stays open for the slider and the bolt.
  if (!(await pickerPopover().isVisible())) throw new Error('choosing a model closed the picker')
  await closePicker()
  await chooseModel(FAKE, 'Fake Small')
})

await scenario('picker: a press elsewhere closes it', async () => {
  await openPicker()
  await page.mouse.click(5, 5)
  await sleep(250)
  if (await pickerPopover().isVisible()) throw new Error('picker still open')
})

await scenario('picker: a press inside it keeps it open', async () => {
  await openPicker()
  // The empty end of the tab row: inside the popover, on no control.
  const box = await pickerPopover().boundingBox()
  const x = box.x + box.width - 12
  const y = box.y + 12
  const onCard = await page.evaluate(
    ([px, py]) => {
      const hit = document.elementFromPoint(px, py)
      return hit?.closest('[role="dialog"]') !== null && hit?.closest('button') === null
    },
    [x, y],
  )
  if (!onCard) throw new Error('the press would miss the popover')
  await page.mouse.click(x, y)
  await sleep(250)
  if (!(await pickerPopover().isVisible())) throw new Error('the press closed the picker')
  await closePicker()
})

await scenario('model switch: the chosen model reaches the CLI before the prompt', async () => {
  await newCliSession(FAKE)
  await chooseModel(FAKE, 'Fake Large')
  await send('WHICH MODEL')
  await untilText('model=fake-large')
  await idle('WHICH MODEL')
})

await scenario('model switch mid-session: the next message runs on the new model', async () => {
  await chooseModel(FAKE, 'Fake Small')
  await send('WHICH MODEL')
  await untilText('model=fake-small')
})

// A refusal has no field of its own in ACP. A CLI that explains itself nowhere in the
// stream must still not leave the user with "未说明原因" when the reason is right there.
await scenario('refusal: CodeBuddy’s attached request error reaches the failure', async () => {
  await newCliSession(FAKE)
  await send('REFUSE META')
  await untilText('可消耗积分继续使用该模型')
  await idle('REFUSE META')
  const body = await bodyText()
  if (!body.includes('拒绝继续这个请求')) throw new Error('not reported as a refusal')
  if (body.includes('-32003') || body.includes('requestId')) throw new Error('bookkeeping ids leaked on screen')
})

await scenario('refusal: the log is quoted when the CLI attached nothing', async () => {
  await send('REFUSE')
  await untilText('quota exceeded for hy4-free')
  await idle('REFUSE', 2)
})

// A wall of _meta JSON is worse than the plain failure. When neither the answer
// nor the log has a human sentence, the user must see "未说明原因" again.
await scenario('refusal: a telemetry dump falls back to the plain failure', async () => {
  await send('REFUSE NOISE')
  await untilText('未说明原因')
  await idle('REFUSE NOISE')
  const body = await bodyText()
  if (body.includes('traceparent') || body.includes('FAILED_MODEL_REQUEST')) {
    throw new Error('diagnostic dump leaked onto the screen')
  }
})

await scenario('locked: a started session keeps its CLI, and says how to change', async () => {
  const [disabled, title] = await inPicker(async () => [
    await pickerTab('DeepSeek').isDisabled(),
    await pickerTab('DeepSeek').getAttribute('title'),
  ])
  if (!disabled) throw new Error('other providers still enabled after the session started')
  if (!title.includes('新建会话')) throw new Error(`hint: ${title}`)
})

// The CLI's modes are its own: the picker shows the names it reported and sends the id back.
await scenario('mode: the CLI lists its own modes, and a pick made before it runs waits', async () => {
  await newCliSession(FAKE)
  await until(() => inPicker(async () => (await modeRow().count()) > 0), 'the CLI mode row', 30_000)
  await openPicker()
  const label = await modeRow().textContent()
  if (!label.includes('Default')) throw new Error(`row: ${label}`)
  await modeRow().click()
  const rows = await pickerPopover()
    .getByRole('menu', { name: 'CLI 模式' })
    .getByRole('menuitemradio')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent))
  if (rows.join() !== 'Default,Plan') throw new Error(`rows: ${rows.join()}`)
  await modeOption('Plan').click()
  // Nothing to change before the CLI session exists, so the pick says when it will apply.
  await until(async () => ((await modeRow().getAttribute('title')) ?? '').includes(PENDING), 'the pending hint')
  await closePicker()
  await send('WHICH MODE')
  await untilText('mode=plan')
  await idle('WHICH MODE')
  await until(
    () => inPicker(async () => !((await modeRow().getAttribute('title')) ?? '').includes(PENDING)),
    'the pick to be confirmed',
  )
})

await scenario('mode switch mid-session: the live CLI changes before the next prompt', async () => {
  await openPicker()
  await modeRow().click()
  await modeOption('Default').click()
  await sleep(500)
  const title = (await modeRow().getAttribute('title')) ?? ''
  if (title.includes(PENDING)) throw new Error('a running CLI should apply at once')
  await closePicker()
  await send('WHICH MODE')
  await untilText('mode=default')
})

// The bolt sends the CLI's own on/off; picked before the CLI runs, it waits for the first turn.
await scenario('fast mode: a pick made before the CLI runs reaches its first turn', async () => {
  await newCliSession(FAKE)
  await until(() => inPicker(async () => (await speedToggle().count()) > 0), 'the fast-mode bolt', 30_000)
  await openPicker()
  if (await speedPressed()) throw new Error('fast mode should start off')
  await speedToggle().click()
  await until(speedPressed, 'the bolt to show the pick')
  const pending = (await speedToggle().getAttribute('title')) ?? ''
  if (!pending.includes(PENDING)) throw new Error(`pending hint: ${pending}`)
  await shot('fast-mode-pending')
  await closePicker()
  // The button keeps the CLI's mark and adds the bolt after the level.
  if ((await modelTrigger().locator('[data-cli-mark]').count()) !== 1) throw new Error('the mark left the button')
  await send('WHICH SPEED')
  await untilText('fast=on')
  await idle('WHICH SPEED')
  await until(
    () => inPicker(async () => !((await speedToggle().getAttribute('title')) ?? '').includes(PENDING)),
    'the pick to be confirmed',
  )
})

// Fast mode belongs to the model: once a turn has moved the CLI to one without a fast tier,
// the bolt goes, and the turn ran at normal speed.
await scenario('fast mode: a model without a fast tier takes the bolt away', async () => {
  await chooseModel(FAKE, 'Fake Large')
  await send('WHICH SPEED')
  await untilText('fast=off')
  await idle('WHICH SPEED', 2)
  await until(() => inPicker(async () => (await speedToggle().count()) === 0), 'the bolt to go')
})

// A PTC session runs the CLI through run_code; nothing refuses a CLI outright any more.
await scenario('PTC: a CLI turn runs in a PTC session', async () => {
  await newSession('PTC')
  await chooseModel(FAKE, 'Fake Small')
  await send('ptc echo')
  await untilText('echo: ptc echo')
  await idle('ptc echo')
  await shot('ptc-session')
})

await scenario('marks: the picker, its tabs and the session list say which CLI is which', async () => {
  await newCliSession(FAKE)
  if ((await modelTrigger().locator('[data-cli-mark]').count()) !== 1) throw new Error('no mark on the picker')
  const marks = await inPicker(() =>
    pickerPopover()
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.querySelector('[data-cli-mark]')?.getAttribute('data-cli-mark'))),
  )
  for (const mark of ['opencode', 'omp', 'codex', 'pi']) {
    if (!marks.includes(mark)) throw new Error(`tabs lack ${mark}: ${marks.join()}`)
  }
  await send('MARKED ROW')
  await untilText('echo: MARKED ROW')
  await idle('MARKED ROW')
  await sleep(800)
  const row = page.locator('[data-row-key^="session:"]').filter({ hasText: 'MARKED ROW' })
  // The status mark (session-status-mark.tsx) portals a second, hidden copy into the same cell,
  // so count only the leading slot's own mark.
  if ((await row.locator('.dsh-cli-session-mark [data-cli-mark="cli"]').count()) !== 1)
    throw new Error('the session row shows no mark')
  // The row has one 16px cell, so a mark the harness placed first has to keep it.
  const yields = await row.locator('.dsh-cli-session-mark').evaluate((mine) => {
    const earlier = document.createElement('span')
    mine.before(earlier)
    const hidden = getComputedStyle(mine).display === 'none'
    earlier.remove()
    return hidden && getComputedStyle(mine).display !== 'none'
  })
  if (!yields) throw new Error('the mark does not give way to an earlier occupant')
  await shot('marks')
})

await scenario('sidebar: opening it shows 工作区文件 instead of the guide, with 变更 beside it', async () => {
  const expand = page.getByRole('button', { name: '打开右侧边栏' })
  const files = () => page.locator('[data-files-page]').filter({ visible: true }).count()
  await until(() => expand.isVisible(), 'sidebar expand button')
  await expand.click()
  await until(async () => (await files()) === 1, 'files page shown')
  if ((await page.locator('[data-sidebar-right-guide]').count()) !== 0) throw new Error('the guide is still open')
  await shot('sidebar-files')
  // 变更 opens beside 工作区文件 the way CC GUI's panel does, with 文件 in front.
  // Each chip holds its close button, so a tab's name is "变更 关闭"; match the start.
  const changesTab = page.getByRole('tab', { name: /^变更/ })
  await until(async () => (await changesTab.count()) === 1, '变更 tab beside the files page')
  if ((await page.locator('.dsh-ccgui-changes').filter({ visible: true }).count()) !== 0)
    throw new Error('变更 is in front of 工作区文件')
  await changesTab.click()
  const branch = page.locator('.dsh-ccgui-changes-branch-button').filter({ visible: true })
  await until(async () => (await branch.count()) === 1, '变更 panel with its branch picker')
  await until(async () => /main|master/.test(await branch.innerText()), 'branch name in the picker')
  await shot('sidebar-changes')
  await page.getByRole('tab', { name: /^文件/ }).click()
  await until(async () => (await files()) === 1, 'back on the files page')
  await page.getByRole('button', { name: '收起右侧边栏' }).click()
  await until(async () => (await files()) === 0, 'sidebar collapsed')
})

await scenario('terminal: the header button opens, hides and brings back one terminal', async () => {
  const button = page.getByRole('button', { name: '切换终端' })
  const shown = () => page.locator('[data-sidebar-terminal]').filter({ visible: true }).count()
  await until(() => button.isVisible(), 'terminal button')
  await button.click()
  await until(async () => (await shown()) === 1, 'terminal shown')
  await shot('terminal-open')
  await button.click()
  await until(async () => (await shown()) === 0, 'terminal hidden')
  await button.click()
  await until(async () => (await shown()) === 1, 'terminal shown again')
  // Bringing it back must reuse the shell, not stack a second one.
  if ((await page.locator('[data-sidebar-terminal]').count()) !== 1) throw new Error('a second terminal was opened')
  await button.click()
})

await scenario('launch script: saved once, it runs in a terminal tab of its own and restarts there', async () => {
  // Arithmetic, so the echoed command line cannot satisfy the check; only the output can.
  const output = () => page.locator('[data-sidebar-terminal]').filter({ hasText: 'LAUNCH_OK_42' }).count()
  // Count tabs, not mounted terminals: the sidebar mounts only its active tab, so a terminal
  // left open by an earlier scenario is a tab with no [data-sidebar-terminal] on the page.
  const terminals = () =>
    page
      .locator('[data-dockkit-tab]:has([data-sidebar-right-tab])')
      .filter({ hasNotText: /^\s*(文件|变更)\s*$/ })
      .count()
  await page.getByRole('button', { name: '设置启动脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '添加启动脚本' })
  await dialog.getByLabel('名称').fill('回显')
  await dialog.getByLabel('命令').fill('echo LAUNCH_OK_$((40+2))')
  await shot('launch-script-form')
  await dialog.getByRole('button', { name: '保存' }).click()
  const list = page.getByRole('dialog', { name: '启动脚本' })
  await until(() => list.isVisible(), 'script list')
  await shot('launch-script-list')
  await list.getByRole('button', { name: '完成' }).click()
  const before = await terminals()
  await page.getByRole('button', { name: '运行：回显' }).click()
  await until(async () => (await output()) === 1, 'script output in a terminal', 20_000)
  await shot('launch-script-ran')
  if ((await terminals()) !== before + 1) throw new Error('the script did not get a terminal of its own')
  const firstRun = await page.locator('[data-sidebar-terminal]').filter({ hasText: 'LAUNCH_OK_42' }).elementHandle()
  await page.getByRole('button', { name: '启动脚本' }).click()
  await page
    .getByRole('menuitem', { name: /回显/ })
    .or(page.getByRole('menuitemradio', { name: /回显/ }))
    .click()
  await until(() => firstRun.evaluate((node) => !node.isConnected), 'the first run closed', 20_000)
  await until(async () => (await terminals()) === before + 1, 'the rerun replaced its own tab', 20_000)
  await until(async () => (await output()) === 1, 'script output after the rerun', 20_000)
})

await scenario('settings: switching a feature off restores the harness interaction at once', async () => {
  const terminalSwitch = page.getByRole('switch', { name: '会话顶部的终端按钮' })
  const filesSwitch = page.getByRole('switch', { name: '右侧栏默认打开工作区文件' })
  const terminalButton = page.getByRole('button', { name: '切换终端' })
  const openSettings = async () => {
    await openCcguiSettings()
    // The page opens on its CLI 列表 tab; the feature switches live on the next one.
    await page.getByRole('tab', { name: '界面交互' }).click()
    await until(() => terminalSwitch.isVisible(), 'settings page')
  }
  await openSettings()
  await shot('settings-page')
  await page.getByRole('tab', { name: '更多功能' }).click()
  await until(() => page.getByText('即将开放…').first().isVisible(), 'upcoming features')
  await shot('settings-more')
  await page.getByRole('tab', { name: '版本记录' }).click()
  const notesCount = page.locator('.dsh-ccgui-notes-count')
  await until(() => notesCount.isVisible(), 'release notes page')
  const firstPage = (await notesCount.textContent()) ?? ''
  await page.getByRole('button', { name: '下一页' }).click()
  await until(async () => (await notesCount.textContent()) !== firstPage, 'the pager turned the page')
  await shot('settings-notes')
  await page.getByRole('tab', { name: '界面交互' }).click()
  await until(() => terminalSwitch.isVisible(), 'settings page')
  await terminalSwitch.click()
  await filesSwitch.click()
  if ((await terminalSwitch.getAttribute('aria-checked')) !== 'false') throw new Error('the switch did not turn off')
  await closeSettings()
  // A fresh, started session: its right column starts empty, so the harness seeds its guide,
  // and only a started session has a header. The startup script control, still on, shows
  // the header is there.
  await newCliSession(FAKE)
  await send('SETTINGS OFF')
  await idle('SETTINGS OFF')
  await until(() => page.getByRole('button', { name: '启动脚本' }).isVisible(), 'session header')
  if (await terminalButton.isVisible()) throw new Error('the terminal button is still in the header')
  await page.getByRole('button', { name: '打开右侧边栏' }).click()
  await until(
    async () => (await page.locator('[data-sidebar-right-guide]').filter({ visible: true }).count()) === 1,
    'guide shown',
  )
  if ((await page.locator('[data-files-page]').filter({ visible: true }).count()) !== 0)
    throw new Error('the files page replaced the guide while switched off')
  await shot('settings-off')
  await page.getByRole('button', { name: '收起右侧边栏' }).click()
  await openSettings()
  await terminalSwitch.click()
  await filesSwitch.click()
  await closeSettings()
  await page.locator('[data-row-key^="session:"]').filter({ hasText: 'SETTINGS OFF' }).click()
  await until(() => terminalButton.isVisible(), 'terminal button back in the header')
})

await scenario('settings: the CLI list orders the picker tabs and hides what is switched off', async () => {
  const missingSwitch = page.getByRole('switch', { name: '启用 Missing CLI' })
  const rows = () =>
    page.locator('.dsh-ccgui-cli-prefs li').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
  // CLIs can start switched off (CodeBuddy does), so the menu is what the switches leave on.
  const shownRows = () =>
    page
      .locator('.dsh-ccgui-cli-prefs li')
      .evaluateAll((items) =>
        items
          .filter((item) => item.querySelector('[role="switch"]')?.getAttribute('aria-checked') !== 'false')
          .map((item) => item.getAttribute('aria-label')),
      )
  const menuNames = () =>
    inPicker(() =>
      pickerPopover()
        .getByRole('tab')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
    )
  const openSettings = async () => {
    await openCcguiSettings()
    await until(() => missingSwitch.isVisible(), 'CLI list on the settings page')
  }
  await openSettings()
  const before = await rows()
  const lastName = before.at(-1)
  await page.getByRole('button', { name: `上移 ${lastName}` }).click()
  await missingSwitch.click()
  const arranged = await rows()
  if (arranged.at(-2) !== lastName) throw new Error(`rows after moving: ${arranged.join()}`)
  const expected = await shownRows()
  if (expected.includes('Missing CLI')) throw new Error('Missing CLI is still switched on')
  await shot('settings-cli-list')
  await closeSettings()
  let restored
  try {
    await newSession('标准模式')
    await until(() => modelTrigger().isVisible(), 'model picker')
    const shown = await menuNames()
    await shot('settings-cli-menu')
    if (shown.join() !== expected.join()) throw new Error(`menu: ${shown.join()} (expected ${expected.join()})`)
  } finally {
    // Put things back, so later scenarios see the configured order and can pick Missing CLI.
    await page.keyboard.press('Escape')
    await openSettings()
    await missingSwitch.click()
    await page.getByRole('button', { name: `下移 ${lastName}` }).click()
    restored = await rows()
    // Closed even when the check above failed, so the next scenario is not stuck behind the dialog.
    await closeSettings()
  }
  if (restored.join() !== before.join()) throw new Error('could not restore the order')
})

await scenario('not installed: choosing a CLI that is missing explains what is wrong', async () => {
  await newCliSession('Missing CLI')
  await send('anyone there')
  await until(() => turnEnds('anyone there').length >= 1, 'turn end', 30_000)
  await shot('missing-cli')
  const text = await bodyText()
  if (!/Missing CLI/.test(text) || !/dsh-ccgui-no-such-command|启动|安装/.test(text))
    throw new Error('the error does not say which CLI or why')
})

await finish()
