import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { createProvisioningJournal } from './provisioning-journal.mjs'
import { createSharedStateStore } from './shared-state.mjs'
import {
  projectThreadExecutionParams,
  projectTurnExecutionParams,
  projectWorkspacePath,
} from './codex-sandbox.mjs'
import {
  MAINTENANCE_THREAD_NAME,
  createMaintenanceStateStore,
  maintenanceDiagnosticPrompt,
  maintenanceRepairPrompt,
  stoppedMaintenanceState,
} from './maintenance-agent.mjs'

const PORT = Number(process.env.CODEX_BRIDGE_PORT || 4317)
const SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(SERVER_DIR, 'orchestrator-state.json')
const PROVISIONING_JOURNAL_FILE = join(SERVER_DIR, 'provisioning-journal.json')
const MAINTENANCE_STATE_FILE = join(SERVER_DIR, 'maintenance-state.json')
const ROOT_DIR = resolve(SERVER_DIR, '..')
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex')
const CODEX_GLOBAL_STATE_FILE = join(CODEX_HOME, '.codex-global-state.json')
const LOCAL_CODEX_ENTRY = join(
  SERVER_DIR,
  '..',
  'node_modules',
  '@openai',
  'codex',
  'bin',
  'codex.js',
)
const pending = new Map()
const inactiveTurnSince = new Map()
let nextRequestId = 1
let initialized = false
let latestRateLimits = null
let latestProvisioningRecovery = {
  status: 'pending',
  completedAt: null,
  transactions: 0,
  archived: 0,
  preserved: 0,
  failures: 0,
}
const sharedStateStore = createSharedStateStore(STATE_FILE)
const provisioningJournal = createProvisioningJournal(PROVISIONING_JOURNAL_FILE)
const maintenanceStateStore = createMaintenanceStateStore(MAINTENANCE_STATE_FILE)

const codex = spawn(
  process.execPath,
  [LOCAL_CODEX_ENTRY, 'app-server', '--listen', 'stdio://'],
  {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  },
)

const lines = createInterface({ input: codex.stdout })

function send(message) {
  codex.stdin.write(`${JSON.stringify(message)}\n`)
}

