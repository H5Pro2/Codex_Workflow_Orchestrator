import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'

type AgentStatus = 'wartet' | 'laeuft' | 'fertig' | 'rueckfrage' | 'weitergegeben'
type UiLanguage = 'de' | 'en'
type AgentAssignment = 'agent' | 'management'

type ManagementTeamPlanAgent = {
  name: string
  role: string
  prompt: string
  workflowStatuses: string[]
}

type ManagementTeamPlanConnection = {
  from: string
  to: string
}

type ManagementTeamPlan = {
  projectGoal: string
  agents: ManagementTeamPlanAgent[]
  connections: ManagementTeamPlanConnection[]
}

type PromptDocument = {
  id: string
  name: string
  fileName: string
  content: string
  filePath: string
  lastSentContent: string | null
  updatedAt: string
}

type Agent = {
  id: string
  name: string
  role: string
  projectId: string
  projectPath: string
  threadTitle: string
  threadId: string
  model: string
  prompt: string
  promptDocuments: PromptDocument[]
  activePromptDocumentId: string
  status: AgentStatus
  talkTo: string[]
  autoForward: boolean
  assignment: AgentAssignment
  monitoredAgentIds: string[]
  monitoringEnabled: boolean
  monitoringIntervalMinutes: number
  lastMonitoringAt: string
  teamProvisioningEnabled: boolean
  lastAppliedTeamPlanSignature: string
  workflowStatusIds: string[] | null
  workflowStatusUpdatedAt: string
  finishSignal: string
  lastResult: string
  instructionVersion: number
  lastInstruction: string
  runStartedAt: string
  lastDurationMs: number
  completedRuns: number
  pendingTurnId: string
  lastCompletedTurnId: string
  updatedAt: string
}

type EventLog = {
  id: string
  at: string
  title: string
  detail: string
}

type CodexProject = {
  id: string
  label: string
  path: string
}

type CodexThread = {
  id: string
  title: string
  cwd: string
  status: string
}

type ChatMessage = {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  text: string
  phase: string
  turnStatus: string
}

type CodexModel = {
  id: string
  name: string
  isDefault: boolean
}

type UsageSummary = {
  remainingPercent: number | null
  resetsAt: number | null
  credits: string | null
  unlimited: boolean
}

type WorkflowRoute = {
  id: string
  ownerAgentId: string
  projectPath: string
  sourceId: string
  targetId: string
  condition: string
  prompt: string
  lastForwardedTask?: string
}

type WorkflowPrompt = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  condition: string
  prompt: string
}

type WorkflowInitial = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  instruction: string
}

type WorkflowStatusDefinition = {
  id: string
  projectPath: string
  name: string
  description: string
}

type WorkflowStatusFilter = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  statusId: string
}

type WorkflowStop = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
}

type WorkflowTimer = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  task: string
  schedule: 'once' | 'interval'
  startAt: string
  intervalValue: number
  intervalUnit: 'minutes' | 'hours' | 'days' | 'weeks' | 'time'
  recurring?: boolean
  enabled: boolean
  nextRunAt: string
  lastRunAt: string
}

type WorkflowDelivery = {
  route: WorkflowRoute
  target?: Agent
  stop?: WorkflowStop
}

type WorkflowNodeData = {
  label: string
  kind: 'agent' | 'prompt' | 'initial' | 'status' | 'stop' | 'timer'
  status?: AgentStatus
  kindLabel?: string
}

function chatMessageIdentity(message: ChatMessage, agentName: string, language: UiLanguage) {
  if (message.role === 'assistant') {
    return {
      name: agentName,
      label: message.phase !== 'final_answer'
        ? language === 'de' ? 'Zwischenstand' : 'Progress'
        : language === 'de' ? 'Antwort' : 'Answer',
    }
  }

  const handoff = message.text.match(/^Übergabe von (.+?) an (.+?)(?:\r?\n|$)/)
  if (handoff) {
    return {
      name: handoff[1],
      label: `${language === 'de' ? 'Übergabe an' : 'Handoff to'} ${handoff[2]}`,
    }
  }

  const initial = message.text.match(/^Initial-Anfrage von (.+?)(?:\r?\n|$)/)
  if (initial) {
    return {
      name: initial[1],
      label: language === 'de' ? 'Initial-Anfrage' : 'Initial request',
    }
  }

  return { name: 'Orchestrator', label: language === 'de' ? 'Eingang' : 'Input' }
}

function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const isInitial = data.kind === 'initial'
  const isStop = data.kind === 'stop'
  const isTimer = data.kind === 'timer'
  return (
    <div className={`workflowNodeContent ${data.kind}`}>
      {!isInitial && !isTimer && <Handle id="input" type="target" position={Position.Left} />}
      {!isInitial && !isTimer && <span className="portLabel input">In</span>}
      <strong>{data.label}</strong>
      <span className="nodeKind">{data.kindLabel ?? data.kind}</span>
      {!isStop && <span className="portLabel output">Out</span>}
      {!isStop && <Handle id="output" type="source" position={Position.Right} />}
    </div>
  )
}

const workflowNodeTypes = { workflow: WorkflowNode }

const STORAGE_KEY = 'codex-workflow-orchestrator'
const LANGUAGE_STORAGE_KEY = 'codex-workflow-orchestrator-language'
const PROMPT_NODES_ENABLED = false

const languageCopy: Record<UiLanguage, {
  week: string
  free: string
  unlimited: string
  credit: string
  start: string
  stop: string
  projects: string
  project: string
  manageChats: string
  noChats: string
  online: string
  offline: string
  liveSync: string
}> = {
  de: {
    week: 'Woche',
    free: '% frei',
    unlimited: 'Guthaben unbegrenzt',
    credit: 'Guthaben',
    start: 'Auto Start',
    stop: 'Auto Stop',
    projects: 'Codex Projekte und Tasks',
    project: 'Projekt',
    manageChats: 'Agenten-Übersicht',
    noChats: 'Für dieses Projekt wurden keine Chats gefunden.',
    online: 'Codex-Connector verbunden',
    offline: 'Codex-Connector offline',
    liveSync: 'Keine Live-Synchronisierung',
  },
  en: {
    week: 'Week',
    free: '% free',
    unlimited: 'Unlimited credits',
    credit: 'Credits',
    start: 'Auto Start',
    stop: 'Auto Stop',
    projects: 'Codex projects and tasks',
    project: 'Project',
    manageChats: 'Agent overview',
    noChats: 'No chats were found for this project.',
    online: 'Codex Connector connected',
    offline: 'Codex Connector offline',
    liveSync: 'No live synchronization',
  },
}

const initialCodexProjects: CodexProject[] = []

const initialCodexThreads: CodexThread[] = []

const statusLabels: Record<UiLanguage, Record<AgentStatus, string>> = {
  de: { wartet: 'Warten', laeuft: 'Läuft', fertig: 'Fertig', rueckfrage: 'Rückfrage', weitergegeben: 'Weitergegeben' },
  en: { wartet: 'Waiting', laeuft: 'Running', fertig: 'Finished', rueckfrage: 'Question', weitergegeben: 'Forwarded' },
}

const eventTitleTranslations: Record<string, string> = {
  'Agent und Codex-Chat erstellt': 'Agent and Codex chat created',
  'Agent aus Dashboard entfernt': 'Agent removed from dashboard',
  'Agent gelöscht': 'Agent deleted',
  'Automatik gestartet': 'Automation started',
  'Automatik gestoppt': 'Automation stopped',
  'Automatik ohne Initial gestartet': 'Automation started without initial node',
  'Aufgabe weitergegeben': 'Task forwarded',
  'Chat-Nachricht gesendet': 'Chat message sent',
  'Codex Task ausgeblendet': 'Codex task hidden',
  'Codex Task bereits verlinkt': 'Codex task already linked',
  'Codex Task übernommen': 'Codex task imported',
  'Codex-Ergebnis empfangen': 'Codex result received',
  'Codex-Task umbenannt': 'Codex task renamed',
  'Ergebnisabfrage fehlgeschlagen': 'Result query failed',
  'Identische Aufgabe nicht weitergegeben': 'Duplicate task not forwarded',
  'Initial-Anfrage gesendet': 'Initial request sent',
  'Keine Status-Weitergabe': 'No status forwarding',
  'Agentenüberwachung ausgeführt': 'Agent monitoring executed',
  'Agentenüberwachung fehlgeschlagen': 'Agent monitoring failed',
  'Team-Vorschlag übernommen': 'Team proposal applied',
  'Team-Aufbau fehlgeschlagen': 'Team creation failed',
  'Prompt an Codex übergeben': 'Prompt sent to Codex',
  'Prompt nicht gesendet': 'Prompt not sent',
  'Prompt nicht gespeichert': 'Prompt not saved',
  'Prompt-Datei nicht erstellt': 'Prompt file not created',
  'Prompt-Datei nicht umbenannt': 'Prompt file not renamed',
  'Status-Filter erstellt': 'Status filter created',
  'Status-Filter nicht erstellt': 'Status filter not created',
  'Stopp-Baustein erstellt': 'Stop node created',
  'Weitergabe blockiert': 'Forwarding blocked',
  'Weitergabe gestoppt': 'Forwarding stopped',
  'Weitergabe nicht gesendet': 'Forwarding not sent',
  'Workflow-Pfad beendet': 'Workflow path ended',
  'Workflow-Status erstellt': 'Workflow status created',
  'Workflow-Status geändert': 'Workflow status changed',
  'Workflow-Status gelöscht': 'Workflow status deleted',
  'Workflow-Status nicht erstellt': 'Workflow status not created',
  'Workflow-Status nicht geändert': 'Workflow status not changed',
  'Workflow-Verbindung erstellt': 'Workflow connection created',
  'Zeitplan ausgeführt': 'Schedule executed',
  'Zeitplan erstellt': 'Schedule created',
  'Zeitplan fehlgeschlagen': 'Schedule failed',
  'Zeitplan ohne Ziel': 'Schedule has no target',
}

function eventTitleText(title: string, language: UiLanguage) {
  return language === 'en' ? eventTitleTranslations[title] ?? title : title
}

function eventDetailText(detail: string, language: UiLanguage) {
  if (language === 'de') return detail

  return detail
    .replace(/\bbleibt als Codex-Chat erhalten\./g, 'remains available as a Codex chat.')
    .replace(/\bbeendet an diesem Punkt\./g, 'ends at this point.')
    .replace(/\bist fertig\./g, 'is finished.')
    .replace(/\bist mit keinem Codex-Chat verknüpft\./g, 'is not linked to a Codex chat.')
    .replace(/\bhat keine Workflow-Verbindung\./g, 'has no workflow connection.')
    .replace(/Die Automatik ist ausgeschaltet\./g, 'Automation is disabled.')
    .replace(
      /Weitere fertige Ergebnisse werden nicht automatisch weitergegeben\./g,
      'Additional completed results will not be forwarded automatically.',
    )
    .replace(
      /Doppelklick auf den Baustein öffnet die Konfiguration\./g,
      'Double-click the node to open its configuration.',
    )
}

const defaultWorkflowStatuses = [
  { name: 'Weiterleitung', description: 'Das Ergebnis soll an den nächsten Agenten weitergegeben werden.' },
] as const

const initialAgents: Agent[] = []

function createDefaultPromptDocument(content = ''): PromptDocument {
  return {
    id: 'default',
    name: 'Anweisung',
    fileName: 'Anweisung.md',
    content,
    filePath: '',
    lastSentContent: null,
    updatedAt: new Date().toISOString(),
  }
}

function promptFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
  const baseName = cleaned || 'Neue Prompt-Datei'
  return baseName.toLocaleLowerCase('de-DE').endsWith('.md') ? baseName : `${baseName}.md`
}

function normalizeAgent(agent: Partial<Agent>): Agent {
  const legacyAgent = agent as Partial<Agent> & { handoffTo?: string }
  const legacyPrompt = agent.prompt ?? ''
  const normalizedStatus =
    agent.status === 'laeuft' && !agent.pendingTurnId ? 'wartet' : agent.status ?? 'wartet'
  const promptDocuments = Array.isArray(agent.promptDocuments) && agent.promptDocuments.length > 0
    ? agent.promptDocuments.map((document) => ({
        id: document.id || crypto.randomUUID(),
        name: document.name || 'Anweisung',
        fileName: promptFileName(document.fileName || document.name || 'Anweisung'),
        content: document.content ?? '',
        filePath: document.filePath ?? '',
        lastSentContent: typeof document.lastSentContent === 'string' ? document.lastSentContent : null,
        updatedAt: document.updatedAt ?? new Date().toISOString(),
      }))
    : [createDefaultPromptDocument(legacyPrompt)]
  const activePromptDocumentId = promptDocuments.some(
    (document) => document.id === agent.activePromptDocumentId,
  )
    ? agent.activePromptDocumentId as string
    : promptDocuments[0].id
  const activePrompt = promptDocuments.find((document) => document.id === activePromptDocumentId)

  return {
    id: agent.id ?? crypto.randomUUID(),
    name: agent.name ?? 'Agent',
    role: agent.role ?? 'Rolle definieren',
    projectId: agent.projectId ?? '',
    projectPath: agent.projectPath ?? '',
    threadTitle: agent.threadTitle ?? '',
    threadId: agent.threadId ?? '',
    model: agent.model ?? '',
    prompt: activePrompt?.content ?? legacyPrompt,
    promptDocuments,
    activePromptDocumentId,
    status: normalizedStatus,
    talkTo: Array.isArray(agent.talkTo)
      ? agent.talkTo
      : legacyAgent.handoffTo
        ? [legacyAgent.handoffTo]
        : [],
    autoForward: agent.autoForward ?? true,
    assignment: agent.assignment === 'management' ? 'management' : 'agent',
    monitoredAgentIds: Array.isArray(agent.monitoredAgentIds)
      ? Array.from(new Set(agent.monitoredAgentIds.filter((id): id is string => typeof id === 'string')))
      : [],
    monitoringEnabled: agent.monitoringEnabled === true,
    monitoringIntervalMinutes: Math.max(1, Math.round(agent.monitoringIntervalMinutes ?? 30)),
    lastMonitoringAt: agent.lastMonitoringAt ?? '',
    teamProvisioningEnabled: agent.teamProvisioningEnabled === true,
    lastAppliedTeamPlanSignature: agent.lastAppliedTeamPlanSignature ?? '',
    workflowStatusIds: Array.isArray(agent.workflowStatusIds)
      ? Array.from(new Set(agent.workflowStatusIds.filter((id): id is string => typeof id === 'string')))
      : null,
    workflowStatusUpdatedAt: agent.workflowStatusUpdatedAt ?? '',
    finishSignal: agent.finishSignal ?? '"status":"fertig"',
    lastResult: agent.lastResult ?? '',
    instructionVersion: agent.instructionVersion ?? 1,
    lastInstruction: agent.lastInstruction ?? '',
    runStartedAt: agent.runStartedAt ?? '',
    lastDurationMs: agent.lastDurationMs ?? 0,
    completedRuns: agent.completedRuns ?? 0,
    pendingTurnId: agent.pendingTurnId ?? '',
    lastCompletedTurnId: agent.lastCompletedTurnId ?? '',
    updatedAt: agent.updatedAt ?? new Date().toISOString(),
  }
}

function deduplicateAgents(agents: Agent[]) {
  const linkedThreadIds = new Set(agents.filter((agent) => agent.threadId).map((agent) => agent.threadId))
  const seenThreadIds = new Set<string>()

  return agents.filter((agent) => {
    if (agent.threadId) {
      if (seenThreadIds.has(agent.threadId)) {
        return false
      }
      seenThreadIds.add(agent.threadId)
      return true
    }

    return !agents.some(
      (linkedAgent) =>
        linkedAgent.threadId &&
        linkedThreadIds.has(linkedAgent.threadId) &&
        linkedAgent.projectPath === agent.projectPath &&
        linkedAgent.name.trim().toLocaleLowerCase('de-DE') ===
          agent.name.trim().toLocaleLowerCase('de-DE'),
    )
  })
}

function loadStoredState() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    return {
      agents: initialAgents,
      events: [] as EventLog[],
      hiddenThreadIds: [] as string[],
      routes: [] as WorkflowRoute[],
      workflowPrompts: [] as WorkflowPrompt[],
      workflowInitials: [] as WorkflowInitial[],
      workflowStatuses: [] as WorkflowStatusDefinition[],
      workflowStatusFilters: [] as WorkflowStatusFilter[],
      workflowStops: [] as WorkflowStop[],
      workflowTimers: [] as WorkflowTimer[],
      workflowPositions: {} as Record<string, { x: number; y: number }>,
      hiddenWorkflowAgentIds: [] as string[],
      workflowBoardAgentIds: {} as Record<string, string[]>,
      selectedProjectId: '',
      autoRun: false,
    }
  }

  try {
    const parsed = JSON.parse(stored)
    return {
      agents: Array.isArray(parsed.agents)
        ? deduplicateAgents(parsed.agents.map(normalizeAgent))
        : initialAgents,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      hiddenThreadIds: Array.isArray(parsed.hiddenThreadIds) ? parsed.hiddenThreadIds : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      workflowPrompts: Array.isArray(parsed.workflowPrompts) ? parsed.workflowPrompts : [],
      workflowInitials: Array.isArray(parsed.workflowInitials) ? parsed.workflowInitials : [],
      workflowStatuses: Array.isArray(parsed.workflowStatuses) ? parsed.workflowStatuses : [],
      workflowStatusFilters: Array.isArray(parsed.workflowStatusFilters) ? parsed.workflowStatusFilters : [],
      workflowStops: Array.isArray(parsed.workflowStops) ? parsed.workflowStops : [],
      workflowTimers: Array.isArray(parsed.workflowTimers) ? parsed.workflowTimers : [],
      workflowPositions:
        parsed.workflowPositions && typeof parsed.workflowPositions === 'object'
          ? parsed.workflowPositions
          : {},
      hiddenWorkflowAgentIds: Array.isArray(parsed.hiddenWorkflowAgentIds)
        ? parsed.hiddenWorkflowAgentIds
        : [],
      workflowBoardAgentIds:
        parsed.workflowBoardAgentIds && typeof parsed.workflowBoardAgentIds === 'object'
          ? parsed.workflowBoardAgentIds
          : {},
      selectedProjectId:
        typeof parsed.selectedProjectId === 'string' ? parsed.selectedProjectId : '',
      autoRun: parsed.autoRun === true,
    }
  } catch {
    return {
      agents: initialAgents,
      events: [] as EventLog[],
      hiddenThreadIds: [] as string[],
      routes: [] as WorkflowRoute[],
      workflowPrompts: [] as WorkflowPrompt[],
      workflowInitials: [] as WorkflowInitial[],
      workflowStatuses: [] as WorkflowStatusDefinition[],
      workflowStatusFilters: [] as WorkflowStatusFilter[],
      workflowStops: [] as WorkflowStop[],
      workflowTimers: [] as WorkflowTimer[],
      workflowPositions: {} as Record<string, { x: number; y: number }>,
      hiddenWorkflowAgentIds: [] as string[],
      workflowBoardAgentIds: {} as Record<string, string[]>,
      selectedProjectId: '',
      autoRun: false,
    }
  }
}

function nowLabel() {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
}

function defaultTimerStart() {
  const date = new Date(Date.now() + 5 * 60_000)
  date.setSeconds(0, 0)
  return date.toISOString()
}

function toDateTimeLocal(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function toTimeInput(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function fromTimeInput(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ''
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function timerIntervalMs(timer: WorkflowTimer) {
  const factors = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
    time: 86_400_000,
  }
  return Math.max(1, timer.intervalValue || 1) * factors[timer.intervalUnit]
}

function nextTimerRun(timer: WorkflowTimer, after = Date.now()) {
  if (timer.schedule === 'once') return ''
  if (timer.intervalUnit === 'time') {
    const configuredStart = new Date(timer.startAt)
    const next = new Date(after)
    if (!Number.isFinite(configuredStart.getTime())) return ''
    next.setHours(configuredStart.getHours(), configuredStart.getMinutes(), 0, 0)
    if (next.getTime() <= after) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  const step = timerIntervalMs(timer)
  const configuredStart = new Date(timer.startAt).getTime()
  if (!Number.isFinite(configuredStart)) return new Date(after + step).toISOString()
  if (configuredStart > after) return new Date(configuredStart).toISOString()
  const elapsedSteps = Math.floor((after - configuredStart) / step) + 1
  return new Date(configuredStart + elapsedSteps * step).toISOString()
}

function samePath(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function managementInstruction(agent: Agent, monitoredAgents: Agent[]) {
  if (agent.assignment !== 'management') return ''

  return [
    'Verwaltungs-Erweiterung:',
    'Du bist als Verwaltungsagent eingestuft. Du koordinierst und überwachst die dir zugewiesenen Agenten, ohne deren Facharbeit selbst zu übernehmen.',
    monitoredAgents.length > 0
      ? `Zugewiesene Agenten: ${monitoredAgents.map((item) => `${item.name} (${item.role})`).join(', ')}`
      : 'Es sind aktuell keine Agenten zur Überwachung zugewiesen.',
    'Bei einer Überwachungsanfrage bewertest du Fortschritt, Blockaden, widersprüchliche Ergebnisse und den sinnvollsten nächsten Schritt.',
    'Du darfst Aufgaben und Rollen vorschlagen. Technische Änderungen an Agenten, Prompts und Verdrahtungen führt weiterhin ausschließlich der Workflow-Orchestrator aus.',
    agent.teamProvisioningEnabled ? managementTeamPlanInstruction() : '',
  ].join('\n')
}

function managementTeamPlanInstruction() {
  return [
    '',
    'Kontrollierter Team-Aufbau:',
    'Wenn der Benutzer ausdrücklich verlangt, ein Team zusammenzustellen, liefere zusätzlich genau einen maschinenlesbaren Vorschlag in diesem Format:',
    '<orchestrator_team_plan>',
    '{',
    '  "projectGoal": "Kurze Zielbeschreibung",',
    '  "agents": [',
    '    { "name": "Agentenname", "role": "Klare Rolle", "prompt": "Vollständige Arbeitsanweisung", "workflowStatuses": ["Weiterleitung"] }',
    '  ],',
    '  "connections": [',
    '    { "from": "Agentenname", "to": "Anderer Agent" }',
    '  ]',
    '}',
    '</orchestrator_team_plan>',
    'Verwende nur gültiges JSON. Erfinde keine Projektpfade. Der Orchestrator prüft den Vorschlag und ein Benutzer muss ihn übernehmen.',
  ].join('\n')
}

function parseManagementTeamPlan(text: string): { plan: ManagementTeamPlan; signature: string } | null {
  const match = text.match(/<orchestrator_team_plan>\s*([\s\S]*?)\s*<\/orchestrator_team_plan>/i)
  if (!match) return null

  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>
    if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > 12) {
      return null
    }
    const agents = raw.agents.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('invalid agent')
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const role = typeof item.role === 'string' ? item.role.trim() : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
      if (!name || !role || !prompt || name.length > 80) throw new Error('invalid agent')
      return {
        name,
        role,
        prompt,
        workflowStatuses: Array.isArray(item.workflowStatuses)
          ? item.workflowStatuses.filter((status): status is string => typeof status === 'string').map((status) => status.trim()).filter(Boolean)
          : [],
      }
    })
    const normalizedNames = agents.map((agent) => agent.name.toLocaleLowerCase('de-DE'))
    if (new Set(normalizedNames).size !== normalizedNames.length) return null

    const connections = Array.isArray(raw.connections)
      ? raw.connections.map((entry) => {
          if (!entry || typeof entry !== 'object') throw new Error('invalid connection')
          const item = entry as Record<string, unknown>
          const from = typeof item.from === 'string' ? item.from.trim() : ''
          const to = typeof item.to === 'string' ? item.to.trim() : ''
          if (!from || !to || from === to) throw new Error('invalid connection')
          return { from, to }
        })
      : []
    const plan: ManagementTeamPlan = {
      projectGoal: typeof raw.projectGoal === 'string' ? raw.projectGoal.trim() : '',
      agents,
      connections,
    }
    return { plan, signature: JSON.stringify(plan) }
  } catch {
    return null
  }
}

