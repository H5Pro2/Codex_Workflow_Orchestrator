import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright-core'

const projectRoot = process.cwd()
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Vite wurde nicht rechtzeitig erreichbar: ${url}`)
}

async function assertEventually(assertion, { attempts = 30, delayMs = 100 } = {}) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

function fixtureState() {
  return {
    agents: [
      {
        id: 'ceo',
        name: 'CEO',
        role: 'du bist CEO',
        projectId: 'project-1',
        projectPath: 'C:\\fixture-project',
        threadTitle: 'CEO',
        threadId: 'thread-ceo',
        assignment: 'management',
        managementInstructionRules: [
          'Nutze das vorhandene Team.',
          'Prüfe zuerst die Eignung des Teams.',
          'Verwende einen Workflow-Status.',
        ],
      },
      {
        id: 'analyst',
        name: 'Projektanalyst mit langer Bezeichnung',
        role: 'du bist Projektanalyst',
        projectId: 'project-1',
        projectPath: 'C:\\fixture-project',
        threadTitle: 'Projektanalyst',
        threadId: 'thread-analyst',
        assignment: 'specialist',
      },
      {
        id: 'qa',
        name: 'QA Tester',
        role: 'du bist QA Tester',
        projectId: 'project-1',
        projectPath: 'C:\\fixture-project',
        threadTitle: 'QA Tester',
        threadId: 'thread-qa',
        assignment: 'specialist',
      },
    ],
    events: [],
    hiddenThreadIds: [],
    routes: [{
      id: 'route-ceo-status',
      ownerAgentId: 'ceo',
      projectPath: 'C:\\fixture-project',
      sourceId: 'ceo',
      targetId: 'filter-research',
      condition: 'Immer',
      prompt: 'Arbeite weiter.',
    }, {
      id: 'route-status-analyst',
      ownerAgentId: 'ceo',
      projectPath: 'C:\\fixture-project',
      sourceId: 'filter-research',
      targetId: 'analyst',
      condition: 'Immer',
      prompt: 'Arbeite weiter.',
    }],
    workflowPrompts: [],
    workflowInitials: [],
    workflowStatuses: [{
      id: 'status-research',
      projectPath: 'C:\\fixture-project',
      name: 'Forschungsauftrag koordinieren',
      description: 'An die Forschungsleitung übergeben.',
    }],
    knowledgeSources: [],
    workflowStatusFilters: [{
      id: 'filter-research',
      ownerAgentId: 'ceo',
      projectPath: 'C:\\fixture-project',
      name: 'Status: Forschungsauftrag koordinieren',
      statusId: 'status-research',
    }],
    workflowStops: [],
    workflowTimers: [],
    workflowPositions: {},
    workflowBoardAgentIds: { ceo: ['ceo', 'analyst'] },
    deliveryQueue: {},
    workflowLoopCounts: { 'project-1': 3 },
    selectedProjectId: 'project-1',
    autoRun: false,
  }
}

test('manages internal CEO instructions through the real UI', { timeout: 75_000 }, async (t) => {
  const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))
  if (!executablePath) {
    t.skip('Kein unterstützter lokaler Chromium-Browser gefunden.')
    return
  }

  const port = await freePort()
  const vite = spawn(
    process.execPath,
    [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: projectRoot, stdio: 'ignore' },
  )
  t.after(() => vite.kill())
  await waitForServer(`http://127.0.0.1:${port}/`)

  let sharedState = fixtureState()
  let projectSources = []
  let projectGoal = ''
  let programSettings = null
  let programSettingsUpdatedAt = ''
  let version = '2026-07-25T12:00:00.000Z'
  let conversationMessages = [
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `message-progress-${index}`,
      turnId: `turn-progress-${index}`,
      role: 'assistant',
      text: `Zwischenstand ${index + 1}: Der Agent dokumentiert einen ausreichend langen Fortschrittseintrag für die Scrollprüfung.`,
      phase: 'commentary',
      turnStatus: 'completed',
    })),
    {
      id: 'message-result',
      turnId: 'turn-result',
      role: 'assistant',
      text: 'Die Umsetzung ist fertig.\n\n[Workflow-Status: Forschungsauftrag koordinieren]',
      phase: 'final_answer',
      turnStatus: 'completed',
      workspaceChanges: [{ path: 'src/auswertung.ts', kind: 'modified' }],
    },
  ]
  const browser = await chromium.launch({ executablePath, headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((state) => {
    if (window.localStorage.getItem('codex-workflow-orchestrator') === null) {
      window.localStorage.setItem('codex-workflow-orchestrator', JSON.stringify(state))
    }
  }, sharedState)
  const page = await context.newPage()
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/state' && request.method() === 'GET') {
      await route.fulfill({ json: { state: sharedState, updatedAt: version } })
      return
    }
    if (pathname === '/api/state' && request.method() === 'PUT') {
      sharedState = request.postDataJSON().state
      version = '2026-07-25T12:00:01.000Z'
      await route.fulfill({ json: { ok: true, state: sharedState, updatedAt: version } })
      return
    }
    if (pathname === '/api/projects') {
      await route.fulfill({ json: { projects: [{ id: 'project-1', label: 'Fixture', path: 'C:\\fixture-project' }] } })
      return
    }
    if (pathname === '/api/threads') {
      await route.fulfill({ json: { threads: [
        { id: 'thread-ceo', name: 'CEO', cwd: 'C:\\fixture-project', status: 'idle' },
        { id: 'thread-analyst', name: 'Projektanalyst', cwd: 'C:\\fixture-project', status: 'idle' },
      ] } })
      return
    }
    if (pathname === '/api/provisioning-recovery') {
      await route.fulfill({ json: { status: 'idle', archived: 0, preserved: 0, failures: 0 } })
      return
    }
    if (pathname === '/api/models') {
      await route.fulfill({ json: { models: [] } })
      return
    }
    if (pathname === '/api/usage') {
      await route.fulfill({ json: { rateLimits: null } })
      return
    }
    if (pathname === '/api/account') {
      await route.fulfill({ json: { suggestedName: '' } })
      return
    }
    if (pathname === '/api/threads/thread-ceo/conversation') {
      await route.fulfill({ json: { messages: conversationMessages } })
      return
    }
    if (pathname === '/api/program-settings' && request.method() === 'GET') {
      await route.fulfill({ json: { settings: programSettings, updatedAt: programSettingsUpdatedAt } })
      return
    }
    if (pathname === '/api/program-settings' && request.method() === 'PUT') {
      programSettings = request.postDataJSON().settings
      programSettingsUpdatedAt = new Date().toISOString()
      await route.fulfill({ json: { settings: programSettings, updatedAt: programSettingsUpdatedAt } })
      return
    }
    if (pathname === '/api/knowledge-sources' && request.method() === 'GET') {
      await route.fulfill({ json: { sources: projectSources } })
      return
    }
    if (pathname === '/api/knowledge-sources' && request.method() === 'PUT') {
      projectSources = request.postDataJSON().sources
      await route.fulfill({ json: { sources: projectSources } })
      return
    }
    if (pathname === '/api/project-goal' && request.method() === 'GET') {
      await route.fulfill({ json: { goal: projectGoal } })
      return
    }
    if (pathname === '/api/project-goal' && request.method() === 'PUT') {
      assert.equal(request.postDataJSON().source, 'user')
      projectGoal = request.postDataJSON().goal
      await route.fulfill({ json: { goal: projectGoal } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto(`http://127.0.0.1:${port}/`)
  const loopInput = page.getByRole('spinbutton', { name: 'Anzahl der Workflow-Läufe' })
  await assertEventually(async () => {
    assert.equal(await loopInput.inputValue(), '3')
  })
  await loopInput.fill('')
  await loopInput.type('5')
  await loopInput.press('Tab')
  await assertEventually(async () => {
    assert.equal(sharedState.workflowLoopCounts['project-1'], 5)
  })
  await page.reload()
  await assertEventually(async () => {
    assert.equal(await loopInput.inputValue(), '5')
  })
  const loopCount = page.getByLabel('Anzahl der Workflow-Läufe')
  assert.equal(await loopCount.inputValue(), '5')
  await loopCount.fill('4')
  await page.waitForTimeout(700)
  assert.equal(sharedState.workflowLoopCounts['project-1'], 4)
  await page.locator('.communicationBridge').waitFor()
  assert.equal(await page.locator('.chatMessage').count(), 0)
  await page.locator('.bridgeLastStatus').getByText('Forschungsauftrag koordinieren', { exact: true }).waitFor()
  await page.getByText('src/auswertung.ts', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Chat' }).click()
  const communicationStream = page.locator('.communicationChatStream')
  await assertEventually(async () => {
    assert.equal(await communicationStream.locator('.chatMessage').count(), conversationMessages.length)
    assert.equal(await communicationStream.evaluate((element) => (
      element.scrollHeight - element.scrollTop - element.clientHeight <= 8
    )), true)
  })
  await communicationStream.evaluate((element) => {
    element.scrollTop = 0
  })
  const jumpToLatest = page.getByRole('button', { name: 'Zu den neuesten Nachrichten springen' })
  await jumpToLatest.waitFor()
  conversationMessages = [...conversationMessages, {
    id: 'message-after-detach',
    turnId: 'turn-after-detach',
    role: 'assistant',
    text: 'Neue Nachricht nach dem manuellen Hochscrollen.\n\n[Workflow-Status: Forschungsauftrag koordinieren]',
    phase: 'commentary',
    turnStatus: 'completed',
  }]
  await assertEventually(async () => {
    assert.equal(await communicationStream.locator('.chatMessage').count(), conversationMessages.length)
  }, { attempts: 70 })
  assert.equal(await communicationStream.evaluate((element) => element.scrollTop), 0)
  await jumpToLatest.click()
  await assertEventually(async () => {
    assert.equal(await communicationStream.evaluate((element) => (
      element.scrollHeight - element.scrollTop - element.clientHeight <= 8
    )), true)
    assert.equal(await jumpToLatest.count(), 0)
  })
  await page.locator('.communicationTabs').getByRole('tab').first().click()
  await page.getByTitle('Programmeinstellungen öffnen').click()
  const workflowControlSetting = page.locator('.settingsRow', { hasText: 'Workflow-Steuerzeilen' })
  await workflowControlSetting.getByRole('checkbox').check()
  await page.waitForTimeout(400)
  assert.equal(programSettings.showWorkflowStatusLines, true)
  await page.getByRole('button', { name: 'Profil' }).click()
  await page.getByLabel('Anzeigename').fill('Globale Testperson')
  await page.getByRole('button', { name: 'Aussehen' }).click()
  await page.getByLabel('Schaltflächen', { exact: true }).fill('#224466')
  await page.getByLabel('Schaltflächentext').fill('#ffeecc')
  await page.waitForTimeout(700)
  assert.equal(programSettings.displayName, 'Globale Testperson')
  assert.equal(programSettings.buttonColor, '#224466')
  assert.equal(programSettings.buttonTextColor, '#ffeecc')
  await page.reload()
  await page.waitForFunction(() => (
    document.querySelector('.workflowLoopControl input')?.value === '4'
  ))
  assert.equal(await page.locator('.workflowLoopControl input').inputValue(), '4')
  await page.getByText('Globale Testperson', { exact: true }).waitFor()
  assert.equal(await page.locator('.chatMessage').count(), 0)
  assert.match(await page.locator('.bridgeLastStatus').textContent(), /Forschungsauftrag koordinieren/u)
  const projectGoalButtonColor = await page.getByRole('button', { name: 'Projektziel' }).evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )
  assert.equal(projectGoalButtonColor, 'rgb(34, 68, 102)')
  assert.equal(await page.getByRole('button', { name: 'Statusbefehle' }).count(), 0)
  await page.getByRole('button', { name: 'Setup öffnen' }).click()
  const knowledgeAccess = page.locator('section[aria-label="Projektwissen verwenden"]')
  const knowledgeAccessToggle = knowledgeAccess.getByRole('checkbox')
  assert.equal(await knowledgeAccessToggle.isChecked(), true)
  await knowledgeAccessToggle.uncheck()
  await page.waitForTimeout(700)
  assert.equal(sharedState.agents[0].usesProjectKnowledge, false)
  await knowledgeAccessToggle.check()
  const webAccess = page.locator('section[aria-label="Webzugriff"]')
  const webAccessSelect = webAccess.getByRole('combobox')
  assert.equal(await webAccessSelect.inputValue(), 'off')
  await webAccessSelect.selectOption('allowed')
  await page.waitForTimeout(700)
  assert.equal(sharedState.agents[0].webAccess, 'allowed')
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  const dialog = page.getByRole('dialog', { name: 'CEO-Anweisungen bearbeiten' })
  await dialog.waitFor()
  assert.equal(await dialog.locator('.managementInstructionItem').count(), 3)

  await dialog.getByLabel('Neue Anweisung').fill('Berichte knapp und prüfbar.')
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click()
  assert.equal(await dialog.locator('.managementInstructionItem').count(), 4)

  await dialog.getByRole('button', { name: 'Löschen' }).first().click()
  assert.equal(await dialog.locator('.managementInstructionItem').count(), 3)
  await dialog.getByRole('button', { name: 'Fertig' }).click()
  await page.getByText('3 Einträge · intern angewendet und im Chat ausgeblendet').waitFor()

  await page.getByRole('button', { name: 'Projektziel' }).click()
  const projectGoalDialog = page.getByRole('dialog', { name: 'Projektziel bearbeiten' })
  const projectGoalEditor = projectGoalDialog.getByLabel('Übergeordnetes Projektziel')
  await projectGoalEditor.fill('AnfangEnde')
  await projectGoalEditor.evaluate((element) => {
    const textarea = element
    textarea.setSelectionRange(6, 6)
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '  Absatz eins\n\nAbsatz zwei  ')
    textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  })
  await projectGoalDialog.getByRole('button', { name: 'Übernehmen' }).click()
  assert.equal(projectGoal, 'Anfang  Absatz eins\n\nAbsatz zwei  Ende')

  await page.getByRole('button', { name: 'Datenbank' }).click()
  const database = page.getByRole('dialog', { name: 'Wissensdatenbank konfigurieren' })
  await database.getByLabel('Name der Wissensquelle').fill('Mental Core Matrix')
  await database.getByLabel('Typ der Wissensquelle').selectOption('repository')
  await database.getByLabel('Pfad oder URL der Wissensquelle').fill('D:\\Research\\MCM')
  await database.getByLabel('Beschreibung der Wissensquelle').fill('Primäre Forschungsgrundlage')
  await database.getByRole('button', { name: 'Hinzufügen' }).click()
  await database.getByText('Mental Core Matrix').waitFor()
  assert.equal(projectSources.length, 1)
  assert.equal(projectSources[0].type, 'repository')
  assert.equal(projectSources[0].enabled, true)

  await database.getByLabel('Typ der Wissensquelle').selectOption('folder')
  await database.getByText('In dieser Kategorie wurden noch keine Wissensquellen angelegt.').waitFor()
  assert.equal(await database.getByText('Mental Core Matrix').count(), 0)
  await database.getByLabel('Typ der Wissensquelle').selectOption('repository')
  await database.getByText('Mental Core Matrix').waitFor()

  await database.getByRole('checkbox', { name: 'Aktiv' }).uncheck()
  assert.equal(projectSources[0].enabled, false)
  await database.getByRole('button', { name: 'Wissensquelle löschen: Mental Core Matrix' }).click()
  await database.getByText('In dieser Kategorie wurden noch keine Wissensquellen angelegt.').waitFor()
  assert.equal(projectSources.length, 0)

  await database.getByRole('button', { name: 'Datenbank-Fenster schließen' }).click({ timeout: 5_000 })
  await page.locator('.agentRail .agentButton', { hasText: 'Projektanalyst mit langer Bezeichnung' }).click()
  await page.getByRole('button', { name: 'Setup öffnen' }).click()
  assert.equal(await page.locator('.agentStatusMenu').count(), 0)
  await page.locator('.agentRail .agentButton', { hasText: 'CEO' }).click()
  await page.getByRole('button', { name: 'Setup öffnen' }).click()
  assert.equal(await page.locator('.agentStatusMenu').count(), 0)
  await page.getByRole('button', { name: 'Workflow-Dashboard öffnen' }).click({ timeout: 5_000 })
  const workflowDashboard = page.getByRole('dialog', { name: 'Workflow-Dashboard von CEO' })
  await workflowDashboard.waitFor({ timeout: 5_000 })
  await workflowDashboard.getByRole('button', { name: 'Agentenauswahl öffnen' }).click({ timeout: 5_000 })
  const qaOption = workflowDashboard.getByText('QA Tester').locator('..').locator('..')
  await qaOption.getByRole('checkbox').check({ timeout: 5_000 })
  await workflowDashboard.locator('.react-flow__node', { hasText: 'QA Tester' }).waitFor({ timeout: 5_000 })
  assert.equal(await workflowDashboard.locator('details.dashboardAgentMenu').getAttribute('open'), null)
  assert.equal(await page.getByRole('dialog', { name: 'Agenten-Baustein bearbeiten' }).count(), 0)

  await workflowDashboard.getByRole('button', { name: 'Agentenauswahl öffnen' }).click()
  await workflowDashboard.locator('.workflowCanvas').click({ position: { x: 18, y: 18 } })
  assert.equal(await workflowDashboard.locator('details.dashboardAgentMenu').getAttribute('open'), null)

  assert.equal(await workflowDashboard.locator('details.dashboardStatusMenu').count(), 0)

  await workflowDashboard.locator('.react-flow__edge-path').first().waitFor({ state: 'attached', timeout: 5_000 })

  const visibleEdgeCount = async () => workflowDashboard.locator('.react-flow__edge-path').evaluateAll(
    (paths) => paths.filter((path) => {
      const style = window.getComputedStyle(path)
      return Boolean(path.getAttribute('d')) && Number(style.opacity) > 0 && style.display !== 'none'
    }).length,
  )
  const waitForVisibleEdge = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await visibleEdgeCount()) > 0) return true
      await page.waitForTimeout(100)
    }
    return false
  }
  assert.equal(await waitForVisibleEdge(), true)

  const statusForwardNode = workflowDashboard.locator('.react-flow__node.statusFilter').first()
  const statusForwardNodeBoxBeforeInterval = await statusForwardNode.boundingBox()
  await statusForwardNode.dblclick()
  const statusForwardDialog = page.getByRole('dialog', { name: 'Weiterleiten konfigurieren' })
  await statusForwardDialog.getByLabel('Zusatztext für den nächsten Agenten').waitFor()
  await statusForwardDialog.getByRole('spinbutton', { name: 'Intervall' }).fill('5')
  await statusForwardDialog.getByLabel('Intervalltext').fill('Untersuche den aktuellen Stand.')
  await statusForwardDialog.getByLabel('Intervall-Verhalten').selectOption('both')
  await statusForwardDialog.getByText('Stand 0/5.').waitFor()
  await statusForwardDialog.getByRole('button', { name: 'Übernehmen' }).click()
  await page.waitForTimeout(700)
  assert.equal(sharedState.workflowStatusFilters[0].interval, 5)
  assert.equal(sharedState.workflowStatusFilters[0].intervalPrompt, 'Untersuche den aktuellen Stand.')
  assert.equal(sharedState.workflowStatusFilters[0].intervalMode, 'both')
  assert.equal(await statusForwardNode.locator('[data-handleid="output"]').count(), 1)
  assert.equal(await statusForwardNode.locator('[data-handleid="interval"]').count(), 1)
  await statusForwardNode.getByText('0/5', { exact: true }).waitFor()
  const statusForwardNodeBoxAfterInterval = await statusForwardNode.boundingBox()
  assert.ok(statusForwardNodeBoxAfterInterval.height > statusForwardNodeBoxBeforeInterval.height)

  await workflowDashboard.locator('details.dashboardTools > summary').click()
  const initialSymbolBox = await workflowDashboard.locator('.dashboardToolMenu button', { hasText: 'Initial' }).locator('.toolSymbol').boundingBox()
  const forwardSymbolBox = await workflowDashboard.locator('.dashboardToolMenu button', { hasText: 'Weiterleiten' }).locator('.toolSymbol').boundingBox()
  assert.deepEqual(
    { width: initialSymbolBox?.width, height: initialSymbolBox?.height },
    { width: forwardSymbolBox?.width, height: forwardSymbolBox?.height },
  )
  await workflowDashboard.locator('.dashboardToolMenu button', { hasText: 'Weiterleiten' }).click()
  const forwardNode = workflowDashboard.locator('.react-flow__node.prompt', { hasText: 'Weiterleiten' })
  await forwardNode.waitFor({ timeout: 5_000 })
  const forwardNodeBoxBeforeInterval = await forwardNode.boundingBox()
  await page.waitForTimeout(700)
  assert.equal(sharedState.workflowPrompts.some((prompt) => prompt.name === 'Weiterleiten'), true)
  assert.equal(await waitForVisibleEdge(), true)

  await forwardNode.dblclick()
  const forwardDialog = page.getByRole('dialog', { name: 'Weiterleiten-Baustein bearbeiten' })
  await forwardDialog.getByRole('spinbutton', { name: 'Intervall' }).fill('2')
  await forwardDialog.getByLabel('Intervalltext').fill('Erstelle eine Stichprobenübersicht.')
  await forwardDialog.getByLabel('Intervall-Verhalten').selectOption('both')
  await forwardDialog.getByText('Stand 0/2.').waitFor()
  await forwardDialog.getByRole('button', { name: 'Übernehmen' }).click()
  await page.waitForTimeout(700)
  assert.equal(sharedState.workflowPrompts.find((prompt) => prompt.name === 'Weiterleiten')?.interval, 2)
  assert.equal(sharedState.workflowPrompts.find((prompt) => prompt.name === 'Weiterleiten')?.intervalPrompt, 'Erstelle eine Stichprobenübersicht.')
  assert.equal(sharedState.workflowPrompts.find((prompt) => prompt.name === 'Weiterleiten')?.intervalMode, 'both')
  assert.equal(await forwardNode.locator('[data-handleid="output"]').count(), 1)
  assert.equal(await forwardNode.locator('[data-handleid="interval"]').count(), 1)
  await forwardNode.getByText('0/2', { exact: true }).waitFor()
  const forwardNodeBoxAfterInterval = await forwardNode.boundingBox()
  assert.ok(forwardNodeBoxAfterInterval.height > forwardNodeBoxBeforeInterval.height)

  await page.waitForTimeout(700)
  assert.deepEqual(sharedState.workflowBoardAgentIds.ceo, ['ceo', 'analyst', 'qa'])

  await workflowDashboard.locator('details.dashboardTools > summary').click()
  await workflowDashboard.locator('.dashboardToolMenu button', { hasText: 'Initial' }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Initial-Baustein bearbeiten' }).count(), 0)
})