function request(method, params = {}) {
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Zeitüberschreitung bei ${method}`))
    }, 30000)
    pending.set(id, { resolve, reject, timer })
    send({ method, id, params })
  })
}

lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.id == null) {
    if (message.method === 'account/rateLimits/updated' && message.params?.rateLimits) {
      latestRateLimits = message.params.rateLimits
    }
    return
  }

  const entry = pending.get(message.id)
  if (!entry) {
    return
  }

  clearTimeout(entry.timer)
  pending.delete(message.id)
  if (message.error) {
    entry.reject(new Error(message.error.message || 'Codex-App-Server-Fehler'))
  } else {
    entry.resolve(message.result)
  }
})

codex.on('exit', (code) => {
  initialized = false
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error(`Codex App Server wurde beendet (${code ?? 'unbekannt'}).`))
  }
  pending.clear()
})

async function initialize() {
  await request('initialize', {
    clientInfo: {
      name: 'codex_workflow_orchestrator',
      title: 'Codex Workflow Orchestrator',
      version: '0.1.0',
    },
    capabilities: {
      experimentalApi: true,
      optOutNotificationMethods: ['item/agentMessage/delta'],
    },
  })
  send({ method: 'initialized', params: {} })
  initialized = true
}

const ready = initialize()

const provisioningRecoveryReady = ready.then(async () => {
  const sharedState = (await sharedStateStore.read()).state
  const recovered = await provisioningJournal.recover(
    (threadId) => request('thread/archive', { threadId }),
    (transaction) => Array.isArray(sharedState?.agents) && sharedState.agents.some((agent) =>
      agent.id === transaction.metadata?.managerAgentId &&
      agent.lastAppliedTeamPlanSignature === transaction.metadata?.signature,
    ),
  )
  const archived = recovered.reduce((total, transaction) => total + transaction.archived, 0)
  const failures = recovered.reduce((total, transaction) => total + transaction.failures.length, 0)
  const preserved = recovered.filter((transaction) => transaction.preserved).length
  latestProvisioningRecovery = {
    status: failures > 0 ? 'attention' : 'complete',
    completedAt: new Date().toISOString(),
    transactions: recovered.length,
    archived,
    preserved,
    failures,
  }
  if (archived > 0 || failures > 0) {
    console.log(`Team-Wiederherstellung: ${archived} unvollstÃ¤ndige Chats archiviert, ${failures} Fehler.`)
  }
}).catch((error) => {
  latestProvisioningRecovery = {
    ...latestProvisioningRecovery,
    status: 'failed',
    completedAt: new Date().toISOString(),
    failures: Math.max(1, latestProvisioningRecovery.failures),
  }
  console.error('Team-Wiederherstellung fehlgeschlagen:', error)
})

async function listAllThreads({ includeMaintenance = false } = {}) {
  await ready
  const threads = []
  let cursor = null
  do {
    const result = await request('thread/list', {
      cursor,
      limit: 100,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'],
    })
    threads.push(...result.data.map(normalizeThread))
    cursor = result.nextCursor
  } while (cursor)
  return includeMaintenance
    ? threads
    : threads.filter((thread) => thread.name !== MAINTENANCE_THREAD_NAME)
}

async function ensureMaintenanceThread() {
  const state = await maintenanceStateStore.read()
  if (state.threadId) {
    try {
      await request('thread/read', { threadId: state.threadId, includeTurns: false })
      return state.threadId
    } catch {
      // A removed maintenance task is recreated transparently.
    }
  }

  const result = await request('thread/start', {
    cwd: ROOT_DIR,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  })
  await request('thread/name/set', { threadId: result.thread.id, name: MAINTENANCE_THREAD_NAME })
  await maintenanceStateStore.write({ ...state, threadId: result.thread.id })
  return result.thread.id
}

async function refreshMaintenanceState() {
  const state = await maintenanceStateStore.read()
  if (!state.threadId || !state.turnId || !['diagnosing', 'repairing'].includes(state.status)) {
    return state
  }
  try {
    const result = await request('thread/read', { threadId: state.threadId, includeTurns: true })
    const turn = (result.thread?.turns ?? []).find((item) => item.id === state.turnId)
    if (!turn || turn.status === 'inProgress') return state
    const report = (turn.items ?? [])
      .filter((item) => item.type === 'agentMessage' && typeof item.text === 'string')
      .map((item) => item.text)
      .filter(Boolean)
      .at(-1) ?? ''
    return maintenanceStateStore.write({
      ...state,
      status: turn.status === 'completed' ? 'ready' : 'failed',
      report,
      error: turn.status === 'completed' ? '' : turn.error?.message ?? 'Wartungs-Task nicht abgeschlossen.',
    })
  } catch (error) {
    return maintenanceStateStore.write({
      ...state,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Wartungsstatus konnte nicht gelesen werden.',
    })
  }
}

async function listSavedProjects() {
  const rawState = await readFile(CODEX_GLOBAL_STATE_FILE, 'utf8')
  const state = JSON.parse(rawState)
  const localProjects = state['local-projects'] ?? {}
  const projectOrder = Array.isArray(state['project-order']) ? state['project-order'] : []
  const projectsById = new Map(
    Object.values(localProjects)
      .filter((project) => (
        project &&
        typeof project.id === 'string' &&
        typeof project.name === 'string' &&
        Array.isArray(project.rootPaths) &&
        typeof project.rootPaths[0] === 'string'
      ))
      .map((project) => [project.id, {
        id: project.id,
        label: project.name,
        path: project.rootPaths[0].replace(/^\\\\\?\\/, ''),
      }]),
  )

  const orderedProjects = projectOrder
    .map((projectId) => projectsById.get(projectId))
    .filter(Boolean)
  const orderedIds = new Set(orderedProjects.map((project) => project.id))
  const remainingProjects = [...projectsById.values()]
    .filter((project) => !orderedIds.has(project.id))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))

  return [...orderedProjects, ...remainingProjects]
}

async function waitForThreadListed(threadId, cwd) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await request('thread/list', {
      limit: 100,
      sortKey: 'updated_at',
      archived: false,
      cwd,
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'],
    })
    const thread = result.data.find((item) => item.id === threadId)
    if (thread) {
      return normalizeThread(thread)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Der neue Codex-Chat wurde erstellt, aber noch nicht im Projekt-Inventar bestätigt.')
}

async function readThreadTurnIds(threadId) {
  try {
    const result = await request('thread/read', {
      threadId,
      includeTurns: true,
    })
    return new Set((result.thread?.turns ?? []).map((turn) => turn.id).filter(Boolean))
  } catch {
    return new Set()
  }
}

function turnContainsSubmittedText(turn, submittedText) {
  const normalizedText = submittedText.trim()
  return (turn?.items ?? []).some((item) =>
    item.type === 'userMessage' &&
    (item.content ?? [])
      .filter((content) => content.type === 'text' && typeof content.text === 'string')
      .map((content) => content.text)
      .join('\n')
      .trim() === normalizedText,
  )
}

async function waitForStartedTurn(
  threadId,
  previousTurnIds,
  preferredTurnId = '',
  submittedText = '',
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await request('thread/read', {
        threadId,
        includeTurns: true,
      })
      const turns = result.thread?.turns ?? []
      const preferredTurn = preferredTurnId
        ? turns.find((turn) => turn.id === preferredTurnId)
        : null
      if (preferredTurn && turnContainsSubmittedText(preferredTurn, submittedText)) {
        return preferredTurn
      }
      const newTurn = turns.findLast((turn) =>
        turn.id &&
        !previousTurnIds.has(turn.id) &&
        turnContainsSubmittedText(turn, submittedText),
      )
      if (newTurn) {
        return newTurn
      }
    } catch {
      // Der neue Turn kann kurz nach turn/start noch nicht im Protokoll stehen.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

async function finalizeCreatedThreadName(threadId, turnId, name) {
  if (turnId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const result = await request('thread/read', {
          threadId,
          includeTurns: true,
        })
        const turn = (result.thread?.turns ?? []).find((item) => item.id === turnId)
        if (turn && turn.status !== 'inProgress') {
          break
        }
      } catch {
        // The new thread can take a moment to appear in the local history.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  await request('thread/name/set', { threadId, name })
}

async function startTurn(threadId, text, model = '', cwd = '') {
  const previousTurnIds = await readThreadTurnIds(threadId)
  if (cwd) await mkdir(projectWorkspacePath(cwd), { recursive: true })
  const turnParams = {
    threadId,
    input: [{ type: 'text', text, text_elements: [] }],
    ...(model ? { model } : {}),
    ...(cwd ? projectTurnExecutionParams(cwd) : {}),
  }
  try {
    const started = await request('turn/start', turnParams)
    const persistedTurn = await waitForStartedTurn(
      threadId,
      previousTurnIds,
      started.turn?.id ?? '',
      text,
    )
    return persistedTurn ? { ...started, turn: persistedTurn } : started
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('thread not found')) {
      throw error
    }
  }

  const thread = (await listAllThreads({ includeMaintenance: true })).find((item) => item.id === threadId)
  if (!thread) {
    throw new Error(`Codex-Task nicht gefunden: ${threadId}`)
  }
  try {
    await request('thread/resume', {
      threadId,
      path: thread.path ?? null,
      cwd: thread.cwd,
      persistExtendedHistory: true,
    })
    const started = await request('turn/start', turnParams)
    const persistedTurn = await waitForStartedTurn(
      threadId,
      previousTurnIds,
      started.turn?.id ?? '',
      text,
    )
    return persistedTurn ? { ...started, turn: persistedTurn } : started
  } catch {
    return migrateLegacyThreadAndStart(thread, text, model)
  }
}

async function migrateLegacyThreadAndStart(thread, text, model = '') {
  let previousResult = null
  try {
    previousResult = await readThreadResultFromRollout(thread.id, null)
  } catch {
    previousResult = null
  }
  await mkdir(projectWorkspacePath(thread.cwd), { recursive: true })
  const started = await request('thread/start', {
    ...projectThreadExecutionParams(thread.cwd),
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  })
  await request('thread/name/set', {
    threadId: started.thread.id,
    name: thread.name || thread.preview || 'Migrierter Agent',
  })
  const context = previousResult?.text
    ? previousResult.text.slice(-12_000)
    : 'Für den vorherigen Chat konnte kein Abschlusskontext gelesen werden.'
  const turn = await request('turn/start', {
    threadId: started.thread.id,
    ...(model ? { model } : {}),
    ...projectTurnExecutionParams(thread.cwd),
    input: [{
      type: 'text',
      text: [
        'Dieser Codex-Chat führt einen älteren, technisch nicht mehr fortsetzbaren Projekt-Chat weiter.',
        '',
        'Letzter bekannter Abschlusskontext:',
        context,
        '',
        'Aktueller Auftrag des Workflow-Orchestrators:',
        text,
      ].join('\n'),
      text_elements: [],
    }],
  })
  const persistedTurn = await waitForStartedTurn(
    started.thread.id,
    new Set(),
    turn.turn?.id ?? '',
  )
  const replacementThread = await waitForThreadListed(started.thread.id, thread.cwd)
  return {
    turn: persistedTurn ?? turn.turn,
    replacementThread: {
      ...replacementThread,
      name: thread.name || thread.preview || 'Migrierter Agent',
      replacesThreadId: thread.id,
    },
  }
}

function normalizeThread(thread) {
  return {
    ...thread,
    cwd: thread.cwd.replace(/^\\\\\?\\/, ''),
    status: typeof thread.status === 'string' ? thread.status : thread.status?.type || 'notLoaded',
  }
}

async function readThreadResultFromRollout(threadId, requestedTurnId) {
  const thread = (await listAllThreads()).find((item) => item.id === threadId)
  if (!thread?.path) {
    throw new Error('Für diesen Codex-Task wurde keine lokale Historie gefunden.')
  }

  const turns = new Map()
  let latestTurnId = ''
  const historyStats = await stat(thread.path)
  const startOffset = Math.max(0, historyStats.size - 64 * 1024 * 1024)
  let skipPartialFirstLine = startOffset > 0
  const historyLines = createInterface({
    input: createReadStream(thread.path, { encoding: 'utf8', start: startOffset }),
    crlfDelay: Infinity,
  })

  for await (const line of historyLines) {
    if (skipPartialFirstLine) {
      skipPartialFirstLine = false
      continue
    }
    if (!line.trim()) {
      continue
    }
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (entry.type === 'turn_context' && entry.payload?.turn_id) {
      latestTurnId = entry.payload.turn_id
      if (!turns.has(latestTurnId)) {
        turns.set(latestTurnId, {
          turnId: latestTurnId,
          status: 'inProgress',
          text: '',
          durationMs: null,
          error: null,
        })
      }
      continue
    }

    if (
      entry.type === 'response_item' &&
      entry.payload?.type === 'message' &&
      entry.payload?.role === 'assistant'
    ) {
      const turnId =
        entry.payload.internal_chat_message_metadata_passthrough?.turn_id || latestTurnId
      if (!turnId) {
        continue
      }
      const turn = turns.get(turnId) ?? {
        turnId,
        status: 'inProgress',
        text: '',
        durationMs: null,
        error: null,
      }
      const text = (entry.payload.content ?? [])
        .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
      if (text) {
        turn.text = text
      }
      turns.set(turnId, turn)
      continue
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'task_complete') {
      const turnId = entry.payload.turn_id || latestTurnId
      const turn = turns.get(turnId) ?? { turnId }
      turns.set(turnId, {
        ...turn,
        status: 'completed',
        text: entry.payload.last_agent_message || turn.text || '',
        durationMs: entry.payload.duration_ms ?? null,
        error: null,
      })
      continue
    }

    if (
      entry.type === 'event_msg' &&
      ['turn_aborted', 'task_failed'].includes(entry.payload?.type)
    ) {
      const turnId = entry.payload.turn_id || latestTurnId
      const turn = turns.get(turnId) ?? { turnId }
      turns.set(turnId, {
        ...turn,
        status: entry.payload.type === 'turn_aborted' ? 'interrupted' : 'failed',
        error: entry.payload.error ?? entry.payload.reason ?? null,
      })
    }
  }

  const turn = requestedTurnId
    ? turns.get(requestedTurnId)
    : Array.from(turns.values()).at(-1)
  if (!turn) {
    throw new Error('Codex-Turn wurde in der lokalen Historie nicht gefunden.')
  }
  return turn
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(requestMessage) {
  const chunks = []
  for await (const chunk of requestMessage) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) {
    return {}
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (incoming, response) => {
  const url = new URL(incoming.url || '/', `http://${incoming.headers.host || '127.0.0.1'}`)

  try {
    if (incoming.method === 'GET' && url.pathname === '/api/health') {
      await ready
      sendJson(response, 200, { online: initialized })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/system-maintenance') {
      await ready
      sendJson(response, 200, await refreshMaintenanceState())
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/system-maintenance/diagnose') {
      const body = await readJson(incoming)
      const current = await refreshMaintenanceState()
      if (['diagnosing', 'repairing'].includes(current.status)) {
        sendJson(response, 409, { error: 'Der Kommunikations-Handwerker arbeitet bereits.', state: current })
        return
      }
      const threadId = await ensureMaintenanceThread()
      const started = await startTurn(
        threadId,
        maintenanceDiagnosticPrompt(
          typeof body.incident === 'string' ? body.incident : '',
          typeof body.context === 'string' ? body.context : '',
        ),
      )
      const state = await maintenanceStateStore.write({
        ...current,
        threadId,
        turnId: started.turn?.id ?? '',
        status: 'diagnosing',
        origin: body.automatic === true ? 'automatic' : 'manual',
        incident: typeof body.incident === 'string' ? body.incident.trim() : '',
        report: '',
        error: '',
      })
      sendJson(response, 202, state)
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/system-maintenance/interrupt') {
      const body = await readJson(incoming)
      const current = await refreshMaintenanceState()
      if (!['diagnosing', 'repairing'].includes(current.status)) {
        sendJson(response, 200, current)
        return
      }
      if (body.automaticOnly === true && current.origin !== 'automatic') {
        sendJson(response, 200, current)
        return
      }
      if (current.threadId && current.turnId) {
        await request('turn/interrupt', {
          threadId: current.threadId,
          turnId: current.turnId,
        }).catch(() => undefined)
      }
      const state = await maintenanceStateStore.write(stoppedMaintenanceState(current))
      sendJson(response, 200, state)
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/system-maintenance/repair') {
      const body = await readJson(incoming)
      if (body.confirmed !== true) {
        sendJson(response, 400, { error: 'Die Reparatur wurde nicht ausdrücklich bestätigt.' })
        return
      }
      const current = await refreshMaintenanceState()
      if (current.status !== 'ready' || !current.report.trim()) {
        sendJson(response, 409, { error: 'Es liegt kein bestätigungsfähiger Wartungsbericht vor.', state: current })
        return
      }
      const threadId = await ensureMaintenanceThread()
      const started = await startTurn(threadId, maintenanceRepairPrompt(current.report))
      const state = await maintenanceStateStore.write({
        ...current,
        threadId,
        turnId: started.turn?.id ?? '',
        status: 'repairing',
        error: '',
      })
      sendJson(response, 202, state)
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/system-maintenance/restart') {
      const body = await readJson(incoming)
      if (body.confirmed !== true) {
        sendJson(response, 400, { error: 'Der Connector-Neustart wurde nicht ausdrücklich bestätigt.' })
        return
      }
      const current = await refreshMaintenanceState()
      if (!['ready', 'failed'].includes(current.status)) {
        sendJson(response, 409, { error: 'Ein Neustart ist erst nach abgeschlossener Diagnose möglich.' })
        return
      }
      const nodePath = process.execPath.replaceAll("'", "''")
      const bridgePath = join(SERVER_DIR, 'bridge.mjs').replaceAll("'", "''")
      const rootPath = ROOT_DIR.replaceAll("'", "''")
      const restartScript = [
        `$oldPid = ${process.pid}`,
        'while (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }',
        `Start-Process -FilePath '${nodePath}' -ArgumentList '${bridgePath}' -WorkingDirectory '${rootPath}' -WindowStyle Hidden`,
      ].join('; ')
      const helper = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', restartScript], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      helper.unref()
      sendJson(response, 202, { restarting: true })
      setTimeout(() => {
        shutdown()
        process.exit(0)
      }, 250)
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/provisioning-recovery') {
      await provisioningRecoveryReady
      sendJson(response, 200, latestProvisioningRecovery)
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await sharedStateStore.read())
      return
    }

    if (incoming.method === 'PUT' && url.pathname === '/api/state') {
      const body = await readJson(incoming)
      const result = await sharedStateStore.update(body.state, {
        expectedUpdatedAt: body.expectedUpdatedAt,
        force: body.force === true,
      })
      if (!result.ok) {
        sendJson(response, 409, {
          error: 'Der gemeinsame Zustand wurde zwischenzeitlich geändert.',
          state: result.state,
          updatedAt: result.updatedAt,
        })
        return
      }
      sendJson(response, 200, { ok: true, updatedAt: result.updatedAt })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/threads') {
      const threads = await listAllThreads()
      sendJson(response, 200, { threads })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/projects') {
      const projects = await listSavedProjects()
      sendJson(response, 200, { projects })
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/provisioning-transactions') {
      const body = await readJson(incoming)
      const transaction = await provisioningJournal.create({
        projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
        managerAgentId: typeof body.managerAgentId === 'string' ? body.managerAgentId : '',
        signature: typeof body.signature === 'string' ? body.signature : '',
      })
      sendJson(response, 201, { transaction })
      return
    }

    const provisioningRollbackMatch = url.pathname.match(/^\/api\/provisioning-transactions\/([^/]+)\/rollback$/)
    if (incoming.method === 'POST' && provisioningRollbackMatch) {
      await ready
      const result = await provisioningJournal.rollback(
        decodeURIComponent(provisioningRollbackMatch[1]),
        (threadId) => request('thread/archive', { threadId }),
      )
      if (result.failures.length > 0) {
        sendJson(response, 500, {
          error: `${result.failures.length} unvollstÃ¤ndige Codex-Chats konnten nicht archiviert werden.`,
          archived: result.archived,
        })
        return
      }
      sendJson(response, 200, { ok: true, found: result.found, archived: result.archived })
      return
    }

    const provisioningCommitMatch = url.pathname.match(/^\/api\/provisioning-transactions\/([^/]+)$/)
    if (incoming.method === 'DELETE' && provisioningCommitMatch) {
      const committed = await provisioningJournal.commit(decodeURIComponent(provisioningCommitMatch[1]))
      sendJson(response, committed ? 200 : 404, committed
        ? { ok: true }
        : { error: 'Team-Transaktion wurde nicht gefunden.' })
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/threads') {
      const body = await readJson(incoming)
      if (!body.cwd || !body.name) {
        sendJson(response, 400, { error: 'Projektpfad und Name sind erforderlich.' })
        return
      }
      await ready
      await mkdir(projectWorkspacePath(body.cwd), { recursive: true })
      const result = await request('thread/start', {
        ...projectThreadExecutionParams(body.cwd),
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      })
      const transactionId = typeof body.provisioningTransactionId === 'string'
        ? body.provisioningTransactionId.trim()
        : ''
      if (transactionId) {
        try {
          const tracked = await provisioningJournal.addThread(transactionId, result.thread.id)
          if (!tracked) throw new Error('Team-Transaktion wurde nicht gefunden.')
        } catch (error) {
          await request('thread/archive', { threadId: result.thread.id }).catch(() => undefined)
          throw error
        }
      }
      const initialTurn = body.startInitialPrompt === false
        ? null
        : await request('turn/start', {
            threadId: result.thread.id,
            ...projectTurnExecutionParams(body.cwd),
            input: [
              {
                type: 'text',
                text:
                  body.initialPrompt ||
                  'Dieser Agent wurde vom Codex Workflow Orchestrator erstellt. Warte auf die konkrete Rollen-Anweisung und Aufgabe.',
                text_elements: [],
              },
            ],
          })
      const createdThread = normalizeThread({
        ...result.thread,
        cwd: result.thread.cwd || body.cwd,
        status: initialTurn ? 'active' : result.thread.status,
      })
      void finalizeCreatedThreadName(
        result.thread.id,
        initialTurn?.turn?.id ?? '',
        body.name,
      ).catch((error) => {
        console.error(`Codex-Chat ${result.thread.id} konnte nicht benannt werden:`, error)
      })
      sendJson(response, 201, {
        thread: { ...createdThread, name: body.name },
        turn: initialTurn?.turn ?? null,
        inventoryPending: true,
      })
      return
    }

    if (incoming.method === 'POST' && url.pathname === '/api/prompt-files') {
      const body = await readJson(incoming)
      const projectPath = typeof body.cwd === 'string' ? body.cwd.trim() : ''
      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
      const requestedFileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      const content = typeof body.content === 'string' ? body.content : ''
      const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '')
      const safeFileName = basename(requestedFileName)

      if (!projectPath || !safeAgentId || !safeFileName || safeFileName !== requestedFileName) {
        sendJson(response, 400, { error: 'Projekt, Agent und ein gültiger Dateiname sind erforderlich.' })
        return
      }

      const fileName = safeFileName.toLocaleLowerCase('de-DE').endsWith('.md')
        ? safeFileName
        : `${safeFileName}.md`
      const promptDirectory = join(resolve(projectPath), '.codex-orchestrator', 'prompts', safeAgentId)
      const targetPath = join(promptDirectory, fileName)
      await mkdir(promptDirectory, { recursive: true })
      await writeFile(targetPath, content, 'utf8')
      sendJson(response, 200, {
        path: relative(resolve(projectPath), targetPath).replaceAll('\\', '/'),
      })
      return
    }

    if (incoming.method === 'PATCH' && url.pathname === '/api/prompt-files') {
      const body = await readJson(incoming)
      const projectPath = typeof body.cwd === 'string' ? body.cwd.trim() : ''
      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
      const oldFileName = typeof body.oldFileName === 'string' ? body.oldFileName.trim() : ''
      const requestedFileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '')
      const safeOldFileName = basename(oldFileName)
      const safeFileName = basename(requestedFileName)

      if (
        !projectPath ||
        !safeAgentId ||
        !safeOldFileName ||
        !safeFileName ||
        safeOldFileName !== oldFileName ||
        safeFileName !== requestedFileName
      ) {
        sendJson(response, 400, { error: 'Projekt, Agent und gültige Dateinamen sind erforderlich.' })
        return
      }

      const normalizedOldFileName = safeOldFileName.toLocaleLowerCase('de-DE').endsWith('.md')
        ? safeOldFileName
        : `${safeOldFileName}.md`
      const fileName = safeFileName.toLocaleLowerCase('de-DE').endsWith('.md')
        ? safeFileName
        : `${safeFileName}.md`
      const promptDirectory = join(resolve(projectPath), '.codex-orchestrator', 'prompts', safeAgentId)
      const oldPath = join(promptDirectory, normalizedOldFileName)
      const targetPath = join(promptDirectory, fileName)

      if (normalizedOldFileName !== fileName) {
        try {
          await rename(oldPath, targetPath)
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
            throw error
          }
        }
      }
      sendJson(response, 200, {
        path: relative(resolve(projectPath), targetPath).replaceAll('\\', '/'),
      })
      return
    }

    const nameMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/name$/)
    if (incoming.method === 'PATCH' && nameMatch) {
      const body = await readJson(incoming)
      await ready
      await request('thread/name/set', {
        threadId: decodeURIComponent(nameMatch[1]),
        name: body.name,
      })
      sendJson(response, 200, { ok: true })
      return
    }

    const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/)
    if (incoming.method === 'POST' && messageMatch) {
      const body = await readJson(incoming)
      await ready
      const result = await startTurn(
        decodeURIComponent(messageMatch[1]),
        body.text,
        typeof body.model === 'string' ? body.model : '',
        typeof body.cwd === 'string' ? body.cwd : '',
      )
      sendJson(response, 202, {
        turn: result.turn,
        replacementThread: result.replacementThread ?? null,
      })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/models') {
      await ready
      const result = await request('model/list', { limit: 100 })
      sendJson(response, 200, {
        models: (result.data ?? [])
          .filter((model) => !model.hidden)
          .map((model) => ({
            id: model.model || model.id,
            name: model.displayName || model.model || model.id,
            isDefault: Boolean(model.isDefault),
          })),
      })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/usage') {
      await ready
      const result = await request('account/rateLimits/read')
      latestRateLimits = result.rateLimits ?? latestRateLimits
      sendJson(response, 200, {
        rateLimits: latestRateLimits,
        rateLimitsByLimitId: result.rateLimitsByLimitId ?? null,
      })
      return
    }

    if (incoming.method === 'GET' && url.pathname === '/api/account') {
      await ready
      const result = await request('account/read', { refreshToken: false })
      const account = result.account ?? null
      const email = account?.type === 'chatgpt' && typeof account.email === 'string'
        ? account.email.trim()
        : ''
      const suggestedName = email.includes('@') ? email.slice(0, email.indexOf('@')) : ''
      sendJson(response, 200, {
        accountType: account?.type ?? '',
        suggestedName,
        planType: account?.type === 'chatgpt' ? account.planType ?? null : null,
      })
      return
    }

    const conversationMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/conversation$/)
    if (incoming.method === 'GET' && conversationMatch) {
      await ready
      const threadId = decodeURIComponent(conversationMatch[1])
      const result = await request('thread/read', {
        threadId,
        includeTurns: true,
      })
      const turns = result.thread?.turns ?? []
      const messages = turns.flatMap((turn) =>
        (turn.items ?? []).flatMap((item) => {
          if (item.type === 'userMessage') {
            const text = (item.content ?? [])
              .filter((content) => content.type === 'text' && typeof content.text === 'string')
              .map((content) => content.text)
              .join('\n')
            return text
              ? [{
                  id: item.id,
                  turnId: turn.id,
                  role: 'user',
                  text,
                  phase: 'request',
                  turnStatus: turn.status,
                }]
              : []
          }
          if (item.type === 'agentMessage' && typeof item.text === 'string') {
            return [{
              id: item.id,
              turnId: turn.id,
              role: 'assistant',
              text: item.text,
              phase: item.phase ?? 'message',
              turnStatus: turn.status,
            }]
          }
          return []
        }),
      )
      sendJson(response, 200, { messages })
      return
    }

    const interruptMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/)
    if (incoming.method === 'POST' && interruptMatch) {
      const body = await readJson(incoming)
      const turnId = typeof body.turnId === 'string' ? body.turnId.trim() : ''
      if (!turnId) {
        sendJson(response, 400, { error: 'Turn-ID ist erforderlich.' })
        return
      }
      await ready
      const threadId = decodeURIComponent(interruptMatch[1])
      try {
        await request('turn/interrupt', { threadId, turnId })
        sendJson(response, 200, { interrupted: true, alreadyInactive: false, turnId })
      } catch (error) {
        const result = await request('thread/read', { threadId, includeTurns: true })
        const status = typeof result.thread?.status === 'string'
          ? result.thread.status
          : result.thread?.status?.type ?? ''
        if (['idle', 'notLoaded', 'systemError'].includes(status)) {
          sendJson(response, 200, { interrupted: false, alreadyInactive: true, turnId })
          return
        }
        throw error
      }
      return
    }

    const resultMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/result$/)
    if (incoming.method === 'GET' && resultMatch) {
      await ready
      const threadId = decodeURIComponent(resultMatch[1])
      const requestedTurnId = url.searchParams.get('turnId')
      const turnObservationKey = requestedTurnId ? `${threadId}:${requestedTurnId}` : ''
      let turn = null
      let threadStatusType = ''
      try {
        const result = await request('thread/read', {
          threadId,
          includeTurns: true,
        })
        threadStatusType = typeof result.thread?.status === 'string'
          ? result.thread.status
          : result.thread?.status?.type ?? ''
        const turns = result.thread?.turns ?? []
        const protocolTurn = requestedTurnId
          ? turns.find((item) => item.id === requestedTurnId)
          : turns.at(-1)
        if (protocolTurn) {
          const agentMessages = (protocolTurn.items ?? [])
            .filter((item) => item.type === 'agentMessage' && typeof item.text === 'string')
            .map((item) => item.text)
            .filter(Boolean)
          turn = {
            turnId: protocolTurn.id,
            status: protocolTurn.status,
            text: agentMessages.at(-1) ?? '',
            durationMs: protocolTurn.durationMs ?? null,
            error: protocolTurn.error ?? null,
          }
          if (protocolTurn.status === 'completed' && turnObservationKey) {
            inactiveTurnSince.delete(turnObservationKey)
          }
        }
      } catch {
        // Manche Codex-Tasks erscheinen kurz nach dem Start noch nicht im Protokoll.
      }

      try {
        const inventoryStatus = (await listAllThreads()).find((item) => item.id === threadId)?.status ?? ''
        threadStatusType = inventoryStatus || threadStatusType
      } catch {
        // Das Ergebnis-Fallback bleibt auch bei einem voruebergehend fehlenden Inventar nutzbar.
      }

      if (!turn) {
        try {
          turn = await readThreadResultFromRollout(threadId, requestedTurnId)
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (requestedTurnId && message.includes('Historie nicht gefunden')) {
            const threadIsIdle = ['idle', 'notLoaded', 'systemError'].includes(threadStatusType)
            if (!threadIsIdle) {
              inactiveTurnSince.delete(turnObservationKey)
            }
            const firstInactiveAt = threadIsIdle
              ? inactiveTurnSince.get(turnObservationKey) ?? Date.now()
              : Date.now()
            if (threadIsIdle) {
              inactiveTurnSince.set(turnObservationKey, firstInactiveAt)
            }
            const inactivityConfirmed = threadIsIdle && Date.now() - firstInactiveAt >= 20_000
            turn = inactivityConfirmed
              ? {
                  turnId: requestedTurnId,
                  status: 'interrupted',
                  text: '',
                  durationMs: null,
                  error: {
                    message: 'Codex-Task ist inaktiv; der angeforderte Turn fehlt in der Historie.',
                  },
                }
              : {
                  turnId: requestedTurnId,
                  status: 'inProgress',
                  text: '',
                  durationMs: null,
                  error: null,
                }
          } else {
            throw error
          }
        }
      }

      if (
        requestedTurnId &&
        turn?.status === 'inProgress' &&
        ['idle', 'notLoaded', 'systemError'].includes(threadStatusType)
      ) {
        const firstInactiveAt = inactiveTurnSince.get(turnObservationKey) ?? Date.now()
        inactiveTurnSince.set(turnObservationKey, firstInactiveAt)
        if (Date.now() - firstInactiveAt >= 20_000) {
          turn = {
            ...turn,
            status: 'interrupted',
            error: {
              message: 'Codex-Task ist inaktiv; der angeforderte Turn wurde nicht abgeschlossen.',
            },
          }
        }
      } else if (turnObservationKey && turn?.status !== 'inProgress') {
        inactiveTurnSince.delete(turnObservationKey)
      }

      sendJson(response, 200, turn)
      return
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/)
    if (incoming.method === 'DELETE' && threadMatch) {
      await ready
      await request('thread/archive', { threadId: decodeURIComponent(threadMatch[1]) })
      sendJson(response, 200, { archived: true })
      return
    }

    sendJson(response, 404, { error: 'Endpunkt nicht gefunden.' })
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unbekannter Connector-Fehler',
    })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Codex-Connector: http://127.0.0.1:${PORT}`)
})

function shutdown() {
  server.close()
  codex.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