function buildInstruction(
  agent: Agent,
  promptPath: string,
  statuses: WorkflowStatusDefinition[],
  monitoredAgents: Agent[],
) {
  return [
    `Rollen-Anweisung für: ${agent.name}`,
    `Rolle: ${agent.role}`,
    managementInstruction(agent, monitoredAgents),
    '',
    `Verbindliche Prompt-Datei: \`${promptPath}\``,
    'Lies diese Datei zu Beginn vollständig und verwende sie als aktuelle Arbeitsanweisung. Bei Konflikten hat diese Datei Vorrang.',
    '',
    workflowStatusInstruction(statuses),
  ].join('\n')
}

function buildHandoffMessage(
  source: Agent,
  target: Agent,
  route: WorkflowRoute,
  statuses: WorkflowStatusDefinition[],
) {
  return [
    `Übergabe von ${source.name} an ${target.name}`,
    '',
    `Workflow-Bedingung: ${route.condition || 'Immer'}`,
    '',
    'Übergabe-Anweisung:',
    route.prompt || 'Bearbeite das übergebene Ergebnis gemäß deiner Rolle.',
    '',
    'Rollenbezug des Ziel-Agenten:',
    target.role,
    '',
    'Ergebnis / Auftrag:',
    source.lastResult || 'Kein Ergebnistext hinterlegt.',
    '',
    'Bitte analysiere diesen Eingang gemäß deiner Rollen-Anweisung und liefere wieder das Abschlussformat.',
    workflowStatusInstruction(statuses),
  ].join('\n')
}

function taskSignature(result: string) {
  const trimmed = result.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const parsed = JSON.parse(trimmed) as { naechste_aufgabe?: unknown; next_task?: unknown }
    const nextTask =
      typeof parsed.naechste_aufgabe === 'string'
        ? parsed.naechste_aufgabe
        : typeof parsed.next_task === 'string'
          ? parsed.next_task
          : ''
    if (nextTask.trim()) {
      return nextTask.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')
    }
  } catch {
    // Nicht jedes Codex-Ergebnis ist im vereinbarten JSON-Abschlussformat.
  }

  return trimmed.replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')
}

function workflowStatusIdsFromResult(
  result: string,
  definitions: WorkflowStatusDefinition[],
) {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
  }
  const legacyNames = parsed
    ? [
        parsed.workflow_status,
        parsed.workflow_statuses,
        parsed.signale,
      ].flatMap((value) =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : typeof value === 'string'
            ? [value]
            : [],
      )
    : []
  const statusMarkers = Array.from(
    result.matchAll(/\[Workflow-Status:\s*([^\]\r\n]+)\]/gi),
    (match) => match[1].trim(),
  )
  const names = statusMarkers.length > 0 ? statusMarkers : legacyNames
  return definitions
    .filter((definition) =>
      names.some((name) => name.trim().toLocaleLowerCase('de-DE') === definition.name.trim().toLocaleLowerCase('de-DE')),
    )
    .map((definition) => definition.id)
}

function workflowStatusInstruction(statuses: WorkflowStatusDefinition[]) {
  return [
    'Workflow-Abschlussformat (verbindlich):',
    'Antworte zuerst normal und verständlich mit Zusammenfassung und nächstem Schritt. Verwende kein JSON.',
    '',
    'Setze als allerletzte Zeile genau einen Workflow-Status im Format [Workflow-Status: STATUSNAME].',
    'Der Status ist das einzige Signal für die Workflow-Weiterleitung. Die Oberfläche zeigt den Abschluss eines Codex-Turns separat als „Fertig“ an.',
    'Verwende ausschließlich exakte Statusnamen aus dieser Projektliste:',
    ...(statuses.length > 0
      ? statuses.map((status) => `- ${status.name}: ${status.description || 'Keine Beschreibung'}`)
      : ['- Keine Status definiert: verwende [Workflow-Status: Kein Status].']),
    '',
    'Wenn kein Status zutrifft, verwende [Workflow-Status: Kein Status]. Erfinde keine Statusnamen.',
  ].join('\n')
}

function workflowStatusesForAgent(agent: Agent, statuses: WorkflowStatusDefinition[]) {
  const projectStatuses = statuses.filter((status) => samePath(status.projectPath, agent.projectPath))
  const selectedStatusIds = agent.workflowStatusIds
  return selectedStatusIds === null
    ? projectStatuses
    : projectStatuses.filter((status) => selectedStatusIds.includes(status.id))
}

function buildMonitoringMessage(
  manager: Agent,
  monitoredAgents: Agent[],
  statuses: WorkflowStatusDefinition[],
) {
  const snapshots = monitoredAgents.map((agent) => [
    `Agent: ${agent.name}`,
    `Rolle: ${agent.role}`,
    `Laufstatus: ${agent.status}`,
    `Abgeschlossene Läufe: ${agent.completedRuns}`,
    'Letztes Ergebnis:',
    agent.lastResult.trim().slice(-2400) || 'Noch kein Ergebnis vorhanden.',
  ].join('\n'))

  return [
    `Agentenüberwachung durch ${manager.name}`,
    '',
    'Prüfe den aktuellen Stand der dir zugewiesenen Agenten. Erkenne Blockaden, widersprüchliche Ergebnisse, unnötige Wiederholungen und fehlende nächste Schritte.',
    'Fasse anschließend knapp zusammen, ob eingegriffen werden muss und welche konkrete Aufgabe als Nächstes sinnvoll ist.',
    '',
    snapshots.join('\n\n---\n\n'),
    '',
    workflowStatusInstruction(statuses),
  ].join('\n')
}

function routeConditionMatches(condition: string, result: string) {
  const normalized = condition.trim().toLocaleLowerCase('de-DE')
  return (
    normalized === '' ||
    normalized === 'immer' ||
    result.toLocaleLowerCase('de-DE').includes(normalized)
  )
}

