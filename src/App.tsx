import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
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

type WorkflowNodeData = {
  label: string
  kind: 'agent' | 'prompt' | 'initial' | 'status'
  status?: AgentStatus
}

function chatMessageIdentity(message: ChatMessage, agentName: string) {
  if (message.role === 'assistant') {
    return {
      name: agentName,
      label: message.phase !== 'final_answer' ? 'Zwischenstand' : 'Antwort',
    }
  }

  const handoff = message.text.match(/^Übergabe von (.+?) an (.+?)(?:\r?\n|$)/)
  if (handoff) {
    return {
      name: handoff[1],
      label: `Übergabe an ${handoff[2]}`,
    }
  }

  const initial = message.text.match(/^Initial-Anfrage von (.+?)(?:\r?\n|$)/)
  if (initial) {
    return {
      name: initial[1],
      label: 'Initial-Anfrage',
    }
  }

  return { name: 'Orchestrator', label: 'Eingang' }
}

function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const isInitial = data.kind === 'initial'
  return (
    <div className={`workflowNodeContent ${data.kind}`}>
      {!isInitial && <Handle id="input" type="target" position={Position.Left} />}
      {!isInitial && <span className="portLabel input">In</span>}
      <strong>{data.label}</strong>
      <span className="nodeKind">
        {data.kind === 'agent'
          ? 'Agent'
          : data.kind === 'initial'
            ? 'Start'
            : data.kind === 'status'
              ? 'Status-Filter'
              : 'Prompt / Bedingung'}
      </span>
      <span className="portLabel output">Out</span>
      <Handle id="output" type="source" position={Position.Right} />
    </div>
  )
}

const workflowNodeTypes = { workflow: WorkflowNode }

const STORAGE_KEY = 'minidio-codex-orchestrator'
const PROMPT_NODES_ENABLED = false

const initialCodexProjects: CodexProject[] = [
  { id: '8fe383a0-9e86-4a98-bf94-c790d6ae0233', label: 'codex_orchestrator', path: 'C:\\Users\\TV\\Documents\\claw_codex' },
  { id: 'local-bbe4e27732a45739cbbcd842a5361e8c', label: 'MINI_DIO', path: 'C:\\Users\\TV\\Documents\\MINI_DIO' },
  { id: 'local-9ee0f798f12e3a442a04b662184255a6', label: 'MCM_TradingView', path: 'C:\\Users\\TV\\Documents\\MCM_TradingView' },
  { id: 'local-891672d6ac51047214a222f5a421a0d1', label: 'Phemex_Strategy_Observer', path: 'C:\\Users\\TV\\Documents\\New project 3' },
  { id: 'local-1b8ed0d8127838bf36accc25354fcdd4', label: 'Mental-Core-Matrix-MCM', path: 'C:\\Users\\TV\\Documents\\New project 2' },
  { id: 'local-fccf5d4e798b5bf4840da9149d9ff56a', label: 'MCM_Trading_Brain', path: 'C:\\Users\\TV\\Documents\\MCM_Trading_Brain' },
  { id: 'local-b636d4da065e71d5adb0c62ec053b47f', label: 'TradingView AI', path: 'C:\\Users\\TV\\Documents\\New project' },
]

const initialCodexThreads: CodexThread[] = [
  { id: '019f7d26-adcb-7722-a3cc-4bf7e7776bd3', title: 'CEO', cwd: 'C:\\Users\\TV\\Documents\\claw_codex', status: 'idle' },
  { id: '019f487d-043f-7330-a490-b80912593134', title: 'ENTWICKLUNG', cwd: 'C:\\Users\\TV\\Documents\\MINI_DIO', status: 'idle' },
  { id: '019f7aed-f24b-7880-a8c6-b32c9d1f7e76', title: '-> Analyse', cwd: 'C:\\Users\\TV\\Documents\\MINI_DIO', status: 'idle' },
  { id: '019f7bfa-27d3-7a90-9f03-1fe3cd22a029', title: '°° REPO - Aenderungen', cwd: 'C:\\Users\\TV\\Documents\\MINI_DIO', status: 'notLoaded' },
  { id: '019f7d07-6747-7cc1-a665-aea5a79905a1', title: 'Programmierer', cwd: 'C:\\Users\\TV\\Documents\\claw_codex', status: 'active' },
]

const statusLabels: Record<AgentStatus, string> = {
  wartet: 'Warten',
  laeuft: 'Läuft',
  fertig: 'Fertig',
  rueckfrage: 'Rückfrage',
  weitergegeben: 'Weitergegeben',
}

