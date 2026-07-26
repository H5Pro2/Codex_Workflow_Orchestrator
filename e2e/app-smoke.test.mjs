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
    ],
    events: [],
    hiddenThreadIds: [],
    routes: [],
    workflowPrompts: [],
    workflowInitials: [],
    workflowStatuses: [],
    knowledgeSources: [],
    workflowStatusFilters: [],
    workflowStops: [],
    workflowTimers: [],
    workflowPositions: {},
    workflowBoardAgentIds: {},
    deliveryQueue: {},
    selectedProjectId: 'project-1',
    autoRun: false,
  }
}

test('manages internal CEO instructions through the real UI', { timeout: 45_000 }, async (t) => {
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
  let version = '2026-07-25T12:00:00.000Z'
  const browser = await chromium.launch({ executablePath, headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((state) => {
    window.localStorage.setItem('codex-workflow-orchestrator', JSON.stringify(state))
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
      projectGoal = request.postDataJSON().goal.trim()
      await route.fulfill({ json: { goal: projectGoal } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto(`http://127.0.0.1:${port}/`)
  await page.getByRole('button', { name: 'Setup öffnen' }).click()
  const knowledgeAccess = page.locator('section[aria-label="Projektwissen verwenden"]')
  const knowledgeAccessToggle = knowledgeAccess.getByRole('checkbox')
  assert.equal(await knowledgeAccessToggle.isChecked(), true)
  await knowledgeAccessToggle.uncheck()
  await page.waitForTimeout(700)
  assert.equal(sharedState.agents[0].usesProjectKnowledge, false)
  await knowledgeAccessToggle.check()
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
  await projectGoalDialog.getByLabel('Übergeordnetes Projektziel').fill('Ein nachvollziehbar geprüftes Forschungsergebnis.')
  await projectGoalDialog.getByRole('button', { name: 'Übernehmen' }).click()
  assert.equal(projectGoal, 'Ein nachvollziehbar geprüftes Forschungsergebnis.')

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
  await page.getByRole('button', { name: 'Workflow-Dashboard öffnen' }).click({ timeout: 5_000 })
  const workflowDashboard = page.getByRole('dialog', { name: 'Workflow-Dashboard von CEO' })
  await workflowDashboard.waitFor({ timeout: 5_000 })
  await workflowDashboard.getByRole('button', { name: 'Agentenauswahl öffnen' }).click({ timeout: 5_000 })
  const analystOption = workflowDashboard.getByText('Projektanalyst mit langer Bezeichnung').locator('..').locator('..')
  await analystOption.getByRole('checkbox').check({ timeout: 5_000 })
  await workflowDashboard.locator('.react-flow__node', { hasText: 'Projektanalyst mit langer Bezeichnung' }).waitFor({ timeout: 5_000 })
  await page.waitForTimeout(700)
  assert.deepEqual(sharedState.workflowBoardAgentIds.ceo, ['ceo', 'analyst'])
})