function formatDuration(durationMs: number, language: UiLanguage) {
  if (durationMs <= 0) {
    return language === 'de' ? 'Keine Messung' : 'No measurement'
  }
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))} ${language === 'de' ? 'Sek.' : 'sec.'}`
  }
  return `${(durationMs / 60_000).toFixed(1)} min.`
}

function CollapsibleText({
  text,
  limit,
  monospace = false,
  language,
}: {
  text: string
  limit: number
  monospace?: boolean
  language: UiLanguage
}) {
  const className = monospace ? 'collapsibleText monospace' : 'collapsibleText'
  if (text.length <= limit) {
    return monospace ? <pre className="graph">{text}</pre> : <p>{text}</p>
  }

  const preview = `${text.slice(0, limit).trimEnd()}…`
  return (
    <details className={className}>
      <summary>
        <span className="showMore">{language === 'de' ? 'Mehr anzeigen' : 'Show more'}</span>
        <span className="showLess">{language === 'de' ? 'Weniger anzeigen' : 'Show less'}</span>
      </summary>
      {monospace ? <pre>{text}</pre> : <p>{text}</p>}
      {monospace ? <pre className="collapsedPreview">{preview}</pre> : <p className="collapsedPreview">{preview}</p>}
    </details>
  )
}

function WorkflowDashboard({
  agents,
  prompts,
  initials,
  statusFilters,
  stops,
  timers,
  statuses,
  positions,
  dashboardId,
  layoutRevision,
  autoRun,
  routes,
  selectedRouteId,
  onConnectAgents,
  onSelectRoute,
  onSelectPrompt,
  onSelectAgent,
  onSelectInitial,
  onSelectStatusFilter,
  onSelectStop,
  onSelectTimer,
  onNodePositionChange,
  onAgentDrop,
  draggedAgentId,
  selectedAgentNodeId,
  language,
}: {
  agents: Agent[]
  prompts: WorkflowPrompt[]
  initials: WorkflowInitial[]
  statusFilters: WorkflowStatusFilter[]
  stops: WorkflowStop[]
  timers: WorkflowTimer[]
  statuses: WorkflowStatusDefinition[]
  positions: Record<string, { x: number; y: number }>
  dashboardId: string
  layoutRevision: number
  autoRun: boolean
  routes: WorkflowRoute[]
  selectedRouteId: string
  onConnectAgents: (connection: Connection) => void
  onSelectRoute: (routeId: string) => void
  onSelectPrompt: (promptId: string) => void
  onSelectAgent: (agentId: string) => void
  onSelectInitial: (initialId: string) => void
  onSelectStatusFilter: (filterId: string) => void
  onSelectStop: (stopId: string) => void
  onSelectTimer: (timerId: string) => void
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void
  onAgentDrop: (agentId: string, position: { x: number; y: number }) => void
  draggedAgentId: string
  selectedAgentNodeId: string
  language: UiLanguage
}) {
  const initialNodes = useMemo<Node[]>(
    () =>
      [
        ...agents.map((agent, index) => ({
          id: agent.id,
          type: 'workflow',
          position: positions[agent.id] ?? { x: 70 + (index % 3) * 220, y: 70 + Math.floor(index / 3) * 150 },
          data: { label: agent.name, kind: 'agent' as const, status: agent.status, kindLabel: 'Agent' },
          className: `workflowNode agent ${agent.status} ${agent.id === selectedAgentNodeId ? 'nodeSelected' : ''}`,
        })),
        ...prompts.map((prompt, index) => ({
          id: prompt.id,
          type: 'workflow',
          position: positions[prompt.id] ?? { x: 180 + (index % 3) * 220, y: 250 + Math.floor(index / 3) * 150 },
          data: { label: prompt.name, kind: 'prompt' as const, kindLabel: language === 'de' ? 'Prompt / Bedingung' : 'Prompt / condition' },
          className: 'workflowNode prompt',
        })),
        ...initials.map((initial, index) => ({
          id: initial.id,
          type: 'workflow',
          position: positions[initial.id] ?? { x: 40, y: 70 + index * 130 },
          data: { label: initial.name, kind: 'initial' as const, kindLabel: language === 'de' ? 'Start' : 'Start' },
          className: 'workflowNode initial',
        })),
        ...statusFilters.map((filter, index) => {
          const status = statuses.find((item) => item.id === filter.statusId)
          return {
            id: filter.id,
            type: 'workflow',
            position: positions[filter.id] ?? { x: 260 + (index % 3) * 220, y: 430 + Math.floor(index / 3) * 130 },
            data: { label: status?.name || filter.name, kind: 'status' as const, kindLabel: language === 'de' ? 'Status-Filter' : 'Status filter' },
            className: 'workflowNode statusFilter',
          }
        }),
        ...stops.map((stop, index) => ({
          id: stop.id,
          type: 'workflow',
          position: positions[stop.id] ?? { x: 700, y: 120 + index * 130 },
          data: { label: stop.name, kind: 'stop' as const, kindLabel: language === 'de' ? 'Pfad beenden' : 'End path' },
          className: 'workflowNode stop',
        })),
        ...timers.map((timer, index) => ({
          id: timer.id,
          type: 'workflow',
          position: positions[timer.id] ?? { x: 40, y: 240 + index * 130 },
          data: { label: timer.name, kind: 'timer' as const, kindLabel: language === 'de' ? 'Zeitsteuerung' : 'Schedule' },
          className: `workflowNode timer ${timer.enabled ? 'enabled' : 'disabled'}`,
        })),
      ],
    [agents, initials, language, positions, prompts, selectedAgentNodeId, statusFilters, statuses, stops, timers],
  )
  const initialEdges = useMemo<Edge[]>(
    () =>
      routes.map((route) => ({
        id: route.id,
        source: route.sourceId,
        target: route.targetId,
        animated: autoRun,
        className: route.id === selectedRouteId ? 'selectedRoute' : '',
      })),
    [autoRun, routes, selectedRouteId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [agentDragOver, setAgentDragOver] = useState(false)
  const initialNodesRef = useRef(initialNodes)
  const isNodeDraggingRef = useRef(false)
  const previousDashboardIdRef = useRef(dashboardId)
  const nodeSignature = initialNodes.map((node) => node.id).sort().join(':')

  useEffect(() => {
    initialNodesRef.current = initialNodes
    if (isNodeDraggingRef.current) {
      return
    }
    const dashboardChanged = previousDashboardIdRef.current !== dashboardId
    setNodes((current) => {
      const currentPositions = new Map(current.map((node) => [node.id, node.position]))
      return initialNodes.map((node) => ({
        ...node,
        position: dashboardChanged
          ? node.position
          : currentPositions.get(node.id) ?? node.position,
      }))
    })
    previousDashboardIdRef.current = dashboardId
  }, [dashboardId, initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  useEffect(() => {
    if (layoutRevision > 0 && flowInstance) {
      setNodes(initialNodesRef.current)
      window.setTimeout(() => void flowInstance.fitView({ padding: 0.22, duration: 220 }), 0)
    }
  }, [flowInstance, layoutRevision, setNodes])

  useEffect(() => {
    if (!flowInstance || !nodeSignature) {
      return
    }
    const timer = window.setTimeout(() => {
      void flowInstance.fitView({ padding: 0.22, duration: 180 })
    }, 40)
    return () => window.clearTimeout(timer)
  }, [dashboardId, flowInstance, nodeSignature])

  return (
    <div
      className={`workflowCanvas ${agentDragOver ? 'agentDragOver' : ''}`}
      onDragEnter={(event) => {
        if (draggedAgentId || event.dataTransfer.types.includes('application/x-codex-agent')) {
          setAgentDragOver(true)
        }
      }}
      onDragOver={(event) => {
        if (!draggedAgentId && !event.dataTransfer.types.includes('application/x-codex-agent')) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setAgentDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Element) || !event.currentTarget.contains(event.relatedTarget)) {
          setAgentDragOver(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setAgentDragOver(false)
        const agentId =
          event.dataTransfer.getData('application/x-codex-agent') ||
          draggedAgentId ||
          event.dataTransfer.getData('text/plain')
        if (!agentId || !flowInstance) {
          return
        }
        onAgentDrop(
          agentId,
          flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        )
      }}
    >
      <ReactFlow
        nodeTypes={workflowNodeTypes}
        onInit={setFlowInstance}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectAgents}
        onEdgeDoubleClick={(_, edge) => onSelectRoute(edge.id)}
        onNodeDoubleClick={(_, node) => {
          if (prompts.some((prompt) => prompt.id === node.id)) {
            onSelectPrompt(node.id)
          } else if (initials.some((initial) => initial.id === node.id)) {
            onSelectInitial(node.id)
          } else if (statusFilters.some((filter) => filter.id === node.id)) {
            onSelectStatusFilter(node.id)
          } else if (stops.some((stop) => stop.id === node.id)) {
            onSelectStop(node.id)
          } else if (timers.some((timer) => timer.id === node.id)) {
            onSelectTimer(node.id)
          } else if (agents.some((agent) => agent.id === node.id)) {
            onSelectAgent(node.id)
          }
        }}
        onNodeDragStart={() => {
          isNodeDraggingRef.current = true
        }}
        onNodeDragStop={(_, node) => {
          isNodeDraggingRef.current = false
          onNodePositionChange(node.id, node.position)
        }}
        connectionRadius={18}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        nodeDragThreshold={1}
        snapToGrid={false}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function App() {
  const [storedState] = useState(loadStoredState)
  const [agents, setAgents] = useState<Agent[]>(storedState.agents)
  const [events, setEvents] = useState<EventLog[]>(storedState.events)
  const [codexProjects, setCodexProjects] = useState<CodexProject[]>(initialCodexProjects)
  const [codexThreads, setCodexThreads] = useState<CodexThread[]>(initialCodexThreads)
  const [connectorOnline, setConnectorOnline] = useState(false)
  const [language, setLanguage] = useState<UiLanguage>(() => {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return storedLanguage === 'en' ? 'en' : 'de'
  })
  const [lastSyncedAt, setLastSyncedAt] = useState('')
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? '')
  const [draggedAgentId, setDraggedAgentId] = useState('')
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [dropEdge, setDropEdge] = useState<'start' | 'end' | null>(null)
  const [deletingAgentId, setDeletingAgentId] = useState('')
  const [agentCreationOpen, setAgentCreationOpen] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [agentCreationBusy, setAgentCreationBusy] = useState(false)
  const [agentCreationError, setAgentCreationError] = useState('')
  const [teamPlanApplying, setTeamPlanApplying] = useState(false)
  const [teamPlanError, setTeamPlanError] = useState('')
  const [autoRun, setAutoRun] = useState(storedState.autoRun)
  const [projectFilter, setProjectFilter] = useState(storedState.selectedProjectId)
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>(storedState.hiddenThreadIds)
  const [routes, setRoutes] = useState<WorkflowRoute[]>(storedState.routes)
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPrompt[]>(storedState.workflowPrompts)
  const [workflowInitials, setWorkflowInitials] = useState<WorkflowInitial[]>(storedState.workflowInitials)
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatusDefinition[]>(storedState.workflowStatuses)
  const [workflowStatusFilters, setWorkflowStatusFilters] = useState<WorkflowStatusFilter[]>(
    storedState.workflowStatusFilters,
  )
  const [workflowStops, setWorkflowStops] = useState<WorkflowStop[]>(storedState.workflowStops)
  const [workflowTimers, setWorkflowTimers] = useState<WorkflowTimer[]>(storedState.workflowTimers)
  const [workflowPositions, setWorkflowPositions] = useState<Record<string, { x: number; y: number }>>(
    storedState.workflowPositions,
  )
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [selectedInitialId, setSelectedInitialId] = useState('')
  const [selectedStatusFilterId, setSelectedStatusFilterId] = useState('')
  const [selectedStopId, setSelectedStopId] = useState('')
  const [selectedTimerId, setSelectedTimerId] = useState('')
  const [newWorkflowStatusName, setNewWorkflowStatusName] = useState('')
  const [newWorkflowStatusDescription, setNewWorkflowStatusDescription] = useState('')
  const [statusLibraryOpen, setStatusLibraryOpen] = useState(false)
  const [editingWorkflowStatusId, setEditingWorkflowStatusId] = useState('')
  const [editingWorkflowStatusName, setEditingWorkflowStatusName] = useState('')
  const [editingWorkflowStatusDescription, setEditingWorkflowStatusDescription] = useState('')
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState('')
  const [workflowBoardAgentIds, setWorkflowBoardAgentIds] = useState<Record<string, string[]>>(
    storedState.workflowBoardAgentIds,
  )
  const [eventLogCollapsed, setEventLogCollapsed] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [promptCreationOpen, setPromptCreationOpen] = useState(false)
  const [newPromptName, setNewPromptName] = useState('')
  const [promptRenameOpen, setPromptRenameOpen] = useState(false)
  const [renamedPromptName, setRenamedPromptName] = useState('')
  const [pendingPromptDeliveryAgentId, setPendingPromptDeliveryAgentId] = useState('')
  const [transmittingAgentIds, setTransmittingAgentIds] = useState<string[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const copy = languageCopy[language]

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])
  const [chatError, setChatError] = useState('')
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [codexModels, setCodexModels] = useState<CodexModel[]>([])
  const [usageSummary, setUsageSummary] = useState<UsageSummary>({
    remainingPercent: null,
    resetsAt: null,
    credits: null,
    unlimited: false,
  })
  const [sharedStateReady, setSharedStateReady] = useState(false)
  const sharedStateVersion = useRef('')
  const sharedStateDirty = useRef(false)
  const autoRunRef = useRef(autoRun)
  const pollingTurnIds = useRef(new Set<string>())
  const terminalResultObservations = useRef(new Map<string, number>())
  const timerDispatchIds = useRef(new Set<string>())
  const managementDispatchIds = useRef(new Set<string>())
  const chatStreamRef = useRef<HTMLDivElement>(null)
  const tx = useCallback(
    (de: string, en: string) => language === 'de' ? de : en,
    [language],
  )

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      document.querySelectorAll<HTMLElement>('details.threadManager[open], details.dashboardTools[open], details.dashboardStatusMenu[open], details.promptStatusMenu[open]').forEach((menu) => {
        if (!menu.contains(target)) {
          menu.removeAttribute('open')
        }
      })
    }

    document.addEventListener('pointerdown', closeMenusOnOutsideClick, true)
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsideClick, true)
  }, [])

  useEffect(() => {
    autoRunRef.current = autoRun
  }, [autoRun])

  useEffect(() => {
    setAgents((current) => {
      let changed = false
      const normalized = current.map((agent) => {
        if (agent.status !== 'laeuft' || agent.pendingTurnId) {
          return agent
        }
        changed = true
        return {
          ...agent,
          status: 'wartet' as AgentStatus,
          runStartedAt: '',
          updatedAt: new Date().toISOString(),
        }
      })
      return changed ? normalized : current
    })
  }, [])

  useEffect(() => {
    const state = {
      agents,
      events,
      hiddenThreadIds,
      routes,
      workflowPrompts,
      workflowInitials,
      workflowStatuses,
      workflowStatusFilters,
      workflowStops,
      workflowTimers,
      workflowPositions,
      workflowBoardAgentIds,
      selectedProjectId: projectFilter,
      autoRun,
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state),
    )
    if (!sharedStateReady) {
      return
    }
    sharedStateDirty.current = true
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
        if (response.ok) {
          const data = await response.json()
          sharedStateVersion.current = data.updatedAt
          sharedStateDirty.current = false
        }
      } catch {
        // LocalStorage remains the offline fallback.
      }
    }, 450)
    return () => window.clearTimeout(timer)
  }, [agents, autoRun, events, hiddenThreadIds, projectFilter, routes, sharedStateReady, workflowBoardAgentIds, workflowInitials, workflowPositions, workflowPrompts, workflowStatusFilters, workflowStatuses, workflowStops, workflowTimers])

  const applySharedState = useCallback((state: ReturnType<typeof loadStoredState>) => {
    const incomingAgents = Array.isArray(state.agents)
      ? deduplicateAgents(state.agents.map(normalizeAgent))
      : []
    setAgents((current) => {
      const localAgents = new Map(current.map((agent) => [agent.id, agent]))
      return incomingAgents.map((incoming) => {
        const local = localAgents.get(incoming.id)
        if (
          local &&
          local.workflowStatusUpdatedAt > incoming.workflowStatusUpdatedAt
        ) {
          return {
            ...incoming,
            workflowStatusIds: local.workflowStatusIds,
            workflowStatusUpdatedAt: local.workflowStatusUpdatedAt,
          }
        }
        return incoming
      })
    })
    setEvents(Array.isArray(state.events) ? state.events : [])
    setHiddenThreadIds(Array.isArray(state.hiddenThreadIds) ? state.hiddenThreadIds : [])
    setRoutes(Array.isArray(state.routes) ? state.routes : [])
    setWorkflowPrompts(Array.isArray(state.workflowPrompts) ? state.workflowPrompts : [])
    setWorkflowInitials(Array.isArray(state.workflowInitials) ? state.workflowInitials : [])
    setWorkflowStatuses(Array.isArray(state.workflowStatuses) ? state.workflowStatuses : [])
    setWorkflowStatusFilters(Array.isArray(state.workflowStatusFilters) ? state.workflowStatusFilters : [])
    setWorkflowStops(Array.isArray(state.workflowStops) ? state.workflowStops : [])
    setWorkflowTimers(Array.isArray(state.workflowTimers) ? state.workflowTimers : [])
    setWorkflowPositions(state.workflowPositions ?? {})
    setWorkflowBoardAgentIds(state.workflowBoardAgentIds ?? {})
    setAutoRun(state.autoRun === true)
    if (state.selectedProjectId) {
      setProjectFilter(state.selectedProjectId)
    }
  }, [])

  useEffect(() => {
    let active = true
    const synchronize = async (initial = false) => {
      try {
        const response = await fetch('/api/state')
        if (!response.ok) {
          throw new Error('Gemeinsamer Zustand nicht erreichbar.')
        }
        const data = await response.json()
        if (
          active &&
          !sharedStateDirty.current &&
          data.state &&
          data.updatedAt &&
          data.updatedAt !== sharedStateVersion.current
        ) {
          sharedStateVersion.current = data.updatedAt
          applySharedState(data.state)
        }
      } catch {
        // The current browser state remains available while the connector is offline.
      } finally {
        if (initial && active) {
          setSharedStateReady(true)
        }
      }
    }
    void synchronize(true)
    const timer = window.setInterval(() => void synchronize(), 4000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [applySharedState])

  const selectedProject = codexProjects.find((project) => project.id === projectFilter)
  const selectedProjectPath = selectedProject?.path ?? ''

  useEffect(() => {
    if (!selectedProjectPath) {
      return
    }

    setWorkflowStatuses((current) => {
      const removedStatusIds = current
        .filter((status) =>
          samePath(status.projectPath, selectedProjectPath) &&
          status.name.trim().toLocaleLowerCase('de-DE') === 'fertig',
        )
        .map((status) => status.id)
      if (removedStatusIds.length > 0) {
        setWorkflowStatusFilters((filters) =>
          filters.filter((filter) => !removedStatusIds.includes(filter.statusId)),
        )
        setRoutes((currentRoutes) =>
          currentRoutes.filter(
            (route) => !removedStatusIds.includes(route.sourceId) && !removedStatusIds.includes(route.targetId),
          ),
        )
      }

      const withoutCompletionStatus = current.filter(
        (status) => !removedStatusIds.includes(status.id),
      )
      const existingNames = new Set(
        withoutCompletionStatus
          .filter((status) => samePath(status.projectPath, selectedProjectPath))
          .map((status) => status.name.trim().toLocaleLowerCase('de-DE')),
      )
      const missingDefaults = defaultWorkflowStatuses.filter(
        (status) => !existingNames.has(status.name.toLocaleLowerCase('de-DE')),
      )

      if (missingDefaults.length === 0) {
        return withoutCompletionStatus
      }

      return [
        ...withoutCompletionStatus,
        ...missingDefaults.map((status) => ({
          id: crypto.randomUUID(),
          projectPath: selectedProjectPath,
          name: status.name,
          description: status.description,
        })),
      ]
    })
  }, [selectedProjectPath])

  const visibleThreads = useMemo(
    () => codexThreads.filter((thread) => samePath(thread.cwd, selectedProject?.path ?? '')),
    [codexThreads, selectedProject?.path],
  )
  const projectAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          (agent.projectId === projectFilter ||
            samePath(agent.projectPath, selectedProject?.path ?? '')) &&
          (!agent.threadId || !hiddenThreadIds.includes(agent.threadId)),
      ),
    [agents, hiddenThreadIds, projectFilter, selectedProject?.path],
  )
  const selectedAgent = useMemo(
    () => projectAgents.find((agent) => agent.id === selectedId) ?? projectAgents[0],
    [projectAgents, selectedId],
  )
  const selectedTeamPlan = useMemo(
    () => selectedAgent?.assignment === 'management' && selectedAgent.teamProvisioningEnabled
      ? parseManagementTeamPlan(selectedAgent.lastResult)
      : null,
    [selectedAgent],
  )
  const selectedTeamPlanMalformed = Boolean(
    selectedAgent?.teamProvisioningEnabled &&
    /<orchestrator_team_plan>/i.test(selectedAgent.lastResult) &&
    !selectedTeamPlan,
  )
  const pendingPromptDeliveryAgent = useMemo(
    () => agents.find((agent) => agent.id === pendingPromptDeliveryAgentId),
    [agents, pendingPromptDeliveryAgentId],
  )
  const editingWorkflowStatus = useMemo(
    () => workflowStatuses.find((status) => status.id === editingWorkflowStatusId) ?? null,
    [editingWorkflowStatusId, workflowStatuses],
  )

  useEffect(() => {
    let active = true
    const threadId = selectedAgent?.threadId
    setChatPinnedToBottom(true)
    setChatDraft('')
    if (!threadId) {
      setChatMessages([])
      setChatError(tx('Dieser Agent ist mit keinem Codex-Chat verknüpft.', 'This agent is not linked to a Codex chat.'))
      return
    }

    const loadConversation = async () => {
      try {
        const response = await fetch(
          `/api/threads/${encodeURIComponent(threadId)}/conversation`,
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || tx('Chat konnte nicht gelesen werden.', 'The chat could not be loaded.'))
        }
        if (active) {
          setChatMessages(data.messages ?? [])
          setChatError('')
        }
      } catch (error) {
        if (active) {
          setChatError(
            error instanceof Error ? error.message : tx('Codex-Connector nicht erreichbar.', 'Codex connector is unavailable.'),
          )
        }
      }
    }

    void loadConversation()
    const timer = window.setInterval(() => void loadConversation(), 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedAgent?.threadId, tx])

  useEffect(() => {
    const stream = chatStreamRef.current
    if (stream && chatPinnedToBottom) {
      stream.scrollTop = stream.scrollHeight
    }
  }, [chatMessages, chatPinnedToBottom])

  const activeDashboardOwnerId = selectedAgent?.id ?? ''
  const projectWorkflowStatuses = workflowStatuses.filter((status) =>
    samePath(status.projectPath, selectedProject?.path ?? ''),
  )
  const projectStatusFilters = workflowStatusFilters.filter(
    (filter) =>
      filter.ownerAgentId === activeDashboardOwnerId &&
      samePath(filter.projectPath, selectedProject?.path ?? ''),
  )
  const projectStops = workflowStops.filter(
    (stop) =>
      stop.ownerAgentId === activeDashboardOwnerId &&
      samePath(stop.projectPath, selectedProject?.path ?? ''),
  )
  const projectTimers = workflowTimers.filter(
    (timer) =>
      timer.ownerAgentId === activeDashboardOwnerId &&
      samePath(timer.projectPath, selectedProject?.path ?? ''),
  )
  const projectRoutes = useMemo(
    () =>
      routes.filter(
        (route) =>
          (route.ownerAgentId || route.sourceId) === activeDashboardOwnerId &&
          samePath(route.projectPath, selectedProject?.path ?? '') &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters, ...projectStops, ...projectTimers].some((node) => node.id === route.sourceId) &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters, ...projectStops, ...projectTimers].some((node) => node.id === route.targetId),
      ),
    [activeDashboardOwnerId, projectAgents, projectStatusFilters, projectStops, projectTimers, routes, selectedProject?.path, workflowInitials, workflowPrompts],
  )
  const projectPrompts = workflowPrompts.filter(
    (prompt) =>
      prompt.ownerAgentId === activeDashboardOwnerId &&
      samePath(prompt.projectPath, selectedProject?.path ?? ''),
  )
  const dashboardPrompts = PROMPT_NODES_ENABLED ? projectPrompts : []
  const projectInitials = workflowInitials.filter(
    (initial) =>
      initial.ownerAgentId === activeDashboardOwnerId &&
      samePath(initial.projectPath, selectedProject?.path ?? ''),
  )
  const activeBoardAgentIds =
    workflowBoardAgentIds[activeDashboardOwnerId] ?? (activeDashboardOwnerId ? [activeDashboardOwnerId] : [])
  const dashboardAgents = projectAgents.filter(
    (agent) => activeBoardAgentIds.includes(agent.id),
  )
  const dashboardNodeIds = new Set([
    ...dashboardAgents.map((agent) => agent.id),
    ...dashboardPrompts.map((prompt) => prompt.id),
    ...projectInitials.map((initial) => initial.id),
    ...projectStatusFilters.map((filter) => filter.id),
    ...projectStops.map((stop) => stop.id),
    ...projectTimers.map((timer) => timer.id),
  ])
  const dashboardRoutes = projectRoutes.filter(
    (route) => dashboardNodeIds.has(route.sourceId) && dashboardNodeIds.has(route.targetId),
  )
  const dashboardPositions = Object.fromEntries(
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters, ...projectStops, ...projectTimers].map((node) => [
      node.id,
      workflowPositions[`${activeDashboardOwnerId}:${node.id}`],
    ]).filter((entry) => Boolean(entry[1])),
  ) as Record<string, { x: number; y: number }>
  const selectedRoute = projectRoutes.find((route) => route.id === selectedRouteId)
  const selectedPrompt = projectPrompts.find((prompt) => prompt.id === selectedPromptId)
  const selectedInitial = projectInitials.find((initial) => initial.id === selectedInitialId)
  const selectedStatusFilter = projectStatusFilters.find((filter) => filter.id === selectedStatusFilterId)
  const selectedStop = projectStops.find((stop) => stop.id === selectedStopId)
  const selectedTimer = projectTimers.find((timer) => timer.id === selectedTimerId)
  const selectedWorkflowAgent = projectAgents.find((agent) => agent.id === selectedWorkflowAgentId)
  const dashboardNodeLabel = (nodeId: string) =>
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters, ...projectStops, ...projectTimers].find(
      (node) => node.id === nodeId,
    )?.name ?? 'Unbekannter Baustein'

  useEffect(() => {
    if (selectedWorkflowAgentId && !projectAgents.some((agent) => agent.id === selectedWorkflowAgentId)) {
      setSelectedWorkflowAgentId('')
    }
  }, [projectAgents, selectedWorkflowAgentId])

  useEffect(() => {
    setRoutes((current) => {
      const existingPairs = new Set(current.map((route) => `${route.sourceId}:${route.targetId}`))
      const migrated = agents.flatMap((agent) =>
        agent.talkTo
          .filter((targetId) => !existingPairs.has(`${agent.id}:${targetId}`))
          .map((targetId): WorkflowRoute => ({
            id: crypto.randomUUID(),
            ownerAgentId: agent.id,
            projectPath: agent.projectPath,
            sourceId: agent.id,
            targetId,
            condition: 'Immer',
            prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.',
          })),
      )
      return migrated.length > 0 ? [...current, ...migrated] : current
    })
    if (agents.some((agent) => agent.talkTo.length > 0)) {
      setAgents((current) =>
        current.map((agent) => (agent.talkTo.length > 0 ? { ...agent, talkTo: [] } : agent)),
      )
    }
  }, [agents])

  useEffect(() => {
    setWorkflowPrompts((current) => {
      if (current.every((prompt) => prompt.ownerAgentId)) {
        return current
      }
      return current.map((prompt) => {
        if (prompt.ownerAgentId) {
          return prompt
        }
        const inbound = routes.find(
          (route) => route.targetId === prompt.id && agents.some((agent) => agent.id === route.sourceId),
        )
        return { ...prompt, ownerAgentId: inbound?.sourceId ?? activeDashboardOwnerId }
      })
    })
    setRoutes((current) => {
      if (current.every((route) => route.ownerAgentId)) {
        return current
      }
      return current.map((route) => {
        if (route.ownerAgentId) {
          return route
        }
        const directOwner = agents.some((agent) => agent.id === route.sourceId)
          ? route.sourceId
          : workflowPrompts.find((prompt) => prompt.id === route.sourceId)?.ownerAgentId
        return { ...route, ownerAgentId: directOwner ?? activeDashboardOwnerId }
      })
    })
  }, [activeDashboardOwnerId, agents, routes, workflowPrompts])

  useEffect(() => {
    if (!connectorOnline) {
      return
    }

    setAgents((current) => {
      let hasChanges = false
      let synchronized = deduplicateAgents(current)
      if (synchronized.length !== current.length) {
        hasChanges = true
      }

      const assignedThreadIds = new Set(
        synchronized
          .filter((agent) => agent.threadId && codexThreads.some((thread) => thread.id === agent.threadId))
          .map((agent) => agent.threadId),
      )

      synchronized = synchronized.flatMap((agent) => {
        if (agent.threadId && codexThreads.some((thread) => thread.id === agent.threadId)) {
          return [agent]
        }

        const replacement = codexThreads.find(
          (thread) =>
            !assignedThreadIds.has(thread.id) &&
            samePath(thread.cwd, agent.projectPath) &&
            [agent.name, agent.threadTitle].some(
              (name) =>
                name.trim().toLocaleLowerCase('de-DE') ===
                thread.title.trim().toLocaleLowerCase('de-DE'),
            ),
        )
        if (!replacement) {
          hasChanges = true
          return []
        }

        assignedThreadIds.add(replacement.id)
        hasChanges = true
        return [{
          ...agent,
          name: replacement.title,
          threadTitle: replacement.title,
          threadId: replacement.id,
          updatedAt: new Date().toISOString(),
        }]
      })

      synchronized = synchronized.map((agent) => {
        const thread = codexThreads.find((item) => item.id === agent.threadId)
        if (!thread) {
          return agent
        }

        const hasLocalNameEdit = agent.name !== agent.threadTitle
        const hasExternalNameChange = agent.threadTitle !== thread.title
        const nextStatus =
          agent.status === 'laeuft' && !agent.pendingTurnId ? 'wartet' : agent.status

        if (
          (!hasExternalNameChange || hasLocalNameEdit) &&
          nextStatus === agent.status
        ) {
          return agent
        }

        hasChanges = true
        return {
          ...agent,
          name: hasExternalNameChange && !hasLocalNameEdit ? thread.title : agent.name,
          threadTitle:
            hasExternalNameChange && !hasLocalNameEdit ? thread.title : agent.threadTitle,
          status: nextStatus as AgentStatus,
          updatedAt: new Date().toISOString(),
        }
      })

      const missingThreads = codexThreads.filter(
        (thread) => !synchronized.some((agent) => agent.threadId === thread.id),
      )

      const reconciled = [
        ...synchronized,
        ...missingThreads.map((thread): Agent => {
          const project = codexProjects.find((item) => samePath(item.path, thread.cwd))
          return {
          id: crypto.randomUUID(),
          name: thread.title,
          role: 'Rolle definieren',
          projectId: project?.id ?? `path:${thread.cwd}`,
          projectPath: thread.cwd,
          threadTitle: thread.title,
          threadId: thread.id,
          model: '',
          prompt: 'Definiere die Rollen-Anweisung für diesen Codex Task.',
          promptDocuments: [createDefaultPromptDocument('Definiere die Rollen-Anweisung für diesen Codex Task.')],
          activePromptDocumentId: 'default',
           status: 'wartet',
           talkTo: [],
           autoForward: true,
           assignment: 'agent',
           monitoredAgentIds: [],
           monitoringEnabled: false,
           monitoringIntervalMinutes: 30,
           lastMonitoringAt: '',
           teamProvisioningEnabled: false,
           lastAppliedTeamPlanSignature: '',
           workflowStatusIds: null,
           workflowStatusUpdatedAt: '',
           finishSignal: '"status":"fertig"',
          lastResult: '',
          instructionVersion: 1,
          lastInstruction: '',
          runStartedAt: '',
          lastDurationMs: 0,
          completedRuns: 0,
          pendingTurnId: '',
          lastCompletedTurnId: '',
          updatedAt: new Date().toISOString(),
          }
        }),
      ]

      const validAgentIds = new Set(reconciled.map((agent) => agent.id))
      const cleaned = reconciled.map((agent) => ({
        ...agent,
        talkTo: agent.talkTo.filter((targetId) => validAgentIds.has(targetId)),
      }))

      return hasChanges || missingThreads.length > 0 ? cleaned : current
    })
  }, [codexProjects, codexThreads, connectorOnline])

  const graphEdges = useMemo(
    () =>
      agents
        .map((agent) => {
          const targets = routes
            .filter((route) => route.sourceId === agent.id)
            .map((route) => agents.find((item) => item.id === route.targetId)?.name)
            .filter(Boolean)
          return targets.length > 0
            ? `${agent.name} -> ${targets.join(', ')}`
            : `${agent.name} -> ${tx('Ende', 'End')}`
        })
        .join('\n'),
    [agents, routes, tx],
  )

  const addEvent = useCallback((title: string, detail: string) => {
    setEvents((current) => [
      { id: crypto.randomUUID(), at: nowLabel(), title, detail },
      ...current.slice(0, 39),
    ])
  }, [])

  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
    // Block incoming shared-state snapshots until this local change is persisted.
    sharedStateDirty.current = true
    setAgents((current) =>
      current.map((agent) =>
        agent.id === id ? { ...agent, ...patch, updatedAt: new Date().toISOString() } : agent,
      ),
    )
  }, [])

  const setAgentTransmission = useCallback((agentId: string, active: boolean) => {
    setTransmittingAgentIds((current) =>
      active
        ? current.includes(agentId) ? current : [...current, agentId]
        : current.filter((id) => id !== agentId),
    )
  }, [])

  const isAgentBusy = (agent: Agent) =>
    autoRun && (
      (agent.status === 'laeuft' && Boolean(agent.pendingTurnId)) ||
      transmittingAgentIds.includes(agent.id)
    )

  const activePromptDocument = (agent: Agent) =>
    agent.promptDocuments.find((document) => document.id === agent.activePromptDocumentId) ??
    agent.promptDocuments[0]

  const selectPromptDocument = (agent: Agent, documentId: string) => {
    const document = agent.promptDocuments.find((item) => item.id === documentId)
    if (!document) {
      return
    }
    updateAgent(agent.id, {
      activePromptDocumentId: document.id,
      prompt: document.content,
    })
  }

  const setAgentWorkflowStatusEnabled = (agent: Agent, statusId: string, enabled: boolean) => {
    const availableStatuses = workflowStatuses.filter((status) => samePath(status.projectPath, agent.projectPath))
    const currentIds = agent.workflowStatusIds === null
      ? availableStatuses.map((status) => status.id)
      : agent.workflowStatusIds
    const nextIds = enabled
      ? Array.from(new Set([...currentIds, statusId]))
      : currentIds.filter((id) => id !== statusId)
    const allSelected = availableStatuses.length > 0 && availableStatuses.every((status) => nextIds.includes(status.id))

    updateAgent(agent.id, {
      workflowStatusIds: allSelected ? null : nextIds,
      workflowStatusUpdatedAt: new Date().toISOString(),
    })
  }

  const updatePromptDocument = (agent: Agent, documentId: string, content: string) => {
    const promptDocuments = agent.promptDocuments.map((document) =>
      document.id === documentId
        ? { ...document, content, updatedAt: new Date().toISOString() }
        : document,
    )
    updateAgent(agent.id, {
      promptDocuments,
      prompt: promptDocuments.find((document) => document.id === documentId)?.content ?? agent.prompt,
    })
  }

  const createPromptDocument = () => {
    if (!selectedAgent) {
      return
    }
    const name = newPromptName.trim()
    if (!name) {
      return
    }
    const fileName = promptFileName(name)
    const existingFileNames = new Set(
      selectedAgent.promptDocuments.map((document) => document.fileName.toLocaleLowerCase('de-DE')),
    )
    if (existingFileNames.has(fileName.toLocaleLowerCase('de-DE'))) {
      addEvent('Prompt-Datei nicht erstellt', `${fileName} existiert für ${selectedAgent.name} bereits.`)
      return
    }
    const document: PromptDocument = {
      id: crypto.randomUUID(),
      name: name.replace(/\.md$/i, ''),
      fileName,
      content: '',
      filePath: '',
      lastSentContent: null,
      updatedAt: new Date().toISOString(),
    }
    updateAgent(selectedAgent.id, {
      promptDocuments: [...selectedAgent.promptDocuments, document],
      activePromptDocumentId: document.id,
      prompt: '',
    })
    setNewPromptName('')
    setPromptCreationOpen(false)
  }

  const renamePromptDocument = async () => {
    if (!selectedAgent) {
      return
    }
    const document = activePromptDocument(selectedAgent)
    const name = renamedPromptName.trim()
    if (!document || !name) {
      return
    }

    const fileName = promptFileName(name)
    const nameAlreadyUsed = selectedAgent.promptDocuments.some(
      (item) =>
        item.id !== document.id &&
        item.fileName.toLocaleLowerCase('de-DE') === fileName.toLocaleLowerCase('de-DE'),
    )
    if (nameAlreadyUsed) {
      addEvent('Prompt-Datei nicht umbenannt', `${fileName} existiert für ${selectedAgent.name} bereits.`)
      return
    }

    let filePath = document.filePath
    if (document.filePath && document.fileName !== fileName) {
      try {
        const response = await fetch('/api/prompt-files', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: selectedAgent.projectPath,
            agentId: selectedAgent.id,
            oldFileName: document.fileName,
            fileName,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Prompt-Datei konnte nicht umbenannt werden.')
        }
        filePath = data.path || ''
      } catch (error) {
        addEvent(
          'Prompt-Datei nicht umbenannt',
          error instanceof Error ? error.message : 'Die Prompt-Datei konnte nicht umbenannt werden.',
        )
        return
      }
    }

    updateAgent(selectedAgent.id, {
      promptDocuments: selectedAgent.promptDocuments.map((item) =>
        item.id === document.id
          ? {
              ...item,
              name: name.replace(/\.md$/i, ''),
              fileName,
              filePath,
              lastSentContent: document.fileName === fileName ? item.lastSentContent : null,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
    setPromptRenameOpen(false)
    setRenamedPromptName('')
  }

  const applyThreadReplacement = useCallback((
    agent: Agent,
    replacement: { id: string; name?: string; cwd: string; status?: string; replacesThreadId?: string } | null,
  ) => {
    if (!replacement?.id) {
      return
    }
    setHiddenThreadIds((current) => [
      ...new Set([...current, replacement.replacesThreadId || agent.threadId]),
    ])
    updateAgent(agent.id, {
      threadId: replacement.id,
      threadTitle: replacement.name || agent.name,
    })
    setCodexThreads((current) => [
      ...current.filter((thread) => thread.id !== replacement.id),
      {
        id: replacement.id,
        title: replacement.name || agent.name,
        cwd: replacement.cwd,
        status: replacement.status || 'active',
      },
    ])
    addEvent(
      'Codex-Chat technisch migriert',
      `${agent.name} verwendet ab jetzt einen kompatiblen Codex-Chat. Der alte Chat bleibt erhalten.`,
    )
  }, [addEvent, updateAgent])

  const syncCodex = useCallback(async () => {
    try {
      const [projectsResponse, threadsResponse] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/threads'),
      ])
      if (!projectsResponse.ok || !threadsResponse.ok) {
        throw new Error('Codex-Projekte und -Tasks konnten nicht geladen werden.')
      }
      const projectsData = await projectsResponse.json()
      const threadsData = await threadsResponse.json()
      const projects: CodexProject[] = projectsData.projects
      const threads: CodexThread[] = threadsData.threads.map(
        (thread: { id: string; name?: string | null; preview?: string; cwd: string; status: string }) => ({
          id: thread.id,
          title: thread.name || thread.preview || 'Unbenannter Chat',
          cwd: thread.cwd,
          status: thread.status,
        }),
      ).filter((thread: CodexThread) => (
        projects.some((project) => samePath(project.path, thread.cwd))
      ))
      setCodexProjects(projects)
      setCodexThreads(threads)
      setProjectFilter((current: string) => {
        if (projects.some((project) => project.id === current)) {
          return current
        }
        const previousPath = current.startsWith('path:') ? current.slice(5) : ''
        return projects.find((project) => samePath(project.path, previousPath))?.id
          ?? projects[0]?.id
          ?? ''
      })
      setConnectorOnline(true)
      setLastSyncedAt(nowLabel())
    } catch {
      setConnectorOnline(false)
    }
  }, [])

  useEffect(() => {
    void syncCodex()
    const timer = window.setInterval(() => void syncCodex(), 5000)
    return () => window.clearInterval(timer)
  }, [syncCodex])

  useEffect(() => {
    let active = true
    const loadCodexMeta = async () => {
      try {
        const [modelsResponse, usageResponse] = await Promise.all([
          fetch('/api/models'),
          fetch('/api/usage'),
        ])
        if (modelsResponse.ok) {
          const data = await modelsResponse.json()
          if (active) {
            setCodexModels(data.models ?? [])
          }
        }
        if (usageResponse.ok) {
          const data = await usageResponse.json()
          const rateLimits = data.rateLimits
          const windows = [rateLimits?.primary, rateLimits?.secondary].filter(Boolean)
          const weekly =
            windows.find((window) => (window.windowDurationMins ?? 0) >= 7 * 24 * 60) ??
            windows.at(-1)
          if (active) {
            setUsageSummary({
              remainingPercent:
                typeof weekly?.usedPercent === 'number'
                  ? Math.max(0, Math.round(100 - weekly.usedPercent))
                  : null,
              resetsAt: weekly?.resetsAt ?? null,
              credits: rateLimits?.credits?.hasCredits
                ? rateLimits.credits.balance ?? null
                : null,
              unlimited: Boolean(rateLimits?.credits?.unlimited),
            })
          }
        }
      } catch {
        // Die Oberfläche bleibt auch ohne Kontodaten nutzbar.
      }
    }
    void loadCodexMeta()
    const timer = window.setInterval(() => void loadCodexMeta(), 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const addAgentFromThread = (threadId: string) => {
    const thread = codexThreads.find((item) => item.id === threadId)
    const project = codexProjects.find((item) => item.path === thread?.cwd)
    if (!thread || !project) {
      return
    }

    const existing = agents.find((agent) => agent.threadId === thread.id)
    if (existing) {
      setSelectedId(existing.id)
      addEvent('Codex Task bereits verlinkt', `${thread.title} ist schon mit ${existing.name} verbunden.`)
      return
    }

    const agent: Agent = {
      id: crypto.randomUUID(),
      name: thread.title,
      role: 'Rolle definieren',
      projectId: project.id,
      projectPath: project.path,
      threadTitle: thread.title,
      threadId: thread.id,
      model: '',
      prompt: 'Definiere die Rollen-Anweisung für diesen Codex Task.',
      promptDocuments: [createDefaultPromptDocument('Definiere die Rollen-Anweisung für diesen Codex Task.')],
      activePromptDocumentId: 'default',
      status: thread.status === 'active' ? 'laeuft' : 'wartet',
      talkTo: [],
      autoForward: true,
      assignment: 'agent',
      monitoredAgentIds: [],
      monitoringEnabled: false,
      monitoringIntervalMinutes: 30,
      lastMonitoringAt: '',
      teamProvisioningEnabled: false,
      lastAppliedTeamPlanSignature: '',
      workflowStatusIds: null,
      workflowStatusUpdatedAt: '',
      finishSignal: '"status":"fertig"',
      lastResult: '',
      instructionVersion: 1,
      lastInstruction: '',
      runStartedAt: '',
      lastDurationMs: 0,
      completedRuns: 0,
      pendingTurnId: '',
      lastCompletedTurnId: '',
      updatedAt: new Date().toISOString(),
    }
    setAgents((current) => [...current, agent])
    setSelectedId(agent.id)
    addEvent('Codex Task übernommen', `${project.label} / ${thread.title}`)
  }

  const createAgent = async () => {
    const name = newAgentName.trim()
    if (!name || !selectedProject || agentCreationBusy) {
      return
    }
    if (autoRun || autoRunRef.current) {
      setAgentCreationError(tx(
        'Agenten können nur bei Auto Stop erstellt werden.',
        'Agents can only be created while Auto Stop is active.',
      ))
      return
    }

    if (agents.some(
      (agent) =>
        samePath(agent.projectPath, selectedProject.path) &&
        agent.name.trim().toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'),
    )) {
      setAgentCreationError(tx(
        'In diesem Projekt gibt es bereits einen Agenten mit diesem Namen.',
        'An agent with this name already exists in this project.',
      ))
      return
    }

    setAgentCreationBusy(true)
    setAgentCreationError('')
    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: selectedProject.path,
          name,
          startInitialPrompt: false,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Codex-Chat konnte nicht erstellt werden.', 'The Codex chat could not be created.'))
      }

      const thread: CodexThread = {
        id: data.thread.id,
        title: data.thread.name || name,
        cwd: selectedProject.path,
        status: data.thread.status || 'idle',
      }
      const agent: Agent = {
        id: crypto.randomUUID(),
        name,
        role: 'Rolle definieren',
        projectId: selectedProject.id,
        projectPath: selectedProject.path,
        threadTitle: thread.title,
        threadId: thread.id,
        model: '',
        prompt: 'Definiere die Rollen-Anweisung für diesen Codex-Agenten.',
        promptDocuments: [createDefaultPromptDocument('Definiere die Rollen-Anweisung für diesen Codex-Agenten.')],
        activePromptDocumentId: 'default',
        status: 'wartet',
        talkTo: [],
        autoForward: true,
        assignment: 'agent',
        monitoredAgentIds: [],
        monitoringEnabled: false,
        monitoringIntervalMinutes: 30,
        lastMonitoringAt: '',
        teamProvisioningEnabled: false,
        lastAppliedTeamPlanSignature: '',
        workflowStatusIds: null,
        workflowStatusUpdatedAt: '',
        finishSignal: '"status":"fertig"',
        lastResult: '',
        instructionVersion: 1,
        lastInstruction: '',
        runStartedAt: '',
        lastDurationMs: 0,
        completedRuns: 0,
        pendingTurnId: '',
        lastCompletedTurnId: '',
        updatedAt: new Date().toISOString(),
      }

      setCodexThreads((current) => [
        ...current.filter((item) => item.id !== thread.id),
        thread,
      ])
      setAgents((current) => [...current, agent])
      setSelectedId(agent.id)
      setAgentCreationOpen(false)
      setNewAgentName('')
      addEvent('Agent und Codex-Chat erstellt', `${selectedProject.label} / ${name}`)
    } catch (error) {
      setAgentCreationError(
        error instanceof Error ? error.message : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.'),
      )
    } finally {
      setAgentCreationBusy(false)
    }
  }

  const applyManagementTeamPlan = async (manager: Agent) => {
    if (!selectedProject || !selectedTeamPlan || teamPlanApplying) return
    if (autoRun || autoRunRef.current) {
      setTeamPlanError(tx(
        'Der Team-Aufbau ist nur bei Auto Stop möglich.',
        'The team can only be created while Auto Stop is active.',
      ))
      return
    }
    if (manager.assignment !== 'management' || !manager.teamProvisioningEnabled) return

    const { plan, signature } = selectedTeamPlan
    if (signature === manager.lastAppliedTeamPlanSignature) {
      setTeamPlanError(tx('Dieser Team-Vorschlag wurde bereits übernommen.', 'This team proposal has already been applied.'))
      return
    }

    const projectAgentMap = new Map(
      agents
        .filter((agent) => samePath(agent.projectPath, selectedProject.path))
        .map((agent) => [agent.name.trim().toLocaleLowerCase('de-DE'), agent]),
    )
    const proposedNames = new Set(plan.agents.map((agent) => agent.name.toLocaleLowerCase('de-DE')))
    const allowedNames = new Set([...projectAgentMap.keys(), ...proposedNames])
    const invalidConnection = plan.connections.find((connection) =>
      !allowedNames.has(connection.from.toLocaleLowerCase('de-DE')) ||
      !allowedNames.has(connection.to.toLocaleLowerCase('de-DE')),
    )
    if (invalidConnection) {
      setTeamPlanError(tx(
        `Ungültige Verbindung: ${invalidConnection.from} → ${invalidConnection.to}.`,
        `Invalid connection: ${invalidConnection.from} → ${invalidConnection.to}.`,
      ))
      return
    }

    const statusByName = new Map(
      projectWorkflowStatuses.map((status) => [status.name.trim().toLocaleLowerCase('de-DE'), status]),
    )
    const unknownStatus = plan.agents
      .flatMap((agent) => agent.workflowStatuses)
      .find((status) => !statusByName.has(status.toLocaleLowerCase('de-DE')))
    if (unknownStatus) {
      setTeamPlanError(tx(
        `Der Workflow-Status „${unknownStatus}“ ist im Status-Setup nicht angelegt.`,
        `The workflow status “${unknownStatus}” does not exist in Status Setup.`,
      ))
      return
    }

    setTeamPlanApplying(true)
    setTeamPlanError('')
    const nextAgentMap = new Map(agents.map((agent) => [agent.id, agent]))
    const createdThreads: CodexThread[] = []
    try {
      for (const specification of plan.agents) {
        const normalizedName = specification.name.toLocaleLowerCase('de-DE')
        let agent = projectAgentMap.get(normalizedName)
        if (!agent) {
          const response = await fetch('/api/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cwd: selectedProject.path,
              name: specification.name,
              startInitialPrompt: false,
            }),
          })
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || `${specification.name}: Codex-Chat konnte nicht erstellt werden.`)
          }
          const thread: CodexThread = {
            id: data.thread.id,
            title: data.thread.name || specification.name,
            cwd: selectedProject.path,
            status: data.thread.status || 'idle',
          }
          createdThreads.push(thread)
          agent = normalizeAgent({
            id: crypto.randomUUID(),
            name: specification.name,
            role: specification.role,
            projectId: selectedProject.id,
            projectPath: selectedProject.path,
            threadTitle: thread.title,
            threadId: thread.id,
            prompt: specification.prompt,
            promptDocuments: [createDefaultPromptDocument(specification.prompt)],
            activePromptDocumentId: 'default',
            workflowStatusIds: specification.workflowStatuses.length > 0
              ? specification.workflowStatuses.map((status) => statusByName.get(status.toLocaleLowerCase('de-DE'))?.id).filter((id): id is string => Boolean(id))
              : null,
          })
        } else {
          const document = activePromptDocument(agent) ?? createDefaultPromptDocument(specification.prompt)
          const nextDocument = { ...document, content: specification.prompt, updatedAt: new Date().toISOString() }
          agent = {
            ...agent,
            role: specification.role,
            prompt: specification.prompt,
            promptDocuments: agent.promptDocuments.some((item) => item.id === nextDocument.id)
              ? agent.promptDocuments.map((item) => item.id === nextDocument.id ? nextDocument : item)
              : [...agent.promptDocuments, nextDocument],
            workflowStatusIds: specification.workflowStatuses.length > 0
              ? specification.workflowStatuses.map((status) => statusByName.get(status.toLocaleLowerCase('de-DE'))?.id).filter((id): id is string => Boolean(id))
              : null,
            updatedAt: new Date().toISOString(),
          }
        }

        nextAgentMap.set(agent.id, agent)
        projectAgentMap.set(normalizedName, agent)

        const promptDocument = activePromptDocument(agent) ?? agent.promptDocuments[0]
        const promptResponse = await fetch('/api/prompt-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: selectedProject.path,
            agentId: agent.id,
            fileName: promptDocument.fileName,
            content: specification.prompt,
          }),
        })
        const promptData = await promptResponse.json()
        if (!promptResponse.ok) {
          throw new Error(promptData.error || `${specification.name}: Prompt-Datei konnte nicht gespeichert werden.`)
        }
        agent = {
          ...agent,
          promptDocuments: agent.promptDocuments.map((document) =>
            document.id === promptDocument.id
              ? { ...document, content: specification.prompt, filePath: promptData.path, updatedAt: new Date().toISOString() }
              : document,
          ),
        }
        nextAgentMap.set(agent.id, agent)
        projectAgentMap.set(normalizedName, agent)
      }

      const resolvedAgents = [...nextAgentMap.values()]
      const teamAgentIds = plan.agents
        .map((item) => projectAgentMap.get(item.name.toLocaleLowerCase('de-DE'))?.id)
        .filter((id): id is string => Boolean(id))
      const newRoutes = plan.connections.map((connection) => ({
        id: crypto.randomUUID(),
        ownerAgentId: manager.id,
        projectPath: selectedProject.path,
        sourceId: projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!.id,
        targetId: projectAgentMap.get(connection.to.toLocaleLowerCase('de-DE'))!.id,
        condition: 'Immer',
        prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.',
      }))
      setAgents(resolvedAgents.map((agent) => agent.id === manager.id
        ? { ...agent, lastAppliedTeamPlanSignature: signature, updatedAt: new Date().toISOString() }
        : agent))
      setCodexThreads((current) => [
        ...current.filter((thread) => !createdThreads.some((created) => created.id === thread.id)),
        ...createdThreads,
      ])
      setWorkflowBoardAgentIds((current) => ({
        ...current,
        [manager.id]: Array.from(new Set([manager.id, ...(current[manager.id] ?? []), ...teamAgentIds])),
      }))
      setRoutes((current) => [
        ...current,
        ...newRoutes.filter((route) => !current.some((existing) =>
          existing.ownerAgentId === manager.id &&
          existing.sourceId === route.sourceId &&
          existing.targetId === route.targetId,
        )),
      ])
      setWorkflowPositions((current) => ({
        ...current,
        ...Object.fromEntries(
          Array.from(new Set([manager.id, ...teamAgentIds])).map((agentId, index) => [
            `${manager.id}:${agentId}`,
            current[`${manager.id}:${agentId}`] ?? { x: 70 + index * 230, y: 90 },
          ]),
        ),
      }))
      addEvent(
        'Team-Vorschlag übernommen',
        `${manager.name}: ${plan.agents.length} Agenten, ${plan.connections.length} Verbindungen. Automatik bleibt gestoppt.`,
      )
    } catch (error) {
      setAgents([...nextAgentMap.values()])
      setCodexThreads((current) => [
        ...current.filter((thread) => !createdThreads.some((created) => created.id === thread.id)),
        ...createdThreads,
      ])
      setTeamPlanError(error instanceof Error ? error.message : tx('Team-Aufbau fehlgeschlagen.', 'Team creation failed.'))
      addEvent('Team-Aufbau fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler.')
    } finally {
      setTeamPlanApplying(false)
    }
  }

  const setThreadVisibility = (thread: CodexThread, visible: boolean) => {
    if (visible) {
      setHiddenThreadIds((current) => current.filter((id) => id !== thread.id))
      addAgentFromThread(thread.id)
      return
    }

    setHiddenThreadIds((current) =>
      current.includes(thread.id) ? current : [...current, thread.id],
    )
    addEvent('Codex Task ausgeblendet', `${thread.title} bleibt in Codex erhalten.`)
  }

  useEffect(() => {
    const firstVisible = projectAgents[0]
    if (!projectAgents.some((agent) => agent.id === selectedId)) {
      setSelectedId(firstVisible?.id ?? '')
    }
  }, [projectAgents, selectedId])

  const deleteAgent = async (agent: Agent) => {
    const message = agent.threadId
      ? tx(
          `Möchten Sie den Agenten „${agent.name}“ wirklich löschen?\n\nDer zugehörige Codex-Chat wird archiviert und aus der aktiven Projektansicht entfernt.`,
          `Do you really want to delete agent “${agent.name}”?\n\nThe linked Codex chat will be archived and removed from the active project view.`,
        )
      : tx(
          `Möchten Sie den Agenten „${agent.name}“ wirklich aus dem Orchestrator entfernen?`,
          `Do you really want to remove agent “${agent.name}” from the orchestrator?`,
        )
    if (!window.confirm(message)) {
      return
    }

    setDeletingAgentId(agent.id)

    if (agent.threadId) {
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(agent.threadId)}`, {
          method: 'DELETE',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Codex-Task konnte nicht archiviert werden.')
        }

        let activeThreads: CodexThread[] | null = null
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const verification = await fetch('/api/threads')
          if (!verification.ok) {
            throw new Error('Die Archivierung konnte nicht bestätigt werden.')
          }
          const verificationData = await verification.json()
          const attemptThreads: CodexThread[] = verificationData.threads.map(
            (thread: { id: string; name?: string | null; preview?: string; cwd: string; status: string }) => ({
              id: thread.id,
              title: thread.name || thread.preview || 'Unbenannter Chat',
              cwd: thread.cwd,
              status: thread.status,
            }),
          )
          activeThreads = attemptThreads
          if (!attemptThreads.some((thread) => thread.id === agent.threadId)) {
            break
          }
          await new Promise((resolve) => window.setTimeout(resolve, 300))
        }

        const verifiedThreads = activeThreads ?? []
        if (verifiedThreads.some((thread) => thread.id === agent.threadId)) {
          throw new Error('Der Codex-Chat wird weiterhin als aktiv gemeldet.')
        }
        setCodexThreads(verifiedThreads)
      } catch (error) {
        addEvent(
          'Agent konnte nicht gelöscht werden',
          error instanceof Error ? error.message : 'Der Codex-Connector ist nicht erreichbar.',
        )
        setDeletingAgentId('')
        return
      }
    }

    const remaining = agents.filter((item) => item.id !== agent.id)
    setAgents(
      remaining.map((item) => {
        const talkTo = item.talkTo.filter((targetId) => targetId !== agent.id)
        const monitoredAgentIds = item.monitoredAgentIds.filter((targetId) => targetId !== agent.id)
        return talkTo.length !== item.talkTo.length || monitoredAgentIds.length !== item.monitoredAgentIds.length
          ? { ...item, talkTo, monitoredAgentIds, updatedAt: new Date().toISOString() }
          : item
      }),
    )
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== agent.id && route.targetId !== agent.id),
    )
    setWorkflowInitials((current) =>
      current.filter((initial) => initial.ownerAgentId !== agent.id),
    )
    setWorkflowStops((current) =>
      current.filter((stop) => stop.ownerAgentId !== agent.id),
    )
    setWorkflowTimers((current) =>
      current.filter((timer) => timer.ownerAgentId !== agent.id),
    )
    setWorkflowPositions((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.endsWith(`:${agent.id}`)),
      )
    })
    setSelectedId(remaining[0]?.id ?? '')
    addEvent(
      'Agent gelöscht',
      agent.threadId
        ? `${agent.name} wurde entfernt. Der Codex-Chat ist archiviert und nicht mehr aktiv.`
        : `${agent.name} wurde aus dem Orchestrator entfernt.`,
    )
    setDeletingAgentId('')
  }

  const reorderAgent = (sourceId: string, targetId: string, position: 'before' | 'after') => {
    if (!sourceId || sourceId === targetId) {
      return
    }

    setAgents((current) => {
      const sourceIndex = current.findIndex((agent) => agent.id === sourceId)
      const targetIndex = current.findIndex((agent) => agent.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return current
      }

      const reordered = [...current]
      const [movedAgent] = reordered.splice(sourceIndex, 1)
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
      const insertionIndex = adjustedTargetIndex + (position === 'after' ? 1 : 0)
      reordered.splice(insertionIndex, 0, movedAgent)
      return reordered
    })
    setDraggedAgentId('')
    setDropTarget(null)
    setDropEdge(null)
  }

  const reorderAgentToEdge = (sourceId: string, edge: 'start' | 'end') => {
    const possibleTargets = projectAgents.filter((agent) => agent.id !== sourceId)
    const target = edge === 'start' ? possibleTargets[0] : possibleTargets[possibleTargets.length - 1]
    if (!target) {
      setDraggedAgentId('')
      setDropTarget(null)
      setDropEdge(null)
      return
    }
    reorderAgent(sourceId, target.id, edge === 'start' ? 'before' : 'after')
  }

  const savePromptInstruction = async (agent: Agent) => {
    if (!agent.threadId) {
      addEvent('Prompt nicht gesendet', `${agent.name} ist mit keinem Codex-Task verknüpft.`)
      return
    }
    if (!agent.projectPath) {
      addEvent('Prompt nicht gespeichert', `${agent.name} hat keinen Projektpfad.`)
      return
    }

    const promptDocument = activePromptDocument(agent)
    if (!promptDocument) {
      addEvent('Prompt nicht gespeichert', `${agent.name} hat keine aktive Prompt-Datei.`)
      return
    }
    if (
      promptDocument.lastSentContent !== null &&
      promptDocument.content === promptDocument.lastSentContent
    ) {
      addEvent(
        'Inhalt nicht verändert',
        `${promptDocument.fileName} enthält keine neue Änderung und wurde nicht übergeben.`,
      )
      return
    }

    setAgentTransmission(agent.id, true)
    const nextVersion = agent.instructionVersion + 1
    let filePath = promptDocument.filePath
    try {
      const response = await fetch('/api/prompt-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: agent.projectPath,
          agentId: agent.id,
          fileName: promptDocument.fileName,
          content: promptDocument.content,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Prompt-Datei konnte nicht gespeichert werden.')
      }
      filePath = data.path
      updateAgent(agent.id, {
        prompt: promptDocument.content,
        promptDocuments: agent.promptDocuments.map((document) =>
          document.id === promptDocument.id
            ? { ...document, filePath, updatedAt: new Date().toISOString() }
            : document,
        ),
      })
    } catch (error) {
      addEvent(
        'Prompt nicht gespeichert',
        error instanceof Error ? error.message : 'Die Prompt-Datei konnte nicht angelegt werden.',
      )
      setAgentTransmission(agent.id, false)
      return
    }

    const instruction = buildInstruction(
      agent,
      filePath,
      workflowStatusesForAgent(agent, workflowStatuses),
      agents.filter((item) => agent.monitoredAgentIds.includes(item.id)),
    )
    let startedTurnId = ''
    try {
      const response = await fetch(
        `/api/threads/${encodeURIComponent(agent.threadId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: instruction, model: agent.model || undefined }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Prompt konnte nicht gesendet werden.')
      }
      applyThreadReplacement(agent, data.replacementThread)
      startedTurnId = data.turn?.id ?? ''
    } catch (error) {
      addEvent(
        'Prompt nicht gesendet',
        error instanceof Error ? error.message : 'Der Codex-Connector ist nicht erreichbar.',
      )
      setAgentTransmission(agent.id, false)
      return
    }

    updateAgent(agent.id, {
      instructionVersion: nextVersion,
      lastInstruction: instruction,
      promptDocuments: agent.promptDocuments.map((document) =>
        document.id === promptDocument.id
          ? {
              ...document,
              filePath,
              lastSentContent: promptDocument.content,
              updatedAt: new Date().toISOString(),
            }
          : document,
      ),
      status: 'laeuft',
      runStartedAt: new Date().toISOString(),
      pendingTurnId: startedTurnId,
    })
    setAgentTransmission(agent.id, false)
    addEvent(
      'Prompt an Codex übergeben',
      `${agent.name} -> ${agent.threadTitle || agent.threadId || 'nicht verlinkt'} | ${promptDocument.fileName} | v${nextVersion}`,
    )
  }

  const sendChatMessage = async (agent: Agent) => {
    const text = chatDraft.trim()
    if (!text || !agent.threadId || chatSending) {
      return
    }

    setChatSending(true)
    setAgentTransmission(agent.id, true)
    setChatError('')
    const requiresWorkflowStatus = /\bstatus\s+hinzuf(?:ü|ue)gen\b/i.test(text)
    const requestsTeamPlan =
      agent.assignment === 'management' &&
      agent.teamProvisioningEnabled &&
      /\b(team|agent(?:en)?\s+(?:erstellen|einstellen|anlegen)|teamaufbau|team-plan)\b/i.test(text)
    const messageParts = [text]
    if (requiresWorkflowStatus) {
      messageParts.push('', workflowStatusInstruction(workflowStatusesForAgent(agent, workflowStatuses)))
    }
    if (requestsTeamPlan) {
      messageParts.push('', managementTeamPlanInstruction())
    }
    const message = messageParts.join('\n')
    try {
      const response = await fetch(
        `/api/threads/${encodeURIComponent(agent.threadId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, model: agent.model || undefined }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Nachricht konnte nicht gesendet werden.', 'The message could not be sent.'))
      }

      applyThreadReplacement(agent, data.replacementThread)
      setChatDraft('')
      setChatPinnedToBottom(true)
      updateAgent(agent.id, {
        status: 'laeuft',
        runStartedAt: new Date().toISOString(),
        pendingTurnId: data.turn?.id ?? '',
      })
      addEvent(
        'Chat-Nachricht gesendet',
        requestsTeamPlan
          ? `${agent.name} hat den Auftrag für einen kontrollierten Team-Vorschlag erhalten.`
          : requiresWorkflowStatus
          ? `${agent.name} hat eine direkte Anweisung mit Workflow-Status erhalten.`
          : `${agent.name} hat eine direkte Anweisung ohne Workflow-Status erhalten.`,
      )
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.'),
      )
    } finally {
      setChatSending(false)
      setAgentTransmission(agent.id, false)
    }
  }

  const renameCodexThread = async (agent: Agent) => {
    if (!agent.threadId || agent.name === agent.threadTitle) {
      return
    }
    try {
      const response = await fetch(
        `/api/threads/${encodeURIComponent(agent.threadId)}/name`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: agent.name }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Codex-Task konnte nicht umbenannt werden.')
      }
      updateAgent(agent.id, { threadTitle: agent.name })
      setCodexThreads((current) =>
        current.map((thread) =>
          thread.id === agent.threadId ? { ...thread, title: agent.name } : thread,
        ),
      )
      addEvent('Codex-Task umbenannt', agent.name)
    } catch (error) {
      addEvent(
        'Umbenennen fehlgeschlagen',
        error instanceof Error ? error.message : 'Der Codex-Connector ist nicht erreichbar.',
      )
    }
  }

  const handoff = useCallback(async (agent: Agent) => {
    if (!autoRunRef.current) {
      addEvent('Weitergabe blockiert', `${agent.name}: Die Automatik ist ausgeschaltet.`)
      return
    }
    const activeRoutes = routes.filter(
      (route) =>
        route.sourceId === agent.id &&
        (route.ownerAgentId || route.sourceId) === agent.id,
    )
    if (activeRoutes.length === 0) {
      addEvent('Weitergabe gestoppt', `${agent.name} hat keine Workflow-Verbindung.`)
      return
    }
    const currentTaskSignature = taskSignature(agent.lastResult)
    const projectStatuses = workflowStatusesForAgent(agent, workflowStatuses)
    const resultStatusIds = workflowStatusIdsFromResult(agent.lastResult, projectStatuses)
    const deliveries = activeRoutes.flatMap<WorkflowDelivery>((route) => {
      const directTarget = agents.find((item) => item.id === route.targetId)
      if (directTarget) {
        return [{ target: directTarget, route }]
      }
      const directStop = workflowStops.find((stop) => stop.id === route.targetId)
      if (directStop) {
        return [{ stop: directStop, route }]
      }
      const statusFilter = workflowStatusFilters.find((filter) => filter.id === route.targetId)
      if (statusFilter) {
        if (!resultStatusIds.includes(statusFilter.statusId)) {
          return []
        }
        return routes
          .filter((outgoing) => outgoing.sourceId === statusFilter.id)
          .flatMap<WorkflowDelivery>((outgoing) => {
            const target = agents.find((item) => item.id === outgoing.targetId)
            if (target) {
              return [{ target, route: outgoing }]
            }
            const stop = workflowStops.find((item) => item.id === outgoing.targetId)
            return stop ? [{ stop, route: outgoing }] : []
          })
      }
      const promptNode = workflowPrompts.find((prompt) => prompt.id === route.targetId)
      if (!promptNode) {
        return []
      }
      return routes
        .filter(
          (outgoing) =>
            outgoing.sourceId === promptNode.id &&
            routeConditionMatches(outgoing.condition, agent.lastResult),
        )
        .flatMap<WorkflowDelivery>((outgoing) => {
          const target = agents.find((item) => item.id === outgoing.targetId)
          if (target) {
            return [{
                target,
                route: {
                  ...outgoing,
                  condition: promptNode.condition,
                  prompt: promptNode.prompt,
                },
              }]
          }
          const stop = workflowStops.find((item) => item.id === outgoing.targetId)
          return stop
            ? [{
                stop,
                route: {
                  ...outgoing,
                  condition: promptNode.condition,
                  prompt: promptNode.prompt,
                },
              }]
            : []
        })
    })
    if (deliveries.length === 0) {
      const availableStatuses = resultStatusIds.length > 0
        ? projectStatuses.filter((status) => resultStatusIds.includes(status.id)).map((status) => status.name).join(', ')
        : 'kein Workflow-Status'
      addEvent('Keine Status-Weitergabe', `${agent.name}: ${availableStatuses}`)
      return
    }
    const newDeliveries = deliveries.filter(({ route, target, stop }) => {
      if (!currentTaskSignature || route.lastForwardedTask !== currentTaskSignature) {
        return true
      }
      addEvent(
        'Identische Aufgabe nicht weitergegeben',
        `${agent.name} → ${target?.name ?? stop?.name ?? 'Stopp'}: Die nächste Aufgabe wurde über diese Verbindung bereits übergeben.`,
      )
      return false
    })
    if (newDeliveries.length === 0) {
      return
    }

    const stopDeliveries = newDeliveries.filter(
      (delivery): delivery is WorkflowDelivery & { stop: WorkflowStop } => Boolean(delivery.stop),
    )
    const agentDeliveries = newDeliveries.filter(
      (delivery): delivery is WorkflowDelivery & { target: Agent } => Boolean(delivery.target),
    )

    stopDeliveries.forEach(({ route, stop }) => {
      if (currentTaskSignature) {
        setRoutes((current) =>
          current.map((item) =>
            item.id === route.id ? { ...item, lastForwardedTask: currentTaskSignature } : item,
          ),
        )
      }
      addEvent('Workflow-Pfad beendet', `${agent.name} → ${stop?.name ?? 'Stopp'}`)
    })

    if (agentDeliveries.length === 0) {
      updateAgent(agent.id, {
        status: 'fertig',
        pendingTurnId: '',
        runStartedAt: '',
      })
      return
    }

    updateAgent(agent.id, { status: 'weitergegeben' })
    const deliveredTargets: string[] = []
    await Promise.all(agentDeliveries.map(async ({ target, route }) => {
      deliveredTargets.push(target.name)
      const message = buildHandoffMessage(
        agent,
        target,
        route,
        workflowStatusesForAgent(target, workflowStatuses),
      )
      updateAgent(target.id, {
        status: 'laeuft',
        lastResult: message,
        runStartedAt: new Date().toISOString(),
      })
      if (!target.threadId) {
        addEvent('Weitergabe nicht gesendet', `${target.name} ist mit keinem Codex-Chat verknüpft.`)
        return
      }

      try {
        const response = await fetch(
          `/api/threads/${encodeURIComponent(target.threadId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message, model: target.model || undefined }),
          },
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Übergabe konnte nicht gesendet werden.')
        }
        applyThreadReplacement(target, data.replacementThread)
        updateAgent(target.id, {
          status: 'laeuft',
          pendingTurnId: data.turn?.id ?? '',
        })
        if (currentTaskSignature) {
          setRoutes((current) =>
            current.map((item) =>
              item.id === route.id
                ? { ...item, lastForwardedTask: currentTaskSignature }
                : item,
            ),
          )
        }
      } catch (error) {
        updateAgent(target.id, {
          status: 'rueckfrage',
          pendingTurnId: '',
          runStartedAt: '',
        })
        addEvent(
          'Weitergabe nicht gesendet',
          `${target.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
        )
      }
    }))
    addEvent(
      'Aufgabe weitergegeben',
      `${agent.name} -> ${deliveredTargets.join(', ')}`,
    )
  }, [addEvent, agents, applyThreadReplacement, routes, updateAgent, workflowPrompts, workflowStatusFilters, workflowStatuses, workflowStops])

  const connectAgents = useCallback((connection: Connection) => {
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target ||
      connection.sourceHandle !== 'output' ||
      connection.targetHandle !== 'input'
    ) {
      return
    }
    const route: WorkflowRoute = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject?.path ?? '',
      sourceId: connection.source,
      targetId: connection.target,
      condition: 'Immer',
      prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.',
    }
    setRoutes((current) => [...current, route])
    const nodeName = (nodeId: string) =>
      agents.find((agent) => agent.id === nodeId)?.name ??
      workflowPrompts.find((prompt) => prompt.id === nodeId)?.name ??
      workflowInitials.find((initial) => initial.id === nodeId)?.name ??
      workflowStatusFilters.find((filter) => filter.id === nodeId)?.name ??
      workflowStops.find((stop) => stop.id === nodeId)?.name ??
      workflowTimers.find((timer) => timer.id === nodeId)?.name ??
      'Knoten'
    addEvent(
      'Workflow-Verbindung erstellt',
      `${nodeName(route.sourceId)} → ${nodeName(route.targetId)}`,
    )
  }, [activeDashboardOwnerId, addEvent, agents, selectedProject?.path, workflowInitials, workflowPrompts, workflowStatusFilters, workflowStops, workflowTimers])

  const addWorkflowPrompt = () => {
    const prompt: WorkflowPrompt = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject?.path ?? '',
      name: 'Neue Bedingung',
      condition: 'Wenn das Ergebnis geprüft werden soll',
      prompt: 'Prüfe das eingehende Ergebnis und leite es entsprechend der Bedingung weiter.',
    }
    setWorkflowPrompts((current) => [...current, prompt])
  }

  const updateWorkflowPrompt = (promptId: string, patch: Partial<WorkflowPrompt>) => {
    setWorkflowPrompts((current) =>
      current.map((prompt) => (prompt.id === promptId ? { ...prompt, ...patch } : prompt)),
    )
  }

  const deleteWorkflowPrompt = (promptId: string) => {
    setWorkflowPrompts((current) => current.filter((prompt) => prompt.id !== promptId))
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== promptId && route.targetId !== promptId),
    )
    setSelectedPromptId('')
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${promptId}`]
      return next
    })
  }

  const addWorkflowStatus = () => {
    const name = newWorkflowStatusName.trim()
    if (!name || !selectedProject) {
      return
    }
    if (projectWorkflowStatuses.some((status) => status.name.trim().toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))) {
      addEvent('Workflow-Status nicht erstellt', `Der Status „${name}“ existiert bereits.`)
      return
    }
    setWorkflowStatuses((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        projectPath: selectedProject.path,
        name,
        description: newWorkflowStatusDescription.trim(),
      },
    ])
    setNewWorkflowStatusName('')
    setNewWorkflowStatusDescription('')
    addEvent('Workflow-Status erstellt', name)
  }

  const openWorkflowStatusEditor = (status: WorkflowStatusDefinition) => {
    setEditingWorkflowStatusId(status.id)
    setEditingWorkflowStatusName(status.name)
    setEditingWorkflowStatusDescription(status.description)
  }

  const closeWorkflowStatusEditor = () => {
    setEditingWorkflowStatusId('')
    setEditingWorkflowStatusName('')
    setEditingWorkflowStatusDescription('')
  }

  const saveWorkflowStatus = () => {
    if (!editingWorkflowStatus) {
      return
    }
    const name = editingWorkflowStatusName.trim()
    const description = editingWorkflowStatusDescription.trim()
    if (!name) {
      addEvent('Workflow-Status nicht geändert', 'Der Statusname darf nicht leer sein.')
      return
    }
    const duplicateName = workflowStatuses.some(
      (status) =>
        status.id !== editingWorkflowStatus.id &&
        samePath(status.projectPath, editingWorkflowStatus.projectPath) &&
        status.name.trim().toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'),
    )
    if (duplicateName) {
      addEvent('Workflow-Status nicht geändert', `Der Status „${name}“ existiert bereits.`)
      return
    }

    const previousName = editingWorkflowStatus.name
    setWorkflowStatuses((current) =>
      current.map((status) =>
        status.id === editingWorkflowStatus.id ? { ...status, name, description } : status,
      ),
    )
    if (previousName !== name) {
      setWorkflowStatusFilters((current) =>
        current.map((filter) =>
          filter.statusId === editingWorkflowStatus.id && filter.name === `Status: ${previousName}`
            ? { ...filter, name: `Status: ${name}` }
            : filter,
        ),
      )
    }
    addEvent(
      'Workflow-Status geändert',
      previousName === name ? name : `${previousName} → ${name}`,
    )
    closeWorkflowStatusEditor()
  }

  const deleteWorkflowStatus = (statusId: string) => {
    const status = workflowStatuses.find((item) => item.id === statusId)
    setWorkflowStatuses((current) => current.filter((item) => item.id !== statusId))
    const filterIds = workflowStatusFilters.filter((filter) => filter.statusId === statusId).map((filter) => filter.id)
    setWorkflowStatusFilters((current) => current.filter((filter) => filter.statusId !== statusId))
    setRoutes((current) => current.filter((route) => !filterIds.includes(route.sourceId) && !filterIds.includes(route.targetId)))
    setSelectedStatusFilterId('')
    addEvent('Workflow-Status gelöscht', status?.name ?? 'Status')
  }

  const addWorkflowStatusFilter = () => {
    const status = projectWorkflowStatuses[0]
    if (!status || !activeDashboardOwnerId || !selectedProject) {
      addEvent('Status-Filter nicht erstellt', 'Lege zuerst einen Workflow-Status an.')
      return
    }
    const filter: WorkflowStatusFilter = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject.path,
      name: `Status: ${status.name}`,
      statusId: status.id,
    }
    setWorkflowStatusFilters((current) => [...current, filter])
    setSelectedStatusFilterId(filter.id)
    addEvent('Status-Filter erstellt', status.name)
  }

  const selectWorkflowStatusFilterStatus = (filterId: string, statusId: string) => {
    const status = workflowStatuses.find((item) => item.id === statusId)
    if (!status) {
      return
    }
    setWorkflowStatusFilters((current) =>
      current.map((filter) =>
        filter.id === filterId
          ? { ...filter, statusId: status.id, name: `Status: ${status.name}` }
          : filter,
      ),
    )
  }

  const deleteWorkflowStatusFilter = (filterId: string) => {
    setWorkflowStatusFilters((current) => current.filter((filter) => filter.id !== filterId))
    setRoutes((current) => current.filter((route) => route.sourceId !== filterId && route.targetId !== filterId))
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${filterId}`]
      return next
    })
    setSelectedStatusFilterId('')
  }

  const addWorkflowInitial = () => {
    const initial: WorkflowInitial = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject?.path ?? '',
      name: 'Initial',
      instruction:
        'Ermittle anhand deines Projektkontexts den aktuellen Stand, offene Aufgaben, Risiken und den sinnvollsten nächsten Schritt.',
    }
    setWorkflowInitials((current) => [...current, initial])
  }

  const updateWorkflowInitial = (initialId: string, patch: Partial<WorkflowInitial>) => {
    setWorkflowInitials((current) =>
      current.map((initial) => (initial.id === initialId ? { ...initial, ...patch } : initial)),
    )
  }

  const deleteWorkflowInitial = (initialId: string) => {
    setWorkflowInitials((current) => current.filter((initial) => initial.id !== initialId))
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== initialId && route.targetId !== initialId),
    )
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${initialId}`]
      return next
    })
    setSelectedInitialId('')
  }

  const addWorkflowStop = () => {
    if (!activeDashboardOwnerId || !selectedProject) {
      return
    }
    const stop: WorkflowStop = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject.path,
      name: 'Stop',
    }
    setWorkflowStops((current) => [...current, stop])
    setSelectedStopId(stop.id)
    addEvent('Stopp-Baustein erstellt', `${selectedAgent?.name ?? 'Workflow'} beendet an diesem Punkt.`)
  }

  const updateWorkflowStop = (stopId: string, patch: Partial<WorkflowStop>) => {
    setWorkflowStops((current) =>
      current.map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
    )
  }

  const deleteWorkflowStop = (stopId: string) => {
    setWorkflowStops((current) => current.filter((stop) => stop.id !== stopId))
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== stopId && route.targetId !== stopId),
    )
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${stopId}`]
      return next
    })
    setSelectedStopId('')
  }

  const addWorkflowTimer = () => {
    if (!activeDashboardOwnerId || !selectedProject) return
    const startAt = new Date().toISOString()
    const timer: WorkflowTimer = {
      id: crypto.randomUUID(),
      ownerAgentId: activeDashboardOwnerId,
      projectPath: selectedProject.path,
      name: 'Zeitplan',
      task: 'Prüfe den aktuellen Stand und melde die nächsten erforderlichen Schritte.',
      schedule: 'interval',
      startAt,
      intervalValue: 30,
      intervalUnit: 'minutes',
      recurring: true,
      enabled: false,
      nextRunAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      lastRunAt: '',
    }
    setWorkflowTimers((current) => [...current, timer])
    addEvent('Zeitplan erstellt', 'Doppelklick auf den Baustein öffnet die Konfiguration.')
  }

  const updateWorkflowTimer = (timerId: string, patch: Partial<WorkflowTimer>) => {
    setWorkflowTimers((current) =>
      current.map((timer) => {
        if (timer.id !== timerId) return timer
        const next = { ...timer, ...patch }
        if ('schedule' in patch) {
          if (next.schedule === 'interval') {
            next.startAt = new Date().toISOString()
            next.nextRunAt = new Date(Date.now() + timerIntervalMs(next)).toISOString()
          } else {
            next.startAt = defaultTimerStart()
            next.nextRunAt = next.startAt
          }
        } else if ('startAt' in patch || 'intervalValue' in patch || 'intervalUnit' in patch) {
          next.nextRunAt = next.schedule === 'interval' ? nextTimerRun(next) : next.startAt
        }
        return next
      }),
    )
  }

  const deleteWorkflowTimer = (timerId: string) => {
    setWorkflowTimers((current) => current.filter((timer) => timer.id !== timerId))
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== timerId && route.targetId !== timerId),
    )
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${timerId}`]
      return next
    })
    setSelectedTimerId('')
  }

  const removeAgentFromDashboard = (agentId: string) => {
    setWorkflowBoardAgentIds((current) => ({
      ...current,
      [activeDashboardOwnerId]: (current[activeDashboardOwnerId] ?? [activeDashboardOwnerId])
        .filter((id) => id !== agentId),
    }))
    setRoutes((current) =>
      current.filter(
        (route) =>
          route.ownerAgentId !== activeDashboardOwnerId ||
          (route.sourceId !== agentId && route.targetId !== agentId),
      ),
    )
    setSelectedWorkflowAgentId('')
    setSelectedRouteId('')
    addEvent(
      'Agent aus Dashboard entfernt',
      `${projectAgents.find((agent) => agent.id === agentId)?.name ?? 'Agent'} bleibt als Codex-Chat erhalten.`,
    )
  }

  const dropAgentIntoDashboard = (agentId: string, position: { x: number; y: number }) => {
    if (!projectAgents.some((agent) => agent.id === agentId)) {
      return
    }
    setWorkflowBoardAgentIds((current) => ({
      ...current,
      [activeDashboardOwnerId]: [
        ...new Set([...(current[activeDashboardOwnerId] ?? [activeDashboardOwnerId]), agentId]),
      ],
    }))
    setWorkflowPositions((current) => ({
      ...current,
      [`${activeDashboardOwnerId}:${agentId}`]: position,
    }))
    setSelectedWorkflowAgentId(agentId)
  }

  const autoArrangeWorkflow = () => {
    const nodeIds = [
      ...projectInitials.map((initial) => initial.id),
      ...projectTimers.map((timer) => timer.id),
      ...dashboardAgents.map((agent) => agent.id),
      ...dashboardPrompts.map((prompt) => prompt.id),
      ...projectStatusFilters.map((filter) => filter.id),
      ...projectStops.map((stop) => stop.id),
    ]
    const incoming = new Map(nodeIds.map((id) => [id, 0]))
    dashboardRoutes.forEach((route) => {
      incoming.set(route.targetId, (incoming.get(route.targetId) ?? 0) + 1)
    })
    const roots = nodeIds.filter((id) => (incoming.get(id) ?? 0) === 0)
    const levels = new Map<string, number>()

    if (roots.length === 0) {
      nodeIds.forEach((id, index) => levels.set(id, index))
    } else {
      roots.forEach((id) => levels.set(id, 0))
      for (let pass = 0; pass < nodeIds.length; pass += 1) {
        dashboardRoutes.forEach((route) => {
          const sourceLevel = levels.get(route.sourceId)
          if (sourceLevel !== undefined && !levels.has(route.targetId)) {
            levels.set(route.targetId, sourceLevel + 1)
          }
        })
      }
      const fallbackLevel = Math.max(0, ...levels.values()) + 1
      nodeIds.filter((id) => !levels.has(id)).forEach((id) => levels.set(id, fallbackLevel))
    }

    const grouped = new Map<number, string[]>()
    nodeIds.forEach((id) => {
      const level = levels.get(id) ?? 0
      grouped.set(level, [...(grouped.get(level) ?? []), id])
    })

    const originalOrder = new Map(nodeIds.map((id, index) => [id, index]))
    const verticalOrder = new Map<string, number>()
    const updateVerticalOrder = () => {
      grouped.forEach((ids) => {
        ids.forEach((id, index) => verticalOrder.set(id, index))
      })
    }
    const sortLevelByNeighbors = (level: number, direction: 'incoming' | 'outgoing') => {
      const ids = [...(grouped.get(level) ?? [])]
      ids.sort((left, right) => {
        const neighborAverage = (nodeId: string) => {
          const neighbors = dashboardRoutes
            .filter((route) => direction === 'incoming' ? route.targetId === nodeId : route.sourceId === nodeId)
            .map((route) => direction === 'incoming' ? route.sourceId : route.targetId)
            .filter((neighborId) => {
              const neighborLevel = levels.get(neighborId)
              return direction === 'incoming'
                ? neighborLevel !== undefined && neighborLevel < level
                : neighborLevel !== undefined && neighborLevel > level
            })
            .map((neighborId) => verticalOrder.get(neighborId))
            .filter((order): order is number => order !== undefined)
          if (neighbors.length === 0) {
            return null
          }
          return neighbors.reduce((sum, order) => sum + order, 0) / neighbors.length
        }
        const leftAverage = neighborAverage(left)
        const rightAverage = neighborAverage(right)
        if (leftAverage === null && rightAverage === null) {
          return (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0)
        }
        if (leftAverage === null) {
          return 1
        }
        if (rightAverage === null) {
          return -1
        }
        return leftAverage - rightAverage || (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0)
      })
      grouped.set(level, ids)
      updateVerticalOrder()
    }

    const orderedLevels = Array.from(grouped.keys()).sort((left, right) => left - right)
    updateVerticalOrder()
    for (let pass = 0; pass < 2; pass += 1) {
      orderedLevels.slice(1).forEach((level) => sortLevelByNeighbors(level, 'incoming'))
      orderedLevels.slice(0, -1).reverse().forEach((level) => sortLevelByNeighbors(level, 'outgoing'))
    }

    const nextPositions: Record<string, { x: number; y: number }> = {}
    orderedLevels
      .map((level) => [level, grouped.get(level) ?? []] as const)
      .forEach(([level, ids]) => {
        ids.forEach((id, index) => {
          nextPositions[id] = { x: 70 + level * 230, y: 70 + index * 130 }
        })
      })
    setWorkflowPositions((current) => ({
      ...current,
      ...Object.fromEntries(
        Object.entries(nextPositions).map(([nodeId, position]) => [
          `${activeDashboardOwnerId}:${nodeId}`,
          position,
        ]),
      ),
    }))
    setLayoutRevision((current) => current + 1)
  }

  useEffect(() => {
    const poll = async () => {
      await Promise.all(
        agents
          .filter(
            (agent) =>
              agent.status === 'laeuft' &&
              Boolean(agent.threadId) &&
              Boolean(agent.pendingTurnId) &&
              agent.pendingTurnId !== agent.lastCompletedTurnId &&
              !pollingTurnIds.current.has(agent.pendingTurnId),
          )
          .map(async (agent) => {
            pollingTurnIds.current.add(agent.pendingTurnId)
            try {
              const response = await fetch(
                `/api/threads/${encodeURIComponent(agent.threadId)}/result?turnId=${encodeURIComponent(agent.pendingTurnId)}`,
              )
              const data = await response.json()
              if (!response.ok) {
                throw new Error(data.error || 'Codex-Ergebnis konnte nicht gelesen werden.')
              }
              if (data.status === 'inProgress') {
                terminalResultObservations.current.delete(agent.pendingTurnId)
                return
              }
              if (data.status !== 'completed') {
                const runAgeMs = agent.runStartedAt
                  ? Date.now() - new Date(agent.runStartedAt).getTime()
                  : 0
                const observations =
                  (terminalResultObservations.current.get(agent.pendingTurnId) ?? 0) + 1
                terminalResultObservations.current.set(agent.pendingTurnId, observations)
                if (runAgeMs < 6000 || observations < 2) {
                  return
                }
                terminalResultObservations.current.delete(agent.pendingTurnId)
                updateAgent(agent.id, {
                  status: 'rueckfrage',
                  pendingTurnId: '',
                  lastCompletedTurnId: data.turnId ?? agent.pendingTurnId,
                })
                addEvent(
                  'Codex-Ausführung nicht abgeschlossen',
                  `${agent.name}: ${data.error?.message ?? data.status}`,
                )
                return
              }

              terminalResultObservations.current.delete(agent.pendingTurnId)
              const completedAgent: Agent = {
                ...agent,
                status: 'fertig',
                lastResult: data.text ?? '',
                pendingTurnId: '',
                lastCompletedTurnId: data.turnId ?? agent.pendingTurnId,
                runStartedAt: '',
                lastDurationMs:
                  data.durationMs ??
                  (agent.runStartedAt
                    ? Math.max(0, Date.now() - new Date(agent.runStartedAt).getTime())
                    : agent.lastDurationMs),
                completedRuns: agent.completedRuns + 1,
                updatedAt: new Date().toISOString(),
              }
              updateAgent(agent.id, completedAgent)
              addEvent('Codex-Ergebnis empfangen', `${agent.name} ist fertig.`)
              if (autoRun && agent.autoForward) {
                await handoff(completedAgent)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Connector nicht erreichbar.'
              if (
                message.includes('lokalen Historie nicht gefunden') ||
                message.includes('thread not found')
              ) {
                updateAgent(agent.id, {
                  status: 'rueckfrage',
                  pendingTurnId: '',
                  runStartedAt: '',
                  lastCompletedTurnId: agent.pendingTurnId,
                })
              }
              addEvent(
                'Ergebnisabfrage fehlgeschlagen',
                `${agent.name}: ${message}`,
              )
            } finally {
              pollingTurnIds.current.delete(agent.pendingTurnId)
            }
          }),
      )
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => window.clearInterval(timer)
  }, [addEvent, agents, autoRun, handoff, updateAgent])

  useEffect(() => {
    if (!autoRun) return

    const dispatchManagementReviews = async () => {
      const now = Date.now()
      const managers = agents.filter((agent) => {
        if (
          agent.assignment !== 'management' ||
          !agent.monitoringEnabled ||
          !agent.threadId ||
          agent.pendingTurnId ||
          agent.status === 'laeuft' ||
          managementDispatchIds.current.has(agent.id) ||
          !samePath(agent.projectPath, selectedProject?.path ?? '')
        ) {
          return false
        }
        const lastRun = new Date(agent.lastMonitoringAt).getTime()
        const intervalMs = Math.max(1, agent.monitoringIntervalMinutes) * 60_000
        return !Number.isFinite(lastRun) || lastRun + intervalMs <= now
      })

      await Promise.all(managers.map(async (manager) => {
        const monitoredAgents = agents.filter((agent) =>
          manager.monitoredAgentIds.includes(agent.id) &&
          agent.id !== manager.id &&
          samePath(agent.projectPath, manager.projectPath),
        )
        if (monitoredAgents.length === 0) return

        managementDispatchIds.current.add(manager.id)
        setAgentTransmission(manager.id, true)
        const dispatchedAt = new Date().toISOString()
        updateAgent(manager.id, { lastMonitoringAt: dispatchedAt })
        try {
          const message = buildMonitoringMessage(
            manager,
            monitoredAgents,
            workflowStatusesForAgent(manager, workflowStatuses),
          )
          const response = await fetch(`/api/threads/${encodeURIComponent(manager.threadId)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message, model: manager.model || undefined }),
          })
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Agentenüberwachung konnte nicht gesendet werden.')
          }
          applyThreadReplacement(manager, data.replacementThread)
          updateAgent(manager.id, {
            status: 'laeuft',
            runStartedAt: dispatchedAt,
            pendingTurnId: data.turn?.id ?? '',
            lastMonitoringAt: dispatchedAt,
          })
          addEvent(
            'Agentenüberwachung ausgeführt',
            `${manager.name} → ${monitoredAgents.map((agent) => agent.name).join(', ')}`,
          )
        } catch (error) {
          addEvent(
            'Agentenüberwachung fehlgeschlagen',
            `${manager.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
          )
        } finally {
          setAgentTransmission(manager.id, false)
          managementDispatchIds.current.delete(manager.id)
        }
      }))
    }

    void dispatchManagementReviews()
    const timer = window.setInterval(() => void dispatchManagementReviews(), 10_000)
    return () => window.clearInterval(timer)
  }, [addEvent, agents, applyThreadReplacement, autoRun, selectedProject?.path, setAgentTransmission, updateAgent, workflowStatuses])

  useEffect(() => {
    if (!autoRun) return

    const dispatchDueTimers = async () => {
      const now = Date.now()
      const dueTimers = workflowTimers.filter((timer) =>
        timer.enabled &&
        samePath(timer.projectPath, selectedProject?.path ?? '') &&
        Boolean(timer.nextRunAt || timer.startAt) &&
        new Date(timer.nextRunAt || timer.startAt).getTime() <= now &&
        !timerDispatchIds.current.has(timer.id),
      )

      await Promise.all(dueTimers.map(async (timer) => {
        const targetAgents = routes
          .filter((route) => route.ownerAgentId === timer.ownerAgentId && route.sourceId === timer.id)
          .map((route) => agents.find((agent) => agent.id === route.targetId))
          .filter((agent): agent is Agent => Boolean(agent))

        if (targetAgents.some((agent) => agent.status === 'laeuft' || agent.pendingTurnId)) return

        timerDispatchIds.current.add(timer.id)
        const firedAt = new Date().toISOString()
        const advanceTimer = (success: boolean) => {
          setWorkflowTimers((current) => current.map((item) => {
            if (item.id !== timer.id) return item
            if (!success) {
              return { ...item, nextRunAt: new Date(Date.now() + 60_000).toISOString() }
            }
            if (item.schedule === 'once' || item.recurring === false) {
              return { ...item, enabled: false, lastRunAt: firedAt, nextRunAt: '' }
            }
            return { ...item, lastRunAt: firedAt, nextRunAt: nextTimerRun(item) }
          }))
        }

        if (targetAgents.length === 0) {
          advanceTimer(true)
          addEvent('Zeitplan ohne Ziel', `${timer.name} ist mit keinem Agenten verbunden.`)
          timerDispatchIds.current.delete(timer.id)
          return
        }

        try {
          await Promise.all(targetAgents.map(async (target) => {
            if (!target.threadId) throw new Error(`${target.name} ist mit keinem Codex-Chat verknüpft.`)
            const message = [
              `Zeitgesteuerte Aufgabe: ${timer.name}`,
              '',
              timer.task,
              '',
              'Bearbeite diese Aufgabe selbst anhand deines Projektkontexts. Die weitere Übergabe übernimmt ausschließlich der Workflow-Orchestrator.',
              workflowStatusInstruction(workflowStatusesForAgent(target, workflowStatuses)),
            ].join('\n')
            const response = await fetch(`/api/threads/${encodeURIComponent(target.threadId)}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: message, model: target.model || undefined }),
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Zeitgesteuerte Aufgabe konnte nicht gesendet werden.')
            applyThreadReplacement(target, data.replacementThread)
            updateAgent(target.id, {
              status: 'laeuft',
              runStartedAt: firedAt,
              pendingTurnId: data.turn?.id ?? '',
            })
          }))
          advanceTimer(true)
          addEvent('Zeitplan ausgeführt', `${timer.name} → ${targetAgents.map((agent) => agent.name).join(', ')}`)
        } catch (error) {
          advanceTimer(false)
          addEvent('Zeitplan fehlgeschlagen', error instanceof Error ? error.message : 'Connector nicht erreichbar.')
        } finally {
          timerDispatchIds.current.delete(timer.id)
        }
      }))
    }

    void dispatchDueTimers()
    const timer = window.setInterval(() => void dispatchDueTimers(), 10_000)
    return () => window.clearInterval(timer)
  }, [addEvent, agents, applyThreadReplacement, autoRun, routes, selectedProject?.path, updateAgent, workflowStatuses, workflowTimers])

  const startInitialWorkflows = useCallback(async () => {
    const activeProjectPath = selectedProject?.path ?? ''
    const starts = workflowInitials.filter((initial) =>
      samePath(initial.projectPath, activeProjectPath),
    )
    const deliveries = starts.flatMap((initial) =>
      routes
        .filter(
          (route) =>
            route.ownerAgentId === initial.ownerAgentId &&
            route.sourceId === initial.id,
        )
        .flatMap((route) => {
          const target = agents.find((agent) => agent.id === route.targetId)
          const owner = agents.find((agent) => agent.id === initial.ownerAgentId)
          return target ? [{ initial, owner, target }] : []
        }),
    )

    if (deliveries.length === 0) {
      addEvent(
        'Automatik ohne Initial gestartet',
        'In diesem Projekt ist kein Initial-Baustein mit einem Agenten verbunden.',
      )
      return
    }

    await Promise.all(
      deliveries.map(async ({ initial, owner, target }) => {
        if (!target.threadId) {
          addEvent(
            'Initial-Anfrage nicht gesendet',
            `${target.name} ist mit keinem Codex-Chat verknüpft.`,
          )
          return
        }

        const message = [
          `Initial-Anfrage von ${owner?.name ?? 'Workflow-Orchestrator'}`,
          '',
          initial.instruction,
          '',
          'Bearbeite diese Anfrage selbst anhand deines Projektkontexts. Kontaktiere keine anderen Codex-Chats; die Weitergabe übernimmt ausschließlich der Workflow-Orchestrator.',
          '',
          owner
            ? `Antworte mit dem aktuellen Stand so, dass ${owner.name} den nächsten Schritt bestimmen kann.`
            : 'Antworte mit dem aktuellen Projektstand und dem sinnvollsten nächsten Schritt.',
          workflowStatusInstruction(workflowStatusesForAgent(target, workflowStatuses)),
        ].join('\n')

        try {
          const response = await fetch(
            `/api/threads/${encodeURIComponent(target.threadId)}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: message, model: target.model || undefined }),
            },
          )
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Initial-Anfrage konnte nicht gesendet werden.')
          }
          applyThreadReplacement(target, data.replacementThread)
          updateAgent(target.id, {
            status: 'laeuft',
            runStartedAt: new Date().toISOString(),
            pendingTurnId: data.turn?.id ?? '',
          })
          addEvent(
            'Initial-Anfrage gesendet',
            `${initial.name} → ${target.name}`,
          )
        } catch (error) {
          addEvent(
            'Initial-Anfrage nicht gesendet',
            `${target.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
          )
        }
      }),
    )
  }, [addEvent, agents, applyThreadReplacement, routes, selectedProject?.path, updateAgent, workflowInitials, workflowStatuses])

  const toggleAutomation = () => {
    if (autoRun) {
      sharedStateDirty.current = true
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      addEvent('Automatik gestoppt', 'Weitere fertige Ergebnisse werden nicht automatisch weitergegeben.')
      return
    }
    sharedStateDirty.current = true
    autoRunRef.current = true
    setAutoRun(true)
    addEvent('Automatik gestartet', 'Initial-Anfragen und automatische Weitergaben sind aktiviert.')
    void startInitialWorkflows()
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <h1>Codex Workflow Orchestrator</h1>
        </div>
        <div className="topActions">
          <div
            className="usageSummary"
            title={
              usageSummary.resetsAt
                ? tx(
                    `Wochenlimit wird am ${new Date(usageSummary.resetsAt * 1000).toLocaleString('de-DE')} zurückgesetzt.`,
                    `Weekly limit resets on ${new Date(usageSummary.resetsAt * 1000).toLocaleString('en-US')}.`,
                  )
                : tx('Verbleibendes Codex-Wochenlimit', 'Remaining Codex weekly limit')
            }
          >
            <small>{copy.week}</small>
            <strong>
              {usageSummary.remainingPercent === null
                ? '–'
                : `${usageSummary.remainingPercent} ${copy.free}`}
            </strong>
            {(usageSummary.unlimited || usageSummary.credits) && (
              <small>
                {usageSummary.unlimited ? copy.unlimited : `${copy.credit} ${usageSummary.credits}`}
              </small>
            )}
          </div>
          <button className={autoRun ? 'danger' : ''} onClick={toggleAutomation}>
            {autoRun ? copy.stop : copy.start}
          </button>
        </div>
      </section>

      {agentCreationOpen && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => !agentCreationBusy && setAgentCreationOpen(false)}
        >
          <section
            className="promptModal agentCreationModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Agent erstellen', 'Create agent')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Codex Agent</p>
                <h2>{tx('Agent erstellen', 'Create agent')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                disabled={agentCreationBusy}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setAgentCreationOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              {tx('Erstellt einen Codex-Chat im Projekt', 'Creates a Codex chat in project')} „{selectedProject?.label ?? tx('Kein Projekt', 'No project')}“.
              {' '}{tx('Der Agent wird nicht automatisch mit dem Workflow verbunden.', 'The agent is not connected to the workflow automatically.')}
            </p>
            <label>
              Name
              <input
                autoFocus
                disabled={agentCreationBusy}
                onChange={(event) => setNewAgentName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createAgent()
                  }
                }}
                placeholder={tx('Zum Beispiel: Prompt-Architekt', 'For example: Prompt Architect')}
                value={newAgentName}
              />
            </label>
            {agentCreationError && <p className="formError">{agentCreationError}</p>}
            <div className="modalActions">
              <button disabled={agentCreationBusy} onClick={() => setAgentCreationOpen(false)}>{tx('Abbrechen', 'Cancel')}</button>
              <button
                className="primary"
                disabled={!newAgentName.trim() || agentCreationBusy}
                onClick={() => void createAgent()}
              >
                {agentCreationBusy ? tx('Erstelle…', 'Creating…') : tx('Erstellen', 'Create')}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="codexBrowser">
        <div>
          <p className="eyebrow">{copy.projects}</p>
          <div className="codexPicker">
            <label>
              {copy.project}
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                {codexProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.label}</option>
                ))}
              </select>
            </label>
            <details className="threadManager">
              <summary>{copy.manageChats}</summary>
              <div className="threadOptions">
                {visibleThreads.length === 0 && <p>{copy.noChats}</p>}
                {visibleThreads.map((thread) => {
                  const isVisible = !hiddenThreadIds.includes(thread.id)
                  return (
                    <label className="threadOption" key={thread.id}>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={(event) => setThreadVisibility(thread, event.target.checked)}
                      />
                      <span>
                        <strong>{thread.title}</strong>
                        <small>{thread.status}</small>
                      </span>
                    </label>
                  )
                })}
              </div>
            </details>
            <button
              className="projectStatusButton"
              onClick={() => setStatusLibraryOpen(true)}
              title={tx('Projektweite Status konfigurieren', 'Configure project statuses')}
              type="button"
            >
              {tx('Status-Setup', 'Status setup')}
            </button>
          </div>
        </div>
        <div className={`connectorState ${connectorOnline ? 'online' : 'offline'}`}>
          <div className="connectorCopy">
            <strong>{connectorOnline ? copy.online : copy.offline}</strong>
            <div className="connectorMeta">
              <span className="stateDot" />
              <small>
                {connectorOnline
                  ? `${codexProjects.length} ${tx('Projekte', 'projects')}, ${codexThreads.length} ${tx('Tasks', 'tasks')} · ${lastSyncedAt}`
                  : copy.liveSync}
              </small>
            </div>
          </div>
          <div className="languageSwitch" aria-label={tx('Sprache', 'Language')}>
            <button
              className={language === 'en' ? 'active' : ''}
              aria-pressed={language === 'en'}
              onClick={() => setLanguage('en')}
              title="English"
            >
              EN
            </button>
            <span aria-hidden="true">|</span>
            <button
              className={language === 'de' ? 'active' : ''}
              aria-pressed={language === 'de'}
              onClick={() => setLanguage('de')}
              title="Deutsch"
            >
              DE
            </button>
          </div>
        </div>
      </section>

      <section className={`layout ${eventLogCollapsed ? 'eventLogCollapsed' : ''}`}>
        <aside className="agentRail">
          <div className="railHeader">
            <div className="railHeaderTitle">
              <strong>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</strong>
              <small>{projectAgents.length} {tx('Agenten', 'agents')}</small>
            </div>
            <button
              className="railAddAgent"
              disabled={autoRun}
              title={autoRun
                ? tx('Agenten können nur bei Auto Stop erstellt werden.', 'Agents can only be created while Auto Stop is active.')
                : tx('Agent im aktuellen Projekt erstellen', 'Create agent in current project')}
              onClick={() => {
                setAgentCreationError('')
                setNewAgentName('')
                setAgentCreationOpen(true)
              }}
            >
              + {tx('Agent', 'Agent')}
            </button>
          </div>
          {projectAgents.length === 0 && (
            <p className="empty railEmpty">{tx('Keine sichtbaren Chats oder Agenten in diesem Projekt.', 'No visible chats or agents in this project.')}</p>
          )}
          {projectAgents.length > 0 && (
            <div
              className={`agentEdgeDropZone start ${dropEdge === 'start' ? 'active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(null)
                setDropEdge('start')
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain') || draggedAgentId
                if (sourceId) {
                  reorderAgentToEdge(sourceId, 'start')
                }
              }}
            />
          )}
          {projectAgents.map((agent) => (
            <div
              className={`agentDropTarget ${dropTarget?.id === agent.id ? `drop-${dropTarget.position}` : ''}`}
              key={agent.id}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (agent.id === draggedAgentId) {
                  setDropTarget(null)
                  setDropEdge(null)
                  return
                }
                setDropEdge(null)
                const bounds = event.currentTarget.getBoundingClientRect()
                const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                setDropTarget((current) =>
                  current?.id === agent.id && current.position === position
                    ? current
                    : { id: agent.id, position },
                )
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain') || draggedAgentId
                if (sourceId && sourceId !== agent.id) {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                  reorderAgent(sourceId, agent.id, position)
                }
              }}
            >
              <button
                className={`agentButton ${agent.id === selectedAgent?.id ? 'active' : ''} ${agent.id === draggedAgentId ? 'dragging' : ''} ${isAgentBusy(agent) ? 'working' : ''}`}
                draggable
                onClick={() => {
                  setSelectedId(agent.id)
                  setSetupOpen(false)
                  setPromptEditorOpen(false)
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('application/x-codex-agent', agent.id)
                  event.dataTransfer.setData('text/plain', agent.id)
                  setDraggedAgentId(agent.id)
                  setDropTarget(null)
                  setDropEdge(null)
                }}
                onDragEnd={() => {
                  setDraggedAgentId('')
                  setDropTarget(null)
                  setDropEdge(null)
                }}
                title={tx('Zum Sortieren ziehen', 'Drag to reorder')}
              >
                <span className="agentName">
                  {isAgentBusy(agent) && <span className="activitySpinner" aria-label={tx('Agent arbeitet', 'Agent is working')} role="status" />}
                  <span>{agent.name}</span>
                </span>
                <small className={isAgentBusy(agent) ? 'workingLabel' : ''}>
                  {isAgentBusy(agent) ? tx('Aktiv', 'Active') : statusLabels[language][agent.status]}
                </small>
              </button>
            </div>
          ))}
          {projectAgents.length > 0 && (
            <div
              className={`agentEdgeDropZone end ${dropEdge === 'end' ? 'active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(null)
                setDropEdge('end')
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain') || draggedAgentId
                if (sourceId) {
                  reorderAgentToEdge(sourceId, 'end')
                }
              }}
            />
          )}
        </aside>

        {selectedAgent ? (
          <section className="workspace">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{setupOpen ? tx('Agentenprofil', 'Agent profile') : tx('Agenten-Chat', 'Agent chat')}</p>
                <h2>{selectedAgent.name}</h2>
              </div>
              <div className="agentStatusSummary">
                {isAgentBusy(selectedAgent) && (
                  <span className="agentWorking" role="status">
                    <span className="activitySpinner" aria-hidden="true" />
                    {tx('Arbeitet', 'Working')}
                  </span>
                )}
                <span className="responseTime">
                  {tx('Dauer', 'Duration')}: {formatDuration(selectedAgent.lastDurationMs, language)}
                </span>
                <span className={`status ${selectedAgent.status}`}>{statusLabels[language][selectedAgent.status]}</span>
                <span className="setupControl">
                  <button
                    aria-label={tx('Workflow-Dashboard öffnen', 'Open workflow dashboard')}
                    className={`setupToggle dashboardToggle ${dashboardOpen ? 'active' : ''}`}
                    onClick={() => setDashboardOpen(true)}
                    title={tx('Workflow-Dashboard öffnen', 'Open workflow dashboard')}
                    type="button"
                  >
                    D
                  </button>
                  <button
                    aria-label={tx('Prompt-Dateien öffnen', 'Open prompt files')}
                    className={`setupToggle promptToggle ${promptEditorOpen ? 'active' : ''}`}
                    onClick={() => setPromptEditorOpen(true)}
                    title={tx('Prompt-Dateien öffnen', 'Open prompt files')}
                    type="button"
                  >
                    P
                  </button>
                  <button
                    aria-label={setupOpen ? tx('Setup schließen', 'Close setup') : tx('Setup öffnen', 'Open setup')}
                    className={`setupToggle ${setupOpen ? 'active' : ''}`}
                    onClick={() => setSetupOpen((current) => !current)}
                    title={setupOpen ? tx('Setup schließen', 'Close setup') : tx('Setup öffnen', 'Open setup')}
                    type="button"
                  >
                    ⚙
                  </button>
                </span>
              </div>
            </div>

            {setupOpen ? (
              <>
            <div className="grid">
              <label>
                Name
                <input
                  value={selectedAgent.name}
                  onChange={(event) => updateAgent(selectedAgent.id, { name: event.target.value })}
                  onBlur={() => void renameCodexThread(selectedAgent)}
                />
              </label>
              <label>
                {tx('Rolle', 'Role')}
                <input value={selectedAgent.role} onChange={(event) => updateAgent(selectedAgent.id, { role: event.target.value })} />
              </label>
              <label>
                {tx('Modell', 'Model')}
                <select
                  value={selectedAgent.model}
                  onChange={(event) => updateAgent(selectedAgent.id, { model: event.target.value })}
                >
                  <option value="">{tx('Codex-Standard', 'Codex default')}</option>
                  {codexModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}{model.isDefault ? tx(' (Standard)', ' (Default)') : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="agentStatusField">
                <span>{tx('Statuseinstellung', 'Status settings')}</span>
                <details className="promptStatusMenu agentStatusMenu">
                  <summary title={tx('Workflow-Status für diesen Agenten auswählen', 'Select workflow statuses for this agent')}>
                    <span>Workflow-Status</span>
                    <small>
                      {selectedAgent.workflowStatusIds === null
                        ? tx('Alle Projektstatus', 'All project statuses')
                        : `${workflowStatusesForAgent(selectedAgent, workflowStatuses).length} ${tx('ausgewählt', 'selected')}`}
                    </small>
                  </summary>
                  <div className="promptStatusOptions">
                    <p>{tx(
                      'Diese Status werden dem Agenten bei Workflow-Aufgaben erklärt und gelten für alle seine Prompt-Dateien.',
                      'These statuses are explained to the agent for workflow tasks and apply to all of its prompt files.',
                    )}</p>
                    {projectWorkflowStatuses.length === 0 ? (
                      <span className="empty">{tx('Im Projekt sind noch keine Status angelegt.', 'No statuses have been created in this project.')}</span>
                    ) : (
                      projectWorkflowStatuses.map((status) => {
                        const enabled = selectedAgent.workflowStatusIds === null ||
                          selectedAgent.workflowStatusIds.includes(status.id)
                        return (
                          <label className="promptStatusOption" key={status.id}>
                            <input
                              checked={enabled}
                              onChange={(event) =>
                                setAgentWorkflowStatusEnabled(selectedAgent, status.id, event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>{status.name}</strong>
                              <small>{status.description || tx('Keine Bedeutung hinterlegt.', 'No meaning provided.')}</small>
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </details>
              </div>
            </div>

            <section className={`managementControl ${selectedAgent.assignment === 'management' ? 'enabled' : ''}`}>
              <div className="managementHeader">
                <div>
                  <p className="eyebrow">{tx('Agenten-Zuweisung', 'Agent assignment')}</p>
                  <strong>{tx('Verwaltungs-Erweiterung', 'Management extension')}</strong>
                </div>
                <label>
                  {tx('Einteilung', 'Assignment')}
                  <select
                    value={selectedAgent.assignment}
                    onChange={(event) => updateAgent(selectedAgent.id, {
                      assignment: event.target.value as AgentAssignment,
                      monitoringEnabled: event.target.value === 'management'
                        ? selectedAgent.monitoringEnabled
                        : false,
                      teamProvisioningEnabled: event.target.value === 'management'
                        ? selectedAgent.teamProvisioningEnabled
                        : false,
                    })}
                  >
                    <option value="agent">{tx('Agent', 'Agent')}</option>
                    <option value="management">{tx('Verwaltung', 'Management')}</option>
                  </select>
                </label>
              </div>

              {selectedAgent.assignment === 'management' && (
                <div className="managementSettings">
                  <div className="managementMonitorHeader">
                    <div>
                      <strong>{tx('Agentenüberwachung', 'Agent monitoring')}</strong>
                      <small>{tx(
                        'Der Verwaltungsagent prüft den Stand der ausgewählten Agenten während der Automatik.',
                        'The management agent reviews the selected agents while automation is running.',
                      )}</small>
                    </div>
                    <label className="checkbox managementEnabledToggle">
                      <input
                        checked={selectedAgent.monitoringEnabled}
                        type="checkbox"
                        onChange={(event) => updateAgent(selectedAgent.id, { monitoringEnabled: event.target.checked })}
                      />
                      {tx('Aktiv', 'Active')}
                    </label>
                  </div>

                  <div className="managementMonitorGrid">
                    <div className="managedAgentSelection">
                      <span>{tx('Agenten auswählen', 'Select agents')}</span>
                      <div className="managedAgentOptions">
                        {projectAgents.filter((agent) => agent.id !== selectedAgent.id).length === 0 ? (
                          <small className="empty">{tx('Keine weiteren Agenten im Projekt.', 'No other agents in this project.')}</small>
                        ) : projectAgents
                          .filter((agent) => agent.id !== selectedAgent.id)
                          .map((agent) => (
                            <label className="managedAgentOption" key={agent.id}>
                              <input
                                checked={selectedAgent.monitoredAgentIds.includes(agent.id)}
                                type="checkbox"
                                onChange={(event) => updateAgent(selectedAgent.id, {
                                  monitoredAgentIds: event.target.checked
                                    ? Array.from(new Set([...selectedAgent.monitoredAgentIds, agent.id]))
                                    : selectedAgent.monitoredAgentIds.filter((id) => id !== agent.id),
                                })}
                              />
                              <span>
                                <strong>{agent.name}</strong>
                                <small>{agent.role}</small>
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                    <label>
                      {tx('Prüfintervall', 'Review interval')}
                      <span className="managementIntervalInput">
                        <input
                          min="1"
                          step="1"
                          type="number"
                          value={selectedAgent.monitoringIntervalMinutes}
                          onChange={(event) => updateAgent(selectedAgent.id, {
                            monitoringIntervalMinutes: Math.max(1, Number(event.target.value) || 1),
                          })}
                        />
                        <span>{tx('Minuten', 'minutes')}</span>
                      </span>
                    </label>
                  </div>

                  <section className="managementTeamBuilder">
                    <div className="managementTeamHeader">
                      <div>
                        <strong>{tx('Kontrollierter Team-Aufbau', 'Controlled team creation')}</strong>
                        <small>{tx(
                          'Der Verwaltungsagent darf einen geprüften Team-Vorschlag liefern. Die Übernahme erfolgt nur durch den Benutzer bei Auto Stop.',
                          'The management agent may provide a validated team proposal. Only the user can apply it while Auto Stop is active.',
                        )}</small>
                      </div>
                      <label className="checkbox managementEnabledToggle">
                        <input
                          checked={selectedAgent.teamProvisioningEnabled}
                          disabled={autoRun}
                          type="checkbox"
                          onChange={(event) => {
                            setTeamPlanError('')
                            updateAgent(selectedAgent.id, { teamProvisioningEnabled: event.target.checked })
                          }}
                        />
                        {tx('Erlaubt', 'Enabled')}
                      </label>
                    </div>

                    {autoRun && (
                      <p className="managementOfflineNotice">{tx(
                        'Gesperrt: Team- und Agentenerstellung ist nur bei Auto Stop möglich.',
                        'Locked: teams and agents can only be created while Auto Stop is active.',
                      )}</p>
                    )}

                    {selectedAgent.teamProvisioningEnabled && selectedTeamPlan && (
                      <div className="managementTeamPlan">
                        <div className="managementTeamPlanTitle">
                          <div>
                            <span>{tx('Geprüfter Vorschlag', 'Validated proposal')}</span>
                            <strong>{selectedTeamPlan.plan.projectGoal || tx('Team für das aktuelle Projekt', 'Team for the current project')}</strong>
                          </div>
                          <small>{selectedTeamPlan.plan.agents.length} {tx('Agenten', 'agents')} · {selectedTeamPlan.plan.connections.length} {tx('Verbindungen', 'connections')}</small>
                        </div>
                        <div className="managementTeamAgents">
                          {selectedTeamPlan.plan.agents.map((agent) => (
                            <article key={agent.name}>
                              <strong>{agent.name}</strong>
                              <span>{agent.role}</span>
                            </article>
                          ))}
                        </div>
                        {teamPlanError && <p className="formError">{teamPlanError}</p>}
                        <div className="managementTeamActions">
                          <small>{tx(
                            'Erstellt fehlende Codex-Chats, speichert Prompt-Dateien und übernimmt Verbindungen. Die Automatik bleibt aus.',
                            'Creates missing Codex chats, saves prompt files, and applies connections. Automation remains off.',
                          )}</small>
                          <button
                            className="primary"
                            disabled={autoRun || teamPlanApplying || selectedTeamPlan.signature === selectedAgent.lastAppliedTeamPlanSignature}
                            onClick={() => void applyManagementTeamPlan(selectedAgent)}
                          >
                            {teamPlanApplying
                              ? tx('Team wird erstellt…', 'Creating team…')
                              : selectedTeamPlan.signature === selectedAgent.lastAppliedTeamPlanSignature
                                ? tx('Bereits übernommen', 'Already applied')
                                : tx('Team übernehmen', 'Apply team')}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedAgent.teamProvisioningEnabled && selectedTeamPlanMalformed && (
                      <p className="formError">{tx(
                        'Der Team-Vorschlag enthält kein gültiges Orchestrator-Format. Bitte den Verwaltungsagenten um eine korrigierte Ausgabe.',
                        'The team proposal does not contain a valid orchestrator format. Ask the management agent for a corrected response.',
                      )}</p>
                    )}
                  </section>
                </div>
              )}
            </section>

            <section className="autoForwardControl" aria-label={tx('Automatische Weitergabe', 'Automatic forwarding')}>
              <div>
                <p className="eyebrow">{tx('Workflow-Funktion', 'Workflow function')}</p>
                <strong>{tx('Automatisch weitergeben', 'Forward automatically')}</strong>
              </div>
              <label className="checkbox">
                <input
                  checked={selectedAgent.autoForward}
                  type="checkbox"
                  onChange={(event) => updateAgent(selectedAgent.id, { autoForward: event.target.checked })}
                />
                {tx('Aktiv', 'Active')}
              </label>
            </section>

            <div className="adapter">
              <strong>Codex Adapter</strong>
              <p>
                {tx(
                  'Der lokale Connector synchronisiert Projekte und Tasks, erstellt neue Codex-Chats, übernimmt Umbenennungen, sendet Rollen-Anweisungen und archiviert gelöschte Agenten. Ergebnisse werden bis zum Abschluss überwacht und gemäß der Verdrahtung automatisch an den nächsten Agenten übergeben.',
                  'The local connector synchronizes projects and tasks, creates Codex chats, applies renames, sends role instructions, and archives deleted agents. Results are monitored until completion and forwarded automatically according to the workflow wiring.',
                )}
              </p>
            </div>
            <div className="adapterDeleteAction">
              <button
                className="deleteButton"
                disabled={deletingAgentId === selectedAgent.id}
                onClick={() => void deleteAgent(selectedAgent)}
              >
                {deletingAgentId === selectedAgent.id ? tx('Wird archiviert…', 'Archiving…') : tx('Agent löschen', 'Delete agent')}
              </button>
            </div>
              </>
            ) : (
              <section className="agentChat" aria-label={`${tx('Chat von', 'Chat of')} ${selectedAgent.name}`}>
                <div className="chatHeader">
                  <div>
                    <strong>Codex-Chat</strong>
                    <small>{selectedAgent.threadTitle || selectedAgent.name}</small>
                  </div>
                  <span className={`liveIndicator ${isAgentBusy(selectedAgent) ? 'active' : ''}`}>
                    {isAgentBusy(selectedAgent) && <span className="activitySpinner" aria-hidden="true" />}
                    {isAgentBusy(selectedAgent) ? tx('Antwort wird erstellt', 'Generating response') : tx('Aktuell', 'Current')}
                  </span>
                </div>
                <div className="chatBody">
                  <div
                    className="chatStream"
                    ref={chatStreamRef}
                    onScroll={(event) => {
                      const stream = event.currentTarget
                      const distanceToBottom =
                        stream.scrollHeight - stream.scrollTop - stream.clientHeight
                      setChatPinnedToBottom(distanceToBottom < 48)
                    }}
                  >
                    {chatError && <p className="chatError">{chatError}</p>}
                    {!chatError && chatMessages.length === 0 && (
                      <p className="empty">{tx('Noch keine Nachrichten in diesem Chat.', 'No messages in this chat yet.')}</p>
                    )}
                    {chatMessages.map((message) => {
                      const identity = chatMessageIdentity(message, selectedAgent.name, language)
                      return (
                        <article className={`chatMessage ${message.role}`} key={`${message.turnId}:${message.id}`}>
                          <div className="chatMessageMeta">
                            <strong>{identity.name}</strong>
                            <small>{identity.label}</small>
                          </div>
                          <p>{message.text}</p>
                        </article>
                      )
                    })}
                  </div>
                  {!chatPinnedToBottom && (
                    <button
                      aria-label={tx('Zur neuesten Nachricht', 'Jump to latest message')}
                      className="jumpToLatest"
                      onClick={() => {
                        const stream = chatStreamRef.current
                        if (stream) {
                          stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' })
                        }
                        setChatPinnedToBottom(true)
                      }}
                      title={tx('Zur neuesten Nachricht', 'Jump to latest message')}
                    >
                      ↓
                    </button>
                  )}
                </div>
                <form
                  className="chatComposer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void sendChatMessage(selectedAgent)
                  }}
                >
                  <textarea
                    aria-label={tx('Nachricht an Agent', 'Message to agent')}
                    disabled={!selectedAgent.threadId || chatSending}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void sendChatMessage(selectedAgent)
                      }
                    }}
                    placeholder={tx('Anweisung eingeben…', 'Enter instruction…')}
                    rows={2}
                    value={chatDraft}
                  />
                  <button
                    aria-label={tx('Nachricht senden', 'Send message')}
                    className="sendChatButton"
                    disabled={!chatDraft.trim() || !selectedAgent.threadId || chatSending}
                    title={tx('Nachricht senden', 'Send message')}
                    type="submit"
                  >
                    {chatSending ? '…' : '↑'}
                  </button>
                </form>
              </section>
            )}
          </section>
        ) : (
          <section className="workspace emptyWorkspace" aria-label={tx('Leerer Agenten-Chat', 'Empty agent chat')}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{tx('Agenten-Chat', 'Agent chat')}</p>
                <h2>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</h2>
              </div>
            </div>
            <section className="agentChat emptyAgentChat">
              <div className="chatHeader">
                <div>
                  <strong>Codex-Chat</strong>
                  <small>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</small>
                </div>
                <span className="liveIndicator">{tx('Bereit', 'Ready')}</span>
              </div>
              <div className="emptyChatBody">
                <p>{tx('Noch kein Agent vorhanden.', 'No agent available yet.')}</p>
              </div>
            </section>
          </section>
        )}

        <aside className={`eventLog ${eventLogCollapsed ? 'collapsed' : ''}`}>
          <div className="eventLogHeader">
            <button
              aria-label={eventLogCollapsed ? tx('Ablaufprotokoll einblenden', 'Show activity log') : tx('Ablaufprotokoll nach rechts einklappen', 'Collapse activity log to the right')}
              className="eventLogToggle"
              onClick={() => setEventLogCollapsed((current) => !current)}
              title={eventLogCollapsed ? tx('Ablaufprotokoll einblenden', 'Show activity log') : tx('Ablaufprotokoll nach rechts einklappen', 'Collapse activity log to the right')}
              type="button"
            >
              {eventLogCollapsed ? '‹' : '›'}
            </button>
          </div>
          <div className="eventLogContent">
            <p className="eyebrow">{tx('Rollenfluss', 'Role flow')}</p>
            <CollapsibleText text={graphEdges} limit={700} monospace language={language} />
            <p className="eyebrow">{tx('Ablaufprotokoll', 'Activity log')}</p>
            {events.length === 0 && <p className="empty">{tx('Noch keine Orchestrator-Aktion.', 'No orchestrator activity yet.')}</p>}
            {events.map((event) => (
              <article key={event.id}>
                <time>{event.at}</time>
                <strong>{eventTitleText(event.title, language)}</strong>
                <CollapsibleText text={eventDetailText(event.detail, language)} limit={320} language={language} />
              </article>
            ))}
          </div>
        </aside>
      </section>

      {statusLibraryOpen && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setStatusLibraryOpen(false)}
        >
          <section
            aria-label={tx('Projektweite Status konfigurieren', 'Configure project statuses')}
            aria-modal="true"
            className="promptModal statusLibraryModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Status</p>
                <h2>{tx('Status Setup', 'Status Setup')}</h2>
              </div>
              <button
                aria-label={tx('Status-Fenster schließen', 'Close status window')}
                onClick={() => setStatusLibraryOpen(false)}
                title={tx('Status-Fenster schließen', 'Close status window')}
                type="button"
              >
                ×
              </button>
            </div>
            <section className="workflowStatusLibrary" aria-label={tx('Workflow-Status', 'Workflow statuses')}>
              <div className="workflowStatusHeader">
                <div>
                  <strong>{tx('Statusliste', 'Status list')}</strong>
                  <small>{tx('Namen und Bedeutungen gelten für das ausgewählte Projekt.', 'Names and meanings apply to the selected project.')}</small>
                </div>
                <small>{projectWorkflowStatuses.length} {tx('Status', 'statuses')}</small>
              </div>
              <div className="workflowStatusCreate">
                <input
                  aria-label={tx('Name des Workflow-Status', 'Workflow status name')}
                  onChange={(event) => setNewWorkflowStatusName(event.target.value)}
                  placeholder={tx('Statusname', 'Status name')}
                  value={newWorkflowStatusName}
                />
                <input
                  aria-label={tx('Beschreibung des Workflow-Status', 'Workflow status description')}
                  onChange={(event) => setNewWorkflowStatusDescription(event.target.value)}
                  placeholder={tx('Bedeutung', 'Meaning')}
                  value={newWorkflowStatusDescription}
                />
                <button onClick={addWorkflowStatus} type="button">{tx('Hinzufügen', 'Add')}</button>
              </div>
              {projectWorkflowStatuses.length === 0 ? (
                <p className="empty">{tx('Für dieses Projekt wurden noch keine Status angelegt.', 'No statuses have been created for this project.')}</p>
              ) : (
                <div className="workflowStatusList">
                  {projectWorkflowStatuses.map((status) => (
                    <div className="workflowStatusItem" key={status.id}>
                      <strong>{status.name}</strong>
                      <span>{status.description || tx('Keine Beschreibung', 'No description')}</span>
                      <div className="workflowStatusActions">
                        <button
                          aria-label={`${tx('Status bearbeiten', 'Edit status')}: ${status.name}`}
                          className="editStatus"
                          onClick={() => openWorkflowStatusEditor(status)}
                          title={tx('Status bearbeiten', 'Edit status')}
                          type="button"
                        >
                          ✎
                        </button>
                        <button
                          aria-label={`${tx('Status löschen', 'Delete status')}: ${status.name}`}
                          className="deleteStatus"
                          onClick={() => deleteWorkflowStatus(status.id)}
                          title={tx('Status löschen', 'Delete status')}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      )}

      {editingWorkflowStatus && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={closeWorkflowStatusEditor}
        >
          <section
            className="promptModal statusDescriptionModal"
            role="dialog"
            aria-modal="true"
            aria-label={`${tx('Status bearbeiten', 'Edit status')}: ${editingWorkflowStatus.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Status</p>
                <h2>{tx('Status bearbeiten', 'Edit status')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                onClick={closeWorkflowStatusEditor}
                title={tx('Fenster schließen', 'Close window')}
                type="button"
              >
                ×
              </button>
            </div>
            <label>
              {tx('Statusname', 'Status name')}
              <input
                autoFocus
                onChange={(event) => setEditingWorkflowStatusName(event.target.value)}
                value={editingWorkflowStatusName}
              />
            </label>
            <label>
              {tx('Bedeutung', 'Meaning')}
              <textarea
                onChange={(event) => setEditingWorkflowStatusDescription(event.target.value)}
                rows={5}
                value={editingWorkflowStatusDescription}
              />
            </label>
            <div className="modalActions">
              <button onClick={closeWorkflowStatusEditor} type="button">{tx('Abbrechen', 'Cancel')}</button>
              <button className="primary" onClick={saveWorkflowStatus} type="button">
                {tx('Speichern', 'Save')}
              </button>
            </div>
          </section>
        </div>
      )}

      {PROMPT_NODES_ENABLED && selectedPrompt && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedPromptId('')}>
          <section
            className="promptModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Prompt-Knoten bearbeiten', 'Edit prompt node')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Workflow-Prompt', 'Workflow prompt')}</p>
                <h2>{selectedPrompt.name}</h2>
              </div>
              <button title={tx('Fenster schließen', 'Close window')} onClick={() => setSelectedPromptId('')}>×</button>
            </div>
            <label>
              {tx('Name', 'Name')}
              <input
                value={selectedPrompt.name}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { name: event.target.value })}
              />
            </label>
            <label>
              {tx('Bedingung', 'Condition')}
              <textarea
                rows={3}
                value={selectedPrompt.condition}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { condition: event.target.value })}
              />
            </label>
            <label>
              {tx('Prompt-Anweisung', 'Prompt instruction')}
              <textarea
                rows={6}
                value={selectedPrompt.prompt}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { prompt: event.target.value })}
              />
            </label>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowPrompt(selectedPrompt.id)}>
                {tx('Prompt-Knoten löschen', 'Delete prompt node')}
              </button>
              <button className="primary" onClick={() => setSelectedPromptId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
      {dashboardOpen && selectedAgent && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setDashboardOpen(false)}
        >
          <section
            className="workflowDashboard workflowDashboardModal"
            role="dialog"
            aria-modal="true"
            aria-label={`${tx('Workflow-Dashboard von', 'Workflow dashboard for')} ${selectedAgent.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dashboardHeader">
              <div>
                <p className="eyebrow">Workflow Dashboard</p>
                <strong>{selectedAgent.name}</strong>
              </div>
              <div className="dashboardActions">
                <div className="dashboardMetric">
                  <strong>{dashboardRoutes.length}</strong>
                  <span>{tx('Verbindungen', 'connections')}</span>
                </div>
                <div className="dashboardActionGroup">
                  <button
                    aria-label={tx('Workflow anordnen', 'Arrange workflow')}
                    className="compactAction iconAction"
                    onClick={autoArrangeWorkflow}
                    title={tx('Anordnen', 'Arrange')}
                    type="button"
                  >
                    A
                  </button>
                </div>
                <details className="dashboardStatusMenu">
                  <summary
                    aria-label={tx('Statuseinstellung öffnen', 'Open status settings')}
                    title={tx('Statuseinstellung', 'Status settings')}
                  >
                    S
                  </summary>
                  <div className="promptStatusOptions dashboardStatusOptions">
                    <p>{tx(
                      'Workflow-Status für diesen Agenten',
                      'Workflow statuses for this agent',
                    )}</p>
                    {projectWorkflowStatuses.length === 0 ? (
                      <span className="empty">{tx('Im Projekt sind noch keine Status angelegt.', 'No statuses have been created in this project.')}</span>
                    ) : (
                      projectWorkflowStatuses.map((status) => {
                        const enabled = selectedAgent.workflowStatusIds === null ||
                          selectedAgent.workflowStatusIds.includes(status.id)
                        return (
                          <label className="promptStatusOption" key={status.id}>
                            <input
                              checked={enabled}
                              onChange={(event) =>
                                setAgentWorkflowStatusEnabled(selectedAgent, status.id, event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>{status.name}</strong>
                              <small>{status.description || tx('Keine Bedeutung hinterlegt.', 'No meaning provided.')}</small>
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </details>
                <details className="dashboardTools">
                  <summary
                    aria-label={tx('Tools öffnen', 'Open tools')}
                    title="Tools"
                  >
                    T
                  </summary>
                  <div className="dashboardToolMenu">
                    <button
                      onClick={(event) => {
                        addWorkflowInitial()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">+</span>
                      <span>
                        <strong>Initial</strong>
                        <small>{tx('Startanweisung senden', 'Send initial instruction')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowStatusFilter()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">+</span>
                      <span>
                        <strong>Status</strong>
                        <small>{tx('Bei Status weiterleiten', 'Forward on status')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowStop()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">■</span>
                      <span>
                        <strong>Stop</strong>
                        <small>{tx('Workflow-Pfad beenden', 'End workflow path')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowTimer()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">◷</span>
                      <span>
                        <strong>{tx('Zeitplan', 'Schedule')}</strong>
                        <small>{tx('Aufgabe zeitgesteuert senden', 'Send task on schedule')}</small>
                      </span>
                    </button>
                    {PROMPT_NODES_ENABLED && (
                      <button
                        onClick={(event) => {
                          addWorkflowPrompt()
                          event.currentTarget.closest('details')?.removeAttribute('open')
                        }}
                        type="button"
                      >
                        <span className="toolSymbol">+</span>
                        <span>
                          <strong>Prompt</strong>
                          <small>{tx('Bedingung auswerten', 'Evaluate condition')}</small>
                        </span>
                      </button>
                    )}
                  </div>
                </details>
                <button
                  aria-label={tx('Workflow-Dashboard schließen', 'Close workflow dashboard')}
                  className="dashboardClose"
                  onClick={() => setDashboardOpen(false)}
                  title={tx('Workflow-Dashboard schließen', 'Close workflow dashboard')}
                  type="button"
                >
                  ×
                </button>
              </div>
            </div>
            <WorkflowDashboard
              agents={dashboardAgents}
              prompts={dashboardPrompts}
              initials={projectInitials}
              statusFilters={projectStatusFilters}
              stops={projectStops}
              timers={projectTimers}
              statuses={projectWorkflowStatuses}
              positions={dashboardPositions}
              dashboardId={activeDashboardOwnerId}
              layoutRevision={layoutRevision}
              autoRun={autoRun}
              routes={dashboardRoutes}
              selectedRouteId={selectedRouteId}
              onConnectAgents={connectAgents}
              onSelectRoute={(routeId) => {
                setSelectedRouteId(routeId)
                setSelectedWorkflowAgentId('')
                setSelectedInitialId('')
                setSelectedStatusFilterId('')
                setSelectedStopId('')
              }}
              onSelectPrompt={(promptId) => {
                setSelectedPromptId(promptId)
                setSelectedWorkflowAgentId('')
                setSelectedInitialId('')
                setSelectedStatusFilterId('')
                setSelectedStopId('')
              }}
              onSelectAgent={(agentId) => {
                setSelectedWorkflowAgentId(agentId)
                setSelectedRouteId('')
                setSelectedInitialId('')
                setSelectedStatusFilterId('')
                setSelectedStopId('')
              }}
              onSelectInitial={(initialId) => {
                setSelectedInitialId(initialId)
                setSelectedWorkflowAgentId('')
                setSelectedRouteId('')
                setSelectedStatusFilterId('')
                setSelectedStopId('')
              }}
              onSelectStatusFilter={(filterId) => {
                setSelectedStatusFilterId(filterId)
                setSelectedWorkflowAgentId('')
                setSelectedRouteId('')
                setSelectedInitialId('')
                setSelectedStopId('')
              }}
              onSelectStop={(stopId) => {
                setSelectedStopId(stopId)
                setSelectedWorkflowAgentId('')
                setSelectedRouteId('')
                setSelectedInitialId('')
                setSelectedStatusFilterId('')
                setSelectedTimerId('')
              }}
              onSelectTimer={(timerId) => {
                setSelectedTimerId(timerId)
                setSelectedWorkflowAgentId('')
                setSelectedRouteId('')
                setSelectedInitialId('')
                setSelectedStatusFilterId('')
                setSelectedStopId('')
              }}
              onNodePositionChange={(nodeId, position) =>
                setWorkflowPositions((current) => ({
                  ...current,
                  [`${activeDashboardOwnerId}:${nodeId}`]: position,
                }))
              }
              onAgentDrop={dropAgentIntoDashboard}
              draggedAgentId={draggedAgentId}
              selectedAgentNodeId={selectedWorkflowAgentId}
              language={language}
            />
          </section>
        </div>
      )}
      {promptEditorOpen && selectedAgent && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setPromptEditorOpen(false)}
        >
          <section
            className="promptModal promptEditorModal"
            role="dialog"
            aria-modal="true"
            aria-label={`${tx('Prompt-Dateien von', 'Prompt files for')} ${selectedAgent.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Prompt-Dateien', 'Prompt files')}</p>
                <h2>{selectedAgent.name}</h2>
              </div>
              <button
                aria-label={tx('Prompt-Fenster schließen', 'Close prompt window')}
                title={tx('Prompt-Fenster schließen', 'Close prompt window')}
                onClick={() => setPromptEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <section className="promptLibrary" aria-label={tx('Aktive Prompt-Datei', 'Active prompt file')}>
              <div className="promptLibraryHeader">
                <div>
                  <p className="eyebrow">{tx('Aktive Arbeitsanweisung', 'Active work instruction')}</p>
                  <strong>{tx('Prompt-Datei', 'Prompt file')}</strong>
                </div>
                <button
                  aria-label={tx('Prompt-Datei erstellen', 'Create prompt file')}
                  className="iconButton"
                  onClick={() => {
                    setNewPromptName('')
                    setPromptCreationOpen(true)
                  }}
                  title={tx('Prompt-Datei erstellen', 'Create prompt file')}
                  type="button"
                >
                  +
                </button>
              </div>
              <div className="promptPicker">
                <label>
                  {tx('Datei auswählen', 'Select file')}
                  <select
                    value={selectedAgent.activePromptDocumentId}
                    onChange={(event) => selectPromptDocument(selectedAgent, event.target.value)}
                  >
                    {selectedAgent.promptDocuments.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.fileName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label={tx('Aktive Prompt-Datei umbenennen', 'Rename active prompt file')}
                  className="iconButton promptRenameButton"
                  onClick={() => {
                    const document = activePromptDocument(selectedAgent)
                    setRenamedPromptName(document?.name || '')
                    setPromptRenameOpen(true)
                  }}
                  title={tx('Aktive Prompt-Datei umbenennen', 'Rename active prompt file')}
                  type="button"
                >
                  ✎
                </button>
              </div>
              {activePromptDocument(selectedAgent) && (
                <p className="promptFilePath">
                  {tx('Datei', 'File')}: <code>{activePromptDocument(selectedAgent).filePath || `.codex-orchestrator/prompts/${selectedAgent.id}/${activePromptDocument(selectedAgent).fileName}`}</code>
                </p>
              )}
            </section>

            <label className="wide promptEditorText">
              {activePromptDocument(selectedAgent)?.name || tx('Prompt-Anweisung', 'Prompt instruction')}
              <textarea
                rows={14}
                value={activePromptDocument(selectedAgent)?.content ?? ''}
                onChange={(event) =>
                  updatePromptDocument(
                    selectedAgent,
                    selectedAgent.activePromptDocumentId,
                    event.target.value,
                  )
                }
              />
            </label>

            <div className="modalActions">
              <button onClick={() => setPromptEditorOpen(false)} type="button">{tx('Schließen', 'Close')}</button>
              <button
                className="primary"
                onClick={() => setPendingPromptDeliveryAgentId(selectedAgent.id)}
                type="button"
              >
                {tx('Speichern und übergeben', 'Save and send')}
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingPromptDeliveryAgent && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setPendingPromptDeliveryAgentId('')}
        >
          <section
            className="promptModal promptConfirmModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Prompt übergeben', 'Send prompt')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Prompt-Übergabe', 'Prompt delivery')}</p>
                <h2>{tx('Prompt übergeben?', 'Send prompt?')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setPendingPromptDeliveryAgentId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              <code>{activePromptDocument(pendingPromptDeliveryAgent)?.fileName}</code> {tx('wird gespeichert und an den Codex-Chat von', 'will be saved and sent to the Codex chat of')} <strong>{pendingPromptDeliveryAgent.name}</strong>.
            </p>
            <div className="modalActions">
              <button onClick={() => setPendingPromptDeliveryAgentId('')}>{tx('Abbrechen', 'Cancel')}</button>
              <button
                className="primary"
                onClick={() => {
                  setPendingPromptDeliveryAgentId('')
                  void savePromptInstruction(pendingPromptDeliveryAgent)
                }}
              >
                {tx('Übergeben', 'Send')}
              </button>
            </div>
          </section>
        </div>
      )}
      {promptCreationOpen && selectedAgent && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setPromptCreationOpen(false)}
        >
          <section
            className="promptModal promptFileModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Prompt-Datei erstellen', 'Create prompt file')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Agenten-Setup', 'Agent setup')}</p>
                <h2>{tx('Prompt-Datei erstellen', 'Create prompt file')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setPromptCreationOpen(false)}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                placeholder={tx('z. B. Workflow 1', 'e.g. Workflow 1')}
                value={newPromptName}
                onChange={(event) => setNewPromptName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    createPromptDocument()
                  }
                }}
              />
            </label>
            <p className="modalHint">
               {tx('Die Datei wird für', 'The file will be created for')} {selectedAgent.name} {tx('als', 'as')} <code>{promptFileName(newPromptName)}</code>.
            </p>
            <div className="modalActions">
              <button onClick={() => setPromptCreationOpen(false)}>{tx('Abbrechen', 'Cancel')}</button>
              <button className="primary" disabled={!newPromptName.trim()} onClick={createPromptDocument}>
                {tx('Erstellen', 'Create')}
              </button>
            </div>
          </section>
        </div>
      )}
      {promptRenameOpen && selectedAgent && activePromptDocument(selectedAgent) && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setPromptRenameOpen(false)}
        >
          <section
            className="promptModal promptFileModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Prompt-Datei umbenennen', 'Rename prompt file')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Agenten-Setup', 'Agent setup')}</p>
                <h2>{tx('Prompt-Datei umbenennen', 'Rename prompt file')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setPromptRenameOpen(false)}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                value={renamedPromptName}
                onChange={(event) => setRenamedPromptName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void renamePromptDocument()
                  }
                }}
              />
            </label>
            <p className="modalHint">
              {tx('Neuer Dateiname', 'New file name')}: <code>{promptFileName(renamedPromptName)}</code>
            </p>
            <div className="modalActions">
              <button onClick={() => setPromptRenameOpen(false)}>{tx('Abbrechen', 'Cancel')}</button>
              <button className="primary" disabled={!renamedPromptName.trim()} onClick={() => void renamePromptDocument()}>
                {tx('Umbenennen', 'Rename')}
              </button>
            </div>
          </section>
        </div>
      )}
      {selectedInitial && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedInitialId('')}>
          <section
            className="promptModal initialModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Initial-Baustein bearbeiten', 'Edit initial node')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow Start</p>
                <h2>{selectedInitial.name}</h2>
              </div>
              <button title={tx('Fenster schließen', 'Close window')} onClick={() => setSelectedInitialId('')}>×</button>
            </div>
            <label>
              Name
              <input
                value={selectedInitial.name}
                onChange={(event) =>
                  updateWorkflowInitial(selectedInitial.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              {tx('Startanweisung', 'Initial instruction')}
              <textarea
                rows={7}
                value={selectedInitial.instruction}
                onChange={(event) =>
                  updateWorkflowInitial(selectedInitial.id, { instruction: event.target.value })
                }
              />
            </label>
            <p className="modalHint">
              {tx('Beim Start der Automatik wird diese Anweisung an jeden direkt verbundenen Agenten gesendet.', 'When automation starts, this instruction is sent to every directly connected agent.')}
            </p>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowInitial(selectedInitial.id)}>
                {tx('Löschen', 'Delete')}
              </button>
              <button className="primary" onClick={() => setSelectedInitialId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedStop && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedStopId('')}>
          <section
            className="promptModal initialModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Stopp-Baustein bearbeiten', 'Edit stop node')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Workflow-Ende', 'Workflow end')}</p>
                <h2>{selectedStop.name}</h2>
              </div>
              <button title={tx('Fenster schließen', 'Close window')} onClick={() => setSelectedStopId('')}>×</button>
            </div>
            <label>
              Name
              <input
                value={selectedStop.name}
                onChange={(event) => updateWorkflowStop(selectedStop.id, { name: event.target.value })}
              />
            </label>
            <p className="modalHint">
              {tx('Sobald ein Ergebnis diesen Baustein erreicht, endet dieser Workflow-Pfad. Es wird keine weitere Chat-Nachricht gesendet.', 'When a result reaches this node, the workflow path ends. No further chat message is sent.')}
            </p>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowStop(selectedStop.id)}>
                {tx('Löschen', 'Delete')}
              </button>
              <button className="primary" onClick={() => setSelectedStopId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedTimer && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedTimerId('')}>
          <section
            className="promptModal timerModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Zeitplan konfigurieren', 'Configure schedule')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Workflow-Zeitplan', 'Workflow schedule')}</p>
                <h2>{tx('Zeitplan konfigurieren', 'Configure schedule')}</h2>
              </div>
              <button title={tx('Fenster schließen', 'Close window')} onClick={() => setSelectedTimerId('')}>×</button>
            </div>
            <div className="timerFormGrid">
              <label>
                Name
                <input
                  value={selectedTimer.name}
                  onChange={(event) => updateWorkflowTimer(selectedTimer.id, { name: event.target.value })}
                />
              </label>
              <label>
                {tx('Art', 'Type')}
                <select
                  value={selectedTimer.schedule}
                  onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                    schedule: event.target.value as WorkflowTimer['schedule'],
                  })}
                >
                  <option value="interval">Timer</option>
                  <option value="once">{tx('Kalender', 'Calendar')}</option>
                </select>
              </label>
              {selectedTimer.schedule === 'once' ? (
                <label className="timerStartField">
                  {tx('Datum und Uhrzeit', 'Date and time')}
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(selectedTimer.startAt)}
                    onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                      startAt: fromDateTimeLocal(event.target.value),
                    })}
                  />
                </label>
              ) : (
                <div className="timerIntervalField">
                  <label>
                    {tx('Ausführung', 'Execution')}
                    <select
                      value={selectedTimer.recurring === false ? 'once' : 'recurring'}
                      onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                        recurring: event.target.value === 'recurring',
                      })}
                    >
                      <option value="recurring">{tx('Wiederkehrend', 'Recurring')}</option>
                      <option value="once">{tx('Einmalig', 'Once')}</option>
                    </select>
                  </label>
                  {selectedTimer.intervalUnit === 'time' ? (
                    <label>
                      {tx('Startzeit', 'Start time')}
                      <input
                        type="time"
                        value={toTimeInput(selectedTimer.startAt)}
                        onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                          startAt: fromTimeInput(event.target.value),
                        })}
                      />
                    </label>
                  ) : (
                    <label>
                      {tx('Intervall', 'Interval')}
                      <input
                        min="1"
                        type="number"
                        value={selectedTimer.intervalValue}
                        onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                          intervalValue: Math.max(1, Number(event.target.value) || 1),
                        })}
                      />
                    </label>
                  )}
                  <label>
                    {tx('Einheit', 'Unit')}
                    <select
                      value={selectedTimer.intervalUnit}
                      onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                        intervalUnit: event.target.value as WorkflowTimer['intervalUnit'],
                      })}
                    >
                      <option value="minutes">{tx('Minuten', 'Minutes')}</option>
                      <option value="hours">{tx('Stunden', 'Hours')}</option>
                      <option value="days">{tx('Tage', 'Days')}</option>
                      <option value="weeks">{tx('Wochen', 'Weeks')}</option>
                      <option value="time">{tx('Uhrzeit', 'Time')}</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
            <label>
              {tx('Aufgabe', 'Task')}
              <textarea
                rows={6}
                value={selectedTimer.task}
                onChange={(event) => updateWorkflowTimer(selectedTimer.id, { task: event.target.value })}
                placeholder={tx('Welche Aufgabe soll an den verbundenen Agenten gesendet werden?', 'Which task should be sent to the connected agent?')}
              />
            </label>
            <label className="timerEnabled">
              <input
                type="checkbox"
                checked={selectedTimer.enabled}
                onChange={(event) => updateWorkflowTimer(selectedTimer.id, {
                  enabled: event.target.checked,
                  nextRunAt: event.target.checked
                    ? selectedTimer.schedule === 'interval'
                      ? nextTimerRun(selectedTimer)
                      : selectedTimer.startAt
                    : selectedTimer.nextRunAt,
                })}
              />
              <span>
                <strong>{tx('Zeitplan aktiv', 'Schedule active')}</strong>
                <small>{tx('Wird nur ausgeführt, solange die Automatik eingeschaltet ist.', 'Runs only while automation is enabled.')}</small>
              </span>
            </label>
            <div className="timerMeta">
              <span>{tx('Nächster Lauf', 'Next run')}</span>
              <strong>{selectedTimer.enabled && selectedTimer.nextRunAt
                ? new Date(selectedTimer.nextRunAt).toLocaleString(language === 'de' ? 'de-DE' : 'en-US')
                : tx('Nicht geplant', 'Not scheduled')}</strong>
            </div>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowTimer(selectedTimer.id)}>{tx('Löschen', 'Delete')}</button>
              <button className="primary" onClick={() => setSelectedTimerId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedRoute && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedRouteId('')}>
          <section
            className="promptModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Verbindung konfigurieren', 'Configure connection')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Workflow-Verbindung', 'Workflow connection')}</p>
                <h2>{tx('Verbindung konfigurieren', 'Configure connection')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setSelectedRouteId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              <strong>{dashboardNodeLabel(selectedRoute.sourceId)}</strong> {tx('leitet an', 'forwards to')}{' '}
              <strong>{dashboardNodeLabel(selectedRoute.targetId)}</strong>.
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => {
                  setRoutes((current) => current.filter((route) => route.id !== selectedRoute.id))
                  setSelectedRouteId('')
                }}
              >
                {tx('Verbindung löschen', 'Delete connection')}
              </button>
              <button className="primary" onClick={() => setSelectedRouteId('')}>{tx('Schließen', 'Close')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedWorkflowAgent && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedWorkflowAgentId('')}>
          <section
            className="promptModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Agenten-Baustein konfigurieren', 'Configure agent node')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Agenten-Baustein', 'Agent node')}</p>
                <h2>{selectedWorkflowAgent.name}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setSelectedWorkflowAgentId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              {tx(
                `Dieser Baustein repräsentiert den Codex-Chat „${selectedWorkflowAgent.name}“. Das Entfernen löscht den Chat nicht, sondern nur diesen Baustein und seine Verbindungen aus diesem Dashboard.`,
                `This node represents the Codex chat “${selectedWorkflowAgent.name}”. Removing it does not delete the chat; it only removes this node and its connections from the dashboard.`,
              )}
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => removeAgentFromDashboard(selectedWorkflowAgent.id)}
              >
                {tx('Aus Dashboard entfernen', 'Remove from dashboard')}
              </button>
              <button className="primary" onClick={() => setSelectedWorkflowAgentId('')}>{tx('Schließen', 'Close')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedStatusFilter && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedStatusFilterId('')}>
          <section
            className="promptModal statusFilterModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Status-Filter konfigurieren', 'Configure status filter')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Status</p>
                <h2>{tx('Status-Filter konfigurieren', 'Configure status filter')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setSelectedStatusFilterId('')}
              >
                ×
              </button>
            </div>
            <section className="statusFilterSummary" aria-label={tx('Ausgewählter Workflow-Status', 'Selected workflow status')}>
              <label>
                Status
                <select
                  value={selectedStatusFilter.statusId}
                  onChange={(event) =>
                    selectWorkflowStatusFilterStatus(selectedStatusFilter.id, event.target.value)
                  }
                >
                  {projectWorkflowStatuses.map((status) => (
                    <option key={status.id} value={status.id}>{status.name}</option>
                  ))}
                </select>
              </label>
              {(() => {
                const status = projectWorkflowStatuses.find(
                  (item) => item.id === selectedStatusFilter.statusId,
                )
                return status?.description
                  ? (
                      <div className="statusFilterDescription">
                        <span>{tx('Bedeutung', 'Meaning')}</span>
                        <p>{status.description}</p>
                      </div>
                    )
                  : null
              })()}
            </section>
            <p className="modalHint statusFilterInfo">
              {tx('Der Status wird in der projektweiten Statusliste verwaltet. Dieser Baustein leitet nur passende Ergebnisse weiter.', 'The status is managed in the project status list. This node forwards matching results only.')}
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => deleteWorkflowStatusFilter(selectedStatusFilter.id)}
              >
                {tx('Löschen', 'Delete')}
              </button>
              <button className="primary" onClick={() => setSelectedStatusFilterId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