const defaultWorkflowStatuses = [
  { name: 'Fertig', description: 'Der Lauf ist abgeschlossen.' },
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
    name: agent.name === 'Neuer MiniDIO Agent' ? 'Neuer Agent' : agent.name ?? 'Agent',
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
        ? deduplicateAgents(
            parsed.agents
              .map(normalizeAgent)
              .filter(
                (agent: Agent) =>
                  agent.threadId ||
                  !['MiniDIO CEO', 'MiniDIO Analyse', 'MiniDIO Entwicklung'].includes(agent.name),
              ),
          )
        : initialAgents,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      hiddenThreadIds: Array.isArray(parsed.hiddenThreadIds) ? parsed.hiddenThreadIds : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      workflowPrompts: Array.isArray(parsed.workflowPrompts) ? parsed.workflowPrompts : [],
      workflowInitials: Array.isArray(parsed.workflowInitials) ? parsed.workflowInitials : [],
      workflowStatuses: Array.isArray(parsed.workflowStatuses) ? parsed.workflowStatuses : [],
      workflowStatusFilters: Array.isArray(parsed.workflowStatusFilters) ? parsed.workflowStatusFilters : [],
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

function projectLabelFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function samePath(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function buildInstruction(agent: Agent, promptPath: string, statuses: WorkflowStatusDefinition[]) {
  return [
    `Rollen-Anweisung für: ${agent.name}`,
    `Rolle: ${agent.role}`,
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

function routeConditionMatches(condition: string, result: string) {
  const normalized = condition.trim().toLocaleLowerCase('de-DE')
  return (
    normalized === '' ||
    normalized === 'immer' ||
    result.toLocaleLowerCase('de-DE').includes(normalized)
  )
}

function formatDuration(durationMs: number) {
  if (durationMs <= 0) {
    return 'Keine Messung'
  }
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))} Sek.`
  }
  return `${(durationMs / 60_000).toFixed(1)} Min.`
}

function CollapsibleText({
  text,
  limit,
  monospace = false,
}: {
  text: string
  limit: number
  monospace?: boolean
}) {
  const className = monospace ? 'collapsibleText monospace' : 'collapsibleText'
  if (text.length <= limit) {
    return monospace ? <pre className="graph">{text}</pre> : <p>{text}</p>
  }

  const preview = `${text.slice(0, limit).trimEnd()}…`
  return (
    <details className={className}>
      <summary>
        <span className="showMore">Mehr anzeigen</span>
        <span className="showLess">Weniger anzeigen</span>
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
  statuses,
  positions,
  dashboardId,
  layoutRevision,
  routes,
  selectedRouteId,
  onConnectAgents,
  onSelectRoute,
  onSelectPrompt,
  onSelectAgent,
  onSelectInitial,
  onSelectStatusFilter,
  onNodePositionChange,
  onAgentDrop,
  draggedAgentId,
  selectedAgentNodeId,
}: {
  agents: Agent[]
  prompts: WorkflowPrompt[]
  initials: WorkflowInitial[]
  statusFilters: WorkflowStatusFilter[]
  statuses: WorkflowStatusDefinition[]
  positions: Record<string, { x: number; y: number }>
  dashboardId: string
  layoutRevision: number
  routes: WorkflowRoute[]
  selectedRouteId: string
  onConnectAgents: (connection: Connection) => void
  onSelectRoute: (routeId: string) => void
  onSelectPrompt: (promptId: string) => void
  onSelectAgent: (agentId: string) => void
  onSelectInitial: (initialId: string) => void
  onSelectStatusFilter: (filterId: string) => void
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void
  onAgentDrop: (agentId: string, position: { x: number; y: number }) => void
  draggedAgentId: string
  selectedAgentNodeId: string
}) {
  const initialNodes = useMemo<Node[]>(
    () =>
      [
        ...agents.map((agent, index) => ({
          id: agent.id,
          type: 'workflow',
          position: positions[agent.id] ?? { x: 70 + (index % 3) * 220, y: 70 + Math.floor(index / 3) * 150 },
          data: { label: agent.name, kind: 'agent' as const, status: agent.status },
          className: `workflowNode agent ${agent.status} ${agent.id === selectedAgentNodeId ? 'nodeSelected' : ''}`,
        })),
        ...prompts.map((prompt, index) => ({
          id: prompt.id,
          type: 'workflow',
          position: positions[prompt.id] ?? { x: 180 + (index % 3) * 220, y: 250 + Math.floor(index / 3) * 150 },
          data: { label: prompt.name, kind: 'prompt' as const },
          className: 'workflowNode prompt',
        })),
        ...initials.map((initial, index) => ({
          id: initial.id,
          type: 'workflow',
          position: positions[initial.id] ?? { x: 40, y: 70 + index * 130 },
          data: { label: initial.name, kind: 'initial' as const },
          className: 'workflowNode initial',
        })),
        ...statusFilters.map((filter, index) => {
          const status = statuses.find((item) => item.id === filter.statusId)
          return {
            id: filter.id,
            type: 'workflow',
            position: positions[filter.id] ?? { x: 260 + (index % 3) * 220, y: 430 + Math.floor(index / 3) * 130 },
            data: { label: status?.name || filter.name, kind: 'status' as const },
            className: 'workflowNode statusFilter',
          }
        }),
      ],
    [agents, initials, positions, prompts, selectedAgentNodeId, statusFilters, statuses],
  )
  const initialEdges = useMemo<Edge[]>(
    () =>
      routes.map((route) => ({
        id: route.id,
        source: route.sourceId,
        target: route.targetId,
        animated: true,
        className: route.id === selectedRouteId ? 'selectedRoute' : '',
      })),
    [routes, selectedRouteId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [agentDragOver, setAgentDragOver] = useState(false)
  const nodeSignature = initialNodes.map((node) => node.id).sort().join(':')

  useEffect(() => {
    setNodes((current) =>
      initialNodes.map((node) => ({
        ...node,
        position:
          positions[node.id] ??
          current.find((item) => item.id === node.id)?.position ??
          node.position,
      })),
    )
  }, [initialNodes, positions, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  useEffect(() => {
    if (layoutRevision > 0 && flowInstance) {
      window.setTimeout(() => void flowInstance.fitView({ padding: 0.22, duration: 280 }), 0)
    }
  }, [flowInstance, layoutRevision])

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
          } else if (agents.some((agent) => agent.id === node.id)) {
            onSelectAgent(node.id)
          }
        }}
        onNodeDragStop={(_, node) => onNodePositionChange(node.id, node.position)}
        fitView
        fitViewOptions={{ padding: 0.22 }}
      >
        <Background gap={20} size={1} />
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
  const [autoRun, setAutoRun] = useState(storedState.autoRun)
  const [projectFilter, setProjectFilter] = useState(() =>
    initialCodexProjects.some((project) => project.id === storedState.selectedProjectId)
      ? storedState.selectedProjectId
      : 'local-bbe4e27732a45739cbbcd842a5361e8c',
  )
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>(storedState.hiddenThreadIds)
  const [routes, setRoutes] = useState<WorkflowRoute[]>(storedState.routes)
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPrompt[]>(storedState.workflowPrompts)
  const [workflowInitials, setWorkflowInitials] = useState<WorkflowInitial[]>(storedState.workflowInitials)
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatusDefinition[]>(storedState.workflowStatuses)
  const [workflowStatusFilters, setWorkflowStatusFilters] = useState<WorkflowStatusFilter[]>(
    storedState.workflowStatusFilters,
  )
  const [workflowPositions, setWorkflowPositions] = useState<Record<string, { x: number; y: number }>>(
    storedState.workflowPositions,
  )
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [selectedInitialId, setSelectedInitialId] = useState('')
  const [selectedStatusFilterId, setSelectedStatusFilterId] = useState('')
  const [newWorkflowStatusName, setNewWorkflowStatusName] = useState('')
  const [newWorkflowStatusDescription, setNewWorkflowStatusDescription] = useState('')
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState('')
  const [workflowBoardAgentIds, setWorkflowBoardAgentIds] = useState<Record<string, string[]>>(
    storedState.workflowBoardAgentIds,
  )
  const [setupOpen, setSetupOpen] = useState(false)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [promptCreationOpen, setPromptCreationOpen] = useState(false)
  const [newPromptName, setNewPromptName] = useState('')
  const [promptRenameOpen, setPromptRenameOpen] = useState(false)
  const [renamedPromptName, setRenamedPromptName] = useState('')
  const [pendingPromptDeliveryAgentId, setPendingPromptDeliveryAgentId] = useState('')
  const [transmittingAgentIds, setTransmittingAgentIds] = useState<string[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
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
  const pollingTurnIds = useRef(new Set<string>())
  const terminalResultObservations = useRef(new Map<string, number>())
  const chatStreamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      document.querySelectorAll<HTMLElement>('details.threadManager[open], details.dashboardTools[open]').forEach((menu) => {
        if (!menu.contains(target)) {
          menu.removeAttribute('open')
        }
      })
    }

    window.addEventListener('pointerdown', closeMenusOnOutsideClick)
    return () => window.removeEventListener('pointerdown', closeMenusOnOutsideClick)
  }, [])

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
  }, [agents, autoRun, events, hiddenThreadIds, projectFilter, routes, sharedStateReady, workflowBoardAgentIds, workflowInitials, workflowPositions, workflowPrompts, workflowStatusFilters, workflowStatuses])

  const applySharedState = useCallback((state: ReturnType<typeof loadStoredState>) => {
    setAgents(Array.isArray(state.agents) ? deduplicateAgents(state.agents.map(normalizeAgent)) : [])
    setEvents(Array.isArray(state.events) ? state.events : [])
    setHiddenThreadIds(Array.isArray(state.hiddenThreadIds) ? state.hiddenThreadIds : [])
    setRoutes(Array.isArray(state.routes) ? state.routes : [])
    setWorkflowPrompts(Array.isArray(state.workflowPrompts) ? state.workflowPrompts : [])
    setWorkflowInitials(Array.isArray(state.workflowInitials) ? state.workflowInitials : [])
    setWorkflowStatuses(Array.isArray(state.workflowStatuses) ? state.workflowStatuses : [])
    setWorkflowStatusFilters(Array.isArray(state.workflowStatusFilters) ? state.workflowStatusFilters : [])
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
      const existingNames = new Set(
        current
          .filter((status) => samePath(status.projectPath, selectedProjectPath))
          .map((status) => status.name.trim().toLocaleLowerCase('de-DE')),
      )
      const missingDefaults = defaultWorkflowStatuses.filter(
        (status) => !existingNames.has(status.name.toLocaleLowerCase('de-DE')),
      )

      if (missingDefaults.length === 0) {
        return current
      }

      return [
        ...current,
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
  const pendingPromptDeliveryAgent = useMemo(
    () => agents.find((agent) => agent.id === pendingPromptDeliveryAgentId),
    [agents, pendingPromptDeliveryAgentId],
  )

  useEffect(() => {
    let active = true
    const threadId = selectedAgent?.threadId
    setChatPinnedToBottom(true)
    setChatDraft('')
    if (!threadId) {
      setChatMessages([])
      setChatError('Dieser Agent ist mit keinem Codex-Chat verknüpft.')
      return
    }

    const loadConversation = async () => {
      try {
        const response = await fetch(
          `/api/threads/${encodeURIComponent(threadId)}/conversation`,
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Chat konnte nicht gelesen werden.')
        }
        if (active) {
          setChatMessages(data.messages ?? [])
          setChatError('')
        }
      } catch (error) {
        if (active) {
          setChatError(
            error instanceof Error ? error.message : 'Codex-Connector nicht erreichbar.',
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
  }, [selectedAgent?.threadId])

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
  const projectRoutes = useMemo(
    () =>
      routes.filter(
        (route) =>
          (route.ownerAgentId || route.sourceId) === activeDashboardOwnerId &&
          samePath(route.projectPath, selectedProject?.path ?? '') &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters].some((node) => node.id === route.sourceId) &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters].some((node) => node.id === route.targetId),
      ),
    [activeDashboardOwnerId, projectAgents, projectStatusFilters, routes, selectedProject?.path, workflowInitials, workflowPrompts],
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
  ])
  const dashboardRoutes = projectRoutes.filter(
    (route) => dashboardNodeIds.has(route.sourceId) && dashboardNodeIds.has(route.targetId),
  )
  const dashboardPositions = Object.fromEntries(
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters].map((node) => [
      node.id,
      workflowPositions[`${activeDashboardOwnerId}:${node.id}`],
    ]).filter((entry) => Boolean(entry[1])),
  ) as Record<string, { x: number; y: number }>
  const selectedRoute = projectRoutes.find((route) => route.id === selectedRouteId)
  const selectedPrompt = projectPrompts.find((prompt) => prompt.id === selectedPromptId)
  const selectedInitial = projectInitials.find((initial) => initial.id === selectedInitialId)
  const selectedStatusFilter = projectStatusFilters.find((filter) => filter.id === selectedStatusFilterId)
  const selectedWorkflowAgent = projectAgents.find((agent) => agent.id === selectedWorkflowAgentId)
  const dashboardNodeLabel = (nodeId: string) =>
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters].find(
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
            : `${agent.name} -> Ende`
        })
        .join('\n'),
    [agents, routes],
  )

  const addEvent = useCallback((title: string, detail: string) => {
    setEvents((current) => [
      { id: crypto.randomUUID(), at: nowLabel(), title, detail },
      ...current.slice(0, 39),
    ])
  }, [])

  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
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
    (agent.status === 'laeuft' && Boolean(agent.pendingTurnId)) ||
    transmittingAgentIds.includes(agent.id)

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
      const response = await fetch('/api/threads')
      if (!response.ok) {
        throw new Error('Codex-Tasks konnten nicht geladen werden.')
      }
      const data = await response.json()
      const threads: CodexThread[] = data.threads.map(
        (thread: { id: string; name?: string | null; preview?: string; cwd: string; status: string }) => ({
          id: thread.id,
          title: thread.name || thread.preview || 'Unbenannter Chat',
          cwd: thread.cwd,
          status: thread.status,
        }),
      )
      setCodexThreads(threads)
      setCodexProjects((current) => {
        const next = [...current]
        threads.forEach((thread) => {
          if (!next.some((project) => samePath(project.path, thread.cwd))) {
            next.push({
              id: `path:${thread.cwd}`,
              label: projectLabelFromPath(thread.cwd),
              path: thread.cwd,
            })
          }
        })
        return next
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

    if (agents.some(
      (agent) =>
        samePath(agent.projectPath, selectedProject.path) &&
        agent.name.trim().toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'),
    )) {
      setAgentCreationError('In diesem Projekt gibt es bereits einen Agenten mit diesem Namen.')
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
        throw new Error(data.error || 'Codex-Chat konnte nicht erstellt werden.')
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
        error instanceof Error ? error.message : 'Der Codex-Connector ist nicht erreichbar.',
      )
    } finally {
      setAgentCreationBusy(false)
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
      ? `Möchten Sie den Agenten „${agent.name}“ wirklich löschen?\n\nDer zugehörige Codex-Chat wird archiviert und aus der aktiven Projektansicht entfernt.`
      : `Möchten Sie den Agenten „${agent.name}“ wirklich aus dem Orchestrator entfernen?`
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
      remaining.map((item) =>
        item.talkTo.includes(agent.id)
          ? {
              ...item,
              talkTo: item.talkTo.filter((targetId) => targetId !== agent.id),
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    )
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== agent.id && route.targetId !== agent.id),
    )
    setWorkflowInitials((current) =>
      current.filter((initial) => initial.ownerAgentId !== agent.id),
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
      workflowStatuses.filter((status) => samePath(status.projectPath, agent.projectPath)),
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
    const message = requiresWorkflowStatus
      ? [
          text,
          '',
          workflowStatusInstruction(
            workflowStatuses.filter((status) => samePath(status.projectPath, agent.projectPath)),
          ),
        ].join('\n')
      : text
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
        throw new Error(data.error || 'Nachricht konnte nicht gesendet werden.')
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
        requiresWorkflowStatus
          ? `${agent.name} hat eine direkte Anweisung mit Workflow-Status erhalten.`
          : `${agent.name} hat eine direkte Anweisung ohne Workflow-Status erhalten.`,
      )
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : 'Der Codex-Connector ist nicht erreichbar.',
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
    const projectStatuses = workflowStatuses.filter((status) => samePath(status.projectPath, agent.projectPath))
    const resultStatusIds = workflowStatusIdsFromResult(agent.lastResult, projectStatuses)
    const deliveries = activeRoutes.flatMap((route) => {
      const directTarget = agents.find((item) => item.id === route.targetId)
      if (directTarget) {
        return [{ target: directTarget, route }]
      }
      const statusFilter = workflowStatusFilters.find((filter) => filter.id === route.targetId)
      if (statusFilter) {
        if (!resultStatusIds.includes(statusFilter.statusId)) {
          return []
        }
        return routes
          .filter((outgoing) => outgoing.sourceId === statusFilter.id)
          .flatMap((outgoing) => {
            const target = agents.find((item) => item.id === outgoing.targetId)
            return target ? [{ target, route: outgoing }] : []
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
        .flatMap((outgoing) => {
          const target = agents.find((item) => item.id === outgoing.targetId)
          return target
            ? [{
                target,
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
    const newDeliveries = deliveries.filter(({ route, target }) => {
      if (!currentTaskSignature || route.lastForwardedTask !== currentTaskSignature) {
        return true
      }
      addEvent(
        'Identische Aufgabe nicht weitergegeben',
        `${agent.name} → ${target.name}: Die nächste Aufgabe wurde über diese Verbindung bereits übergeben.`,
      )
      return false
    })
    if (newDeliveries.length === 0) {
      return
    }
    updateAgent(agent.id, { status: 'weitergegeben' })
    const deliveredTargets: string[] = []
    await Promise.all(newDeliveries.map(async ({ target, route }) => {
      deliveredTargets.push(target.name)
      const message = buildHandoffMessage(agent, target, route, projectStatuses)
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
  }, [addEvent, agents, applyThreadReplacement, routes, updateAgent, workflowPrompts, workflowStatusFilters, workflowStatuses])

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
      'Knoten'
    addEvent(
      'Workflow-Verbindung erstellt',
      `${nodeName(route.sourceId)} → ${nodeName(route.targetId)}`,
    )
  }, [activeDashboardOwnerId, addEvent, agents, selectedProject?.path, workflowInitials, workflowPrompts, workflowStatusFilters])

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

  const updateWorkflowStatusFilter = (filterId: string, patch: Partial<WorkflowStatusFilter>) => {
    setWorkflowStatusFilters((current) =>
      current.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)),
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
      ...dashboardAgents.map((agent) => agent.id),
      ...dashboardPrompts.map((prompt) => prompt.id),
      ...projectStatusFilters.map((filter) => filter.id),
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
          workflowStatusInstruction(
            workflowStatuses.filter((status) => samePath(status.projectPath, target.projectPath)),
          ),
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
      setAutoRun(false)
      addEvent('Automatik gestoppt', 'Weitere fertige Ergebnisse werden nicht automatisch weitergegeben.')
      return
    }
    sharedStateDirty.current = true
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
                ? `Wochenlimit wird am ${new Date(usageSummary.resetsAt * 1000).toLocaleString('de-DE')} zurückgesetzt.`
                : 'Verbleibendes Codex-Wochenlimit'
            }
          >
            <small>Woche</small>
            <strong>
              {usageSummary.remainingPercent === null
                ? '–'
                : `${usageSummary.remainingPercent} % frei`}
            </strong>
            {(usageSummary.unlimited || usageSummary.credits) && (
              <small>
                {usageSummary.unlimited ? 'Guthaben unbegrenzt' : `Guthaben ${usageSummary.credits}`}
              </small>
            )}
          </div>
          <button className={autoRun ? 'danger' : ''} onClick={toggleAutomation}>
            {autoRun ? 'Automatik stoppen' : 'Automatik starten'}
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
            aria-label="Agent erstellen"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Codex-Agent</p>
                <h2>Agent erstellen</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                disabled={agentCreationBusy}
                title="Fenster schließen"
                onClick={() => setAgentCreationOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              Erstellt einen Codex-Chat im Projekt „{selectedProject?.label ?? 'Kein Projekt'}“.
              Der Agent wird nicht automatisch mit dem Workflow verbunden.
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
                placeholder="Zum Beispiel: Prompt-Architekt"
                value={newAgentName}
              />
            </label>
            {agentCreationError && <p className="formError">{agentCreationError}</p>}
            <div className="modalActions">
              <button disabled={agentCreationBusy} onClick={() => setAgentCreationOpen(false)}>Abbrechen</button>
              <button
                className="primary"
                disabled={!newAgentName.trim() || agentCreationBusy}
                onClick={() => void createAgent()}
              >
                {agentCreationBusy ? 'Erstelle…' : 'Erstellen'}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="codexBrowser">
        <div>
          <p className="eyebrow">Codex Projekte und Tasks</p>
          <div className="codexPicker">
            <label>
              Projekt
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                {codexProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.label}</option>
                ))}
              </select>
            </label>
            <details className="threadManager">
              <summary>Chats in der Agentenübersicht verwalten</summary>
              <div className="threadOptions">
                {visibleThreads.length === 0 && <p>Für dieses Projekt wurden keine Chats gefunden.</p>}
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
          </div>
        </div>
        <div className={`connectorState ${connectorOnline ? 'online' : 'offline'}`}>
          <span className="stateDot" />
          <div>
            <strong>{connectorOnline ? 'Codex-Connector verbunden' : 'Codex-Connector offline'}</strong>
            <small>
              {connectorOnline
                ? `${codexProjects.length} Projekte, ${codexThreads.length} Tasks · ${lastSyncedAt}`
                : 'Keine Live-Synchronisierung'}
            </small>
          </div>
        </div>
      </section>

      <section className="layout">
        <aside className="agentRail">
          <div className="railHeader">
            <div className="railHeaderTitle">
              <strong>{selectedProject?.label ?? 'Kein Projekt'}</strong>
              <small>{projectAgents.length} Agenten</small>
            </div>
            <button
              className="railAddAgent"
              title="Agent im aktuellen Projekt erstellen"
              onClick={() => {
                setAgentCreationError('')
                setNewAgentName('')
                setAgentCreationOpen(true)
              }}
            >
              + Agent
            </button>
          </div>
          {projectAgents.length === 0 && (
            <p className="empty railEmpty">Keine sichtbaren Chats oder Agenten in diesem Projekt.</p>
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
                onDoubleClick={() => {
                  setSelectedId(agent.id)
                  setSetupOpen(false)
                  setPromptEditorOpen(true)
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
                title="Zum Sortieren ziehen"
              >
                <span className="agentName">
                  {isAgentBusy(agent) && <span className="activitySpinner" aria-label="Agent arbeitet" role="status" />}
                  <span>{agent.name}</span>
                </span>
                <small className={isAgentBusy(agent) ? 'workingLabel' : ''}>
                  {isAgentBusy(agent) ? 'Aktiv' : statusLabels[agent.status]}
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

        {selectedAgent && (
          <section className="workspace">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{setupOpen ? 'Agentenprofil' : 'Agenten-Chat'}</p>
                <h2>{selectedAgent.name}</h2>
              </div>
              <div className="agentStatusSummary">
                {isAgentBusy(selectedAgent) && (
                  <span className="agentWorking" role="status">
                    <span className="activitySpinner" aria-hidden="true" />
                    Arbeitet
                  </span>
                )}
                <span className="responseTime">
                  Dauer: {formatDuration(selectedAgent.lastDurationMs)}
                </span>
                <span className={`status ${selectedAgent.status}`}>{statusLabels[selectedAgent.status]}</span>
                <span className="setupControl">
                  <button
                    aria-label="Prompt-Dateien öffnen"
                    className={`setupToggle promptToggle ${promptEditorOpen ? 'active' : ''}`}
                    onClick={() => setPromptEditorOpen(true)}
                    title="Prompt-Dateien öffnen"
                    type="button"
                  >
                    P
                  </button>
                  <button
                    aria-label={setupOpen ? 'Setup schließen' : 'Setup öffnen'}
                    className={`setupToggle ${setupOpen ? 'active' : ''}`}
                    onClick={() => setSetupOpen((current) => !current)}
                    title={setupOpen ? 'Setup schließen' : 'Setup öffnen'}
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
                Rolle
                <input value={selectedAgent.role} onChange={(event) => updateAgent(selectedAgent.id, { role: event.target.value })} />
              </label>
              <label>
                Modell
                <select
                  value={selectedAgent.model}
                  onChange={(event) => updateAgent(selectedAgent.id, { model: event.target.value })}
                >
                  <option value="">Codex-Standard</option>
                  {codexModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}{model.isDefault ? ' (Standard)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className="workflowStatusLibrary" aria-label="Workflow-Status">
              <div className="workflowStatusHeader">
                <div>
                  <p className="eyebrow">Workflow-Status</p>
                  <strong>Projektweite Statusliste</strong>
                </div>
                <small>{projectWorkflowStatuses.length} Status</small>
              </div>
              <div className="workflowStatusCreate">
                <input
                  aria-label="Name des Workflow-Status"
                  onChange={(event) => setNewWorkflowStatusName(event.target.value)}
                  placeholder="Statusname"
                  value={newWorkflowStatusName}
                />
                <input
                  aria-label="Beschreibung des Workflow-Status"
                  onChange={(event) => setNewWorkflowStatusDescription(event.target.value)}
                  placeholder="Bedeutung"
                  value={newWorkflowStatusDescription}
                />
                <button onClick={addWorkflowStatus} type="button">Hinzufügen</button>
              </div>
              {projectWorkflowStatuses.length > 0 && (
                <div className="workflowStatusList">
                  {projectWorkflowStatuses.map((status) => (
                    <div className="workflowStatusItem" key={status.id}>
                      <strong>{status.name}</strong>
                      <span>{status.description || 'Keine Beschreibung'}</span>
                      <button
                        aria-label={`Status ${status.name} löschen`}
                        className="deleteStatus"
                        onClick={() => deleteWorkflowStatus(status.id)}
                        title="Status löschen"
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="autoForwardControl" aria-label="Automatische Weitergabe">
              <div>
                <p className="eyebrow">Workflow-Funktion</p>
                <strong>Automatisch weitergeben</strong>
              </div>
              <label className="checkbox">
                <input
                  checked={selectedAgent.autoForward}
                  type="checkbox"
                  onChange={(event) => updateAgent(selectedAgent.id, { autoForward: event.target.checked })}
                />
                Aktiv
              </label>
            </section>

            <section className="workflowDashboard">
              <div className="dashboardHeader">
                <div>
                  <p className="eyebrow">Workflow-Dashboard</p>
                  <strong>{selectedAgent.name} · Eigene Verdrahtung</strong>
                </div>
                <div className="dashboardActions">
                  <div className="dashboardMetric">
                    <strong>{dashboardRoutes.length}</strong>
                    <span>Verbindungen</span>
                  </div>
                  <div className="dashboardActionGroup">
                    <button className="compactAction" onClick={autoArrangeWorkflow}>Anordnen</button>
                  </div>
                  <details className="dashboardTools">
                    <summary>Tools</summary>
                    <div className="dashboardToolMenu">
                      <button
                        onClick={(event) => {
                          addWorkflowInitial()
                          event.currentTarget.closest('details')?.removeAttribute('open')
                        }}
                      >
                        <span className="toolSymbol">+</span>
                        <span>
                          <strong>Initial</strong>
                          <small>Startanweisung senden</small>
                        </span>
                      </button>
                      <button
                        onClick={(event) => {
                          addWorkflowStatusFilter()
                          event.currentTarget.closest('details')?.removeAttribute('open')
                        }}
                      >
                        <span className="toolSymbol">+</span>
                        <span>
                          <strong>Status</strong>
                          <small>Bei Status weiterleiten</small>
                        </span>
                      </button>
                      {PROMPT_NODES_ENABLED && (
                        <button
                          onClick={(event) => {
                            addWorkflowPrompt()
                            event.currentTarget.closest('details')?.removeAttribute('open')
                          }}
                        >
                          <span className="toolSymbol">+</span>
                          <span>
                            <strong>Prompt</strong>
                            <small>Bedingung auswerten</small>
                          </span>
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              </div>
              <WorkflowDashboard
                agents={dashboardAgents}
                prompts={dashboardPrompts}
                initials={projectInitials}
                statusFilters={projectStatusFilters}
                statuses={projectWorkflowStatuses}
                positions={dashboardPositions}
                dashboardId={activeDashboardOwnerId}
                layoutRevision={layoutRevision}
                routes={dashboardRoutes}
                selectedRouteId={selectedRouteId}
                onConnectAgents={connectAgents}
                onSelectRoute={(routeId) => {
                  setSelectedRouteId(routeId)
                  setSelectedWorkflowAgentId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                }}
                onSelectPrompt={(promptId) => {
                  setSelectedPromptId(promptId)
                  setSelectedWorkflowAgentId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                }}
                onSelectAgent={(agentId) => {
                  setSelectedWorkflowAgentId(agentId)
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                }}
                onSelectInitial={(initialId) => {
                  setSelectedInitialId(initialId)
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedStatusFilterId('')
                }}
                onSelectStatusFilter={(filterId) => {
                  setSelectedStatusFilterId(filterId)
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
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
              />
            </section>

            <div className="adapter">
              <strong>Codex-Adapter</strong>
              <p>
                Der lokale Connector synchronisiert Projekte und Tasks, erstellt neue Codex-Chats,
                übernimmt Umbenennungen, sendet Rollen-Anweisungen und archiviert gelöschte Agenten.
                Ergebnisse werden bis zum Abschluss überwacht und gemäß der Verdrahtung automatisch
                an den nächsten Agenten übergeben.
              </p>
            </div>
            <div className="adapterDeleteAction">
              <button
                className="deleteButton"
                disabled={deletingAgentId === selectedAgent.id}
                onClick={() => void deleteAgent(selectedAgent)}
              >
                {deletingAgentId === selectedAgent.id ? 'Wird archiviert…' : 'Agent löschen'}
              </button>
            </div>
              </>
            ) : (
              <section className="agentChat" aria-label={`Chat von ${selectedAgent.name}`}>
                <div className="chatHeader">
                  <div>
                    <strong>Codex-Chat</strong>
                    <small>{selectedAgent.threadTitle || selectedAgent.name}</small>
                  </div>
                  <span className={`liveIndicator ${isAgentBusy(selectedAgent) ? 'active' : ''}`}>
                    {isAgentBusy(selectedAgent) && <span className="activitySpinner" aria-hidden="true" />}
                    {isAgentBusy(selectedAgent) ? 'Antwort wird erstellt' : 'Aktuell'}
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
                      <p className="empty">Noch keine Nachrichten in diesem Chat.</p>
                    )}
                    {chatMessages.map((message) => {
                      const identity = chatMessageIdentity(message, selectedAgent.name)
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
                      aria-label="Zur neuesten Nachricht"
                      className="jumpToLatest"
                      onClick={() => {
                        const stream = chatStreamRef.current
                        if (stream) {
                          stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' })
                        }
                        setChatPinnedToBottom(true)
                      }}
                      title="Zur neuesten Nachricht"
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
                    aria-label="Nachricht an Agent"
                    disabled={!selectedAgent.threadId || chatSending}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void sendChatMessage(selectedAgent)
                      }
                    }}
                    placeholder="Anweisung eingeben…"
                    rows={2}
                    value={chatDraft}
                  />
                  <button
                    aria-label="Nachricht senden"
                    className="sendChatButton"
                    disabled={!chatDraft.trim() || !selectedAgent.threadId || chatSending}
                    title="Nachricht senden"
                    type="submit"
                  >
                    {chatSending ? '…' : '↑'}
                  </button>
                </form>
              </section>
            )}
          </section>
        )}

        <aside className="eventLog">
          <p className="eyebrow">Rollenfluss</p>
          <CollapsibleText text={graphEdges} limit={700} monospace />
          <p className="eyebrow">Ablaufprotokoll</p>
          {events.length === 0 && <p className="empty">Noch keine Orchestrator-Aktion.</p>}
          {events.map((event) => (
            <article key={event.id}>
              <time>{event.at}</time>
              <strong>{event.title}</strong>
              <CollapsibleText text={event.detail} limit={320} />
            </article>
          ))}
        </aside>
      </section>

      {PROMPT_NODES_ENABLED && selectedPrompt && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedPromptId('')}>
          <section
            className="promptModal"
            role="dialog"
            aria-modal="true"
            aria-label="Prompt-Knoten bearbeiten"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Prompt</p>
                <h2>{selectedPrompt.name}</h2>
              </div>
              <button title="Fenster schließen" onClick={() => setSelectedPromptId('')}>×</button>
            </div>
            <label>
              Name
              <input
                value={selectedPrompt.name}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { name: event.target.value })}
              />
            </label>
            <label>
              Bedingung
              <textarea
                rows={3}
                value={selectedPrompt.condition}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { condition: event.target.value })}
              />
            </label>
            <label>
              Prompt-Anweisung
              <textarea
                rows={6}
                value={selectedPrompt.prompt}
                onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { prompt: event.target.value })}
              />
            </label>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowPrompt(selectedPrompt.id)}>
                Prompt-Knoten löschen
              </button>
              <button className="primary" onClick={() => setSelectedPromptId('')}>Übernehmen</button>
            </div>
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
            aria-label={`Prompt-Dateien von ${selectedAgent.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Prompt-Dateien</p>
                <h2>{selectedAgent.name}</h2>
              </div>
              <button
                aria-label="Prompt-Fenster schließen"
                title="Prompt-Fenster schließen"
                onClick={() => setPromptEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <section className="promptLibrary" aria-label="Aktive Prompt-Datei">
              <div className="promptLibraryHeader">
                <div>
                  <p className="eyebrow">Aktive Arbeitsanweisung</p>
                  <strong>Prompt-Datei</strong>
                </div>
                <button
                  aria-label="Prompt-Datei erstellen"
                  className="iconButton"
                  onClick={() => {
                    setNewPromptName('')
                    setPromptCreationOpen(true)
                  }}
                  title="Prompt-Datei erstellen"
                  type="button"
                >
                  +
                </button>
              </div>
              <div className="promptPicker">
                <label>
                  Datei auswählen
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
                  aria-label="Aktive Prompt-Datei umbenennen"
                  className="iconButton promptRenameButton"
                  onClick={() => {
                    const document = activePromptDocument(selectedAgent)
                    setRenamedPromptName(document?.name || '')
                    setPromptRenameOpen(true)
                  }}
                  title="Aktive Prompt-Datei umbenennen"
                  type="button"
                >
                  ✎
                </button>
              </div>
              {activePromptDocument(selectedAgent) && (
                <p className="promptFilePath">
                  Datei: <code>{activePromptDocument(selectedAgent).filePath || `.codex-orchestrator/prompts/${selectedAgent.id}/${activePromptDocument(selectedAgent).fileName}`}</code>
                </p>
              )}
            </section>

            <label className="wide promptEditorText">
              {activePromptDocument(selectedAgent)?.name || 'Prompt-Anweisung'}
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
              <button onClick={() => setPromptEditorOpen(false)} type="button">Schließen</button>
              <button
                className="primary"
                onClick={() => setPendingPromptDeliveryAgentId(selectedAgent.id)}
                type="button"
              >
                Speichern und übergeben
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
            aria-label="Prompt übergeben"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Prompt-Übergabe</p>
                <h2>Prompt übergeben?</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
                onClick={() => setPendingPromptDeliveryAgentId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              <code>{activePromptDocument(pendingPromptDeliveryAgent)?.fileName}</code> wird gespeichert und an den Codex-Chat von <strong>{pendingPromptDeliveryAgent.name}</strong> übergeben.
            </p>
            <div className="modalActions">
              <button onClick={() => setPendingPromptDeliveryAgentId('')}>Abbrechen</button>
              <button
                className="primary"
                onClick={() => {
                  setPendingPromptDeliveryAgentId('')
                  void savePromptInstruction(pendingPromptDeliveryAgent)
                }}
              >
                Übergeben
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
            aria-label="Prompt-Datei erstellen"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Agenten-Setup</p>
                <h2>Prompt-Datei erstellen</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
                onClick={() => setPromptCreationOpen(false)}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                placeholder="z. B. Workflow 1"
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
              Die Datei wird für {selectedAgent.name} als <code>{promptFileName(newPromptName)}</code> angelegt.
            </p>
            <div className="modalActions">
              <button onClick={() => setPromptCreationOpen(false)}>Abbrechen</button>
              <button className="primary" disabled={!newPromptName.trim()} onClick={createPromptDocument}>
                Erstellen
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
            aria-label="Prompt-Datei umbenennen"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Agenten-Setup</p>
                <h2>Prompt-Datei umbenennen</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
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
              Neuer Dateiname: <code>{promptFileName(renamedPromptName)}</code>
            </p>
            <div className="modalActions">
              <button onClick={() => setPromptRenameOpen(false)}>Abbrechen</button>
              <button className="primary" disabled={!renamedPromptName.trim()} onClick={() => void renamePromptDocument()}>
                Umbenennen
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
            aria-label="Initial-Baustein bearbeiten"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Start</p>
                <h2>{selectedInitial.name}</h2>
              </div>
              <button title="Fenster schließen" onClick={() => setSelectedInitialId('')}>×</button>
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
              Startanweisung
              <textarea
                rows={7}
                value={selectedInitial.instruction}
                onChange={(event) =>
                  updateWorkflowInitial(selectedInitial.id, { instruction: event.target.value })
                }
              />
            </label>
            <p className="modalHint">
              Beim Start der Automatik wird diese Anweisung an jeden direkt verbundenen Agenten gesendet.
            </p>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowInitial(selectedInitial.id)}>
                Löschen
              </button>
              <button className="primary" onClick={() => setSelectedInitialId('')}>Übernehmen</button>
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
            aria-label="Verbindung konfigurieren"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Verbindung</p>
                <h2>Verbindung konfigurieren</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
                onClick={() => setSelectedRouteId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              <strong>{dashboardNodeLabel(selectedRoute.sourceId)}</strong> leitet an{' '}
              <strong>{dashboardNodeLabel(selectedRoute.targetId)}</strong> weiter.
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => {
                  setRoutes((current) => current.filter((route) => route.id !== selectedRoute.id))
                  setSelectedRouteId('')
                }}
              >
                Verbindung löschen
              </button>
              <button className="primary" onClick={() => setSelectedRouteId('')}>Schließen</button>
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
            aria-label="Agenten-Baustein konfigurieren"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Agenten-Baustein</p>
                <h2>{selectedWorkflowAgent.name}</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
                onClick={() => setSelectedWorkflowAgentId('')}
              >
                ×
              </button>
            </div>
            <p className="modalHint">
              Dieser Baustein repräsentiert den Codex-Chat „{selectedWorkflowAgent.name}“. Das Entfernen löscht den Chat nicht, sondern nur diesen Baustein und seine Verbindungen aus diesem Dashboard.
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => removeAgentFromDashboard(selectedWorkflowAgent.id)}
              >
                Aus Dashboard entfernen
              </button>
              <button className="primary" onClick={() => setSelectedWorkflowAgentId('')}>Schließen</button>
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
            aria-label="Status-Filter konfigurieren"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Status</p>
                <h2>Status-Filter konfigurieren</h2>
              </div>
              <button
                aria-label="Fenster schließen"
                title="Fenster schließen"
                onClick={() => setSelectedStatusFilterId('')}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                value={selectedStatusFilter.name}
                onChange={(event) =>
                  updateWorkflowStatusFilter(selectedStatusFilter.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              Status
              <select
                value={selectedStatusFilter.statusId}
                onChange={(event) => {
                  const status = projectWorkflowStatuses.find((item) => item.id === event.target.value)
                  updateWorkflowStatusFilter(selectedStatusFilter.id, {
                    statusId: event.target.value,
                    name: status ? `Status: ${status.name}` : selectedStatusFilter.name,
                  })
                }}
              >
                {projectWorkflowStatuses.map((status) => (
                  <option key={status.id} value={status.id}>{status.name}</option>
                ))}
              </select>
            </label>
            <p className="modalHint">
              Nur Ergebnisse mit dem gewählten Workflow-Status werden über diesen Baustein weitergeleitet.
            </p>
            <div className="modalActions">
              <button
                className="deleteButton"
                onClick={() => deleteWorkflowStatusFilter(selectedStatusFilter.id)}
              >
                Löschen
              </button>
              <button className="primary" onClick={() => setSelectedStatusFilterId('')}>Übernehmen</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
