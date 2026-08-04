import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type SnapGrid,
  useNodesState,
  useUpdateNodeInternals,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import {
  MANAGEMENT_ERROR_STATUS_MEANING,
  MANAGEMENT_ERROR_STATUS_NAME,
  buildTeamTopology,
  findAuthorizedManagementTeamPlan,
  isExplicitTeamProvisioningRequest,
  looksLikeManagementTeamPlan,
  parseManagementTeamPlan,
  repairManagementStartTopology,
  type AgentWebAccess,
} from './team-plan.ts'
import { runProvisioningTransaction } from './provisioning-transaction.ts'
import {
  findCompletedConversationTurn,
  findCompletedConversationTurnById,
  findConversationTurnActivity,
  findConversationTurnActivityById,
  findLatestCompletedConversationTurnAfter,
  requireStartedTurnId,
} from './codex-turn.ts'
import {
  observeTurnActivity,
  turnNeedsWatchdogIntervention,
  turnNeedsZombieIntervention,
  type TurnActivityObservation,
} from './workflow-watchdog.ts'
import {
  deliveryDeduplicationSignature,
  shouldDeliverWorkflowTask,
} from './delivery-deduplication.ts'
import { explicitAgentStatusIds } from './agent-status-assignment.ts'
import { summarizeDeliveryAttempts } from './delivery-outcome.ts'
import {
  DEFAULT_CEO_INSTRUCTIONS,
  managementRulebook,
  withInternalInstructions,
} from './management-policy.ts'
import {
  buildWorkloadEscalationResult,
  nextConsecutiveFailedRuns,
  shouldEscalateWorkload,
} from './workload-escalation.ts'
import {
  resolveManagementRecoveryTargetId,
} from './management-recovery.ts'
import { isDeliveryTargetBusy } from './delivery-availability.ts'
import {
  dequeueDelivery,
  enqueueDelivery,
  normalizeDeliveryQueue,
  pruneDeliveryQueue,
  removeDeliveryAgent,
  removeDeliveryTarget,
  type DeliveryQueue,
} from './delivery-queue.ts'
import { pruneWorkflowBoardAgentIds, pruneWorkflowPositions } from './workflow-state.ts'
import { normalizeGermanTypography } from './german-typography.ts'
import {
  INTERNAL_WORKFLOW_ERROR_STATUS_ID,
  INTERNAL_WORKFLOW_ERROR_STATUS_NAME,
  internalWorkflowErrorHandoffInstruction,
  internalWorkflowErrorManagerId,
  shouldEscalateInternalWorkflowError,
} from './internal-workflow-error.ts'
import { verifiedPromptInstruction } from './prompt-delivery.ts'
import { createLatestWriteQueue } from './latest-write-queue.ts'
import { projectForThread, threadBelongsToProject } from './codex-project.ts'
import {
  knowledgeSourceInstruction,
  knowledgeSourcesForAgent,
  knowledgeSourcesForProject,
  type KnowledgeSource,
  type KnowledgeSourceType,
} from './knowledge-sources.ts'
import {
  insertProjectGoalText,
  projectGoalForProject,
  projectGoalInstruction,
  type ProjectGoal,
} from './project-goal.ts'
import {
  UNCONDITIONAL_FORWARD_STATUS_ID,
  UNCONDITIONAL_FORWARD_STATUS_NAME,
  unconditionalForwardStatus,
  parseWorkflowSignal,
  workflowSignalIssue,
  workflowStatusInstruction,
} from './workflow-protocol.ts'
import {
  resolveConfiguredDeliveries,
  resolveUnconditionalForwarding,
  wouldCreateUnsupportedUnconditionalForwardCycle,
  type ResolvedWorkflowDelivery,
} from './workflow-routing.ts'
import {
  MAX_FORWARD_INTERVAL,
  normalizeForwardIntervalMode,
  normalizeForwardInterval,
  normalizeForwardIntervalCount,
  type ForwardIntervalMode,
} from './workflow-forward-interval.ts'
import { decideWorkflowContinuation } from './workflow-decision.ts'
import {
  shouldRequestWorkflowStatusRepair,
  workflowStatusRepairInstruction,
} from './workflow-status-repair.ts'
import {
  advanceWorkflowRunCycle,
  appendWorkflowRunEntry,
  activeWorkflowRun,
  beginWorkflowRun,
  ensureWorkflowRun,
  shouldRecoverPendingCheckpoint,
  isRecoverableContinuationCandidate,
  normalizeWorkflowRuntime,
  removeProjectCheckpointsSupersededAt,
  resetProjectWorkflowRuntime,
  removeWorkflowCheckpoint,
  resumableWorkflowCheckpoint,
  saveWorkflowCheckpoint,
  workflowRunCycleProgress,
  workflowRunEntry,
  type WorkflowCheckpoint,
  type WorkflowRuntime,
} from './workflow-runtime.ts'
import {
  MAX_WORKFLOW_LOOPS,
  MIN_WORKFLOW_LOOPS,
  normalizeWorkflowLoopCount,
  normalizeWorkflowLoopCounts,
  setWorkflowLoopCount,
  workflowLoopCountForProject,
  type WorkflowLoopCounts,
} from './workflow-loop.ts'
import { wouldCompleteWorkflowCycleOnReturn } from './workflow-cycle-boundary.ts'
import {
  WorkflowConnectionLine,
  WorkflowEdge,
  WorkflowNode,
} from './workflow-canvas.tsx'
import {
  hasStableTerminalResult,
  isAgentWorking,
  resolvePendingTurnStartedAt,
  shouldPollPendingTurn,
} from './pending-turn.ts'
import { workflowConstraintViolation } from './workflow-constraints.ts'
import { auditWorkflowTopology } from './workflow-topology-audit.ts'
import { manualInstructionSupersedesCheckpoints } from './manual-checkpoint-policy.ts'
import { currentHandoffContextInstruction } from './handoff-context.ts'
import {
  workflowDeliveryKey,
  wouldRepeatWorkflowCycle,
} from './workflow-loop-guard.ts'
import { releaseAgentDispatch, reserveAgentDispatch } from './agent-dispatch-guard.ts'
import {
  isAffirmativeUserConfirmation,
  normalizeUserConfirmationRequest,
  parseUserInteractionRequest,
  userInteractionInstruction,
  type UserConfirmationRequest,
} from './user-confirmation.ts'
import { requestsManualChatForwarding } from './manual-chat-forwarding.ts'
import { diagnoseWorkflowStall } from './workflow-supervisor.ts'

type AgentStatus = 'wartet' | 'laeuft' | 'fertig' | 'rueckfrage' | 'weitergegeben'
type UiLanguage = 'de' | 'en'
type AgentAssignment = 'agent' | 'management'
type AgentRunPurpose = '' | 'chat' | 'chat-forward' | 'handoff' | 'handoff-repair' | 'initial' | 'prompt' | 'status-repair' | 'timer'
type ThemeMode = 'system' | 'light' | 'dark'
type SettingsSection = 'general' | 'profile' | 'appearance'

const workflowNodeTypes = { workflow: WorkflowNode }
const workflowEdgeTypes = { workflow: WorkflowEdge }

const INVENTORY_RECONCILIATION_GRACE_MS = 5 * 60 * 1000
const ORPHANED_HANDOFF_GRACE_MS = 15_000
const COMPLETED_TURN_RECOVERY_GRACE_MS = 10 * 60 * 1000
const WORKFLOW_SNAP_GRID: SnapGrid = [20, 20]
const AUTOMATION_LEASE_KEY = 'codex-orchestrator-automation-lease-v1'
const AUTOMATION_LEASE_DURATION_MS = 7_000

type AutomationLease = {
  ownerId: string
  expiresAt: number
}

const readAutomationLease = (): AutomationLease | null => {
  try {
    const value = window.localStorage.getItem(AUTOMATION_LEASE_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<AutomationLease>
    return typeof parsed.ownerId === 'string' && typeof parsed.expiresAt === 'number'
      ? { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt }
      : null
  } catch {
    return null
  }
}

type ProgramSettings = {
  displayName: string
  theme: ThemeMode
  accentColor: string
  backgroundColor: string
  foregroundColor: string
  buttonColor: string
  buttonTextColor: string
  topbarColor: string
  projectBarColor: string
  agentRailColor: string
  workspaceColor: string
  eventLogColor: string
  uiFont: string
  codeFont: string
  contrast: number
  showWorkflowStatusLines: boolean
}

type WorkspaceFileChange = {
  path: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed'
}

type PromptDocument = {
  id: string
  name: string
  fileName: string
  content: string
  filePath: string
  sha256?: string
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
  prompt: string
  promptDocuments: PromptDocument[]
  activePromptDocumentId: string
  status: AgentStatus
  talkTo: string[]
  autoForward: boolean
  usesTeamChat: boolean
  usesProjectKnowledge: boolean
  webAccess: AgentWebAccess
  assignment: AgentAssignment
  teamProvisioningEnabled: boolean
  managementInstructionRules: string[]
  lastAppliedTeamPlanSignature: string
  workflowStatusIds: string[]
  workflowStatusUpdatedAt: string
  finishSignal: string
  lastResult: string
  instructionVersion: number
  lastInstruction: string
  runStartedAt: string
  lastDurationMs: number
  completedRuns: number
  consecutiveFailedRuns: number
  pendingTurnId: string
  runPurpose: AgentRunPurpose
  lastCompletedTurnId: string
  lastInboundAgentId: string
  pendingUserConfirmation: UserConfirmationRequest | null
  updatedAt: string
}

type EventLog = {
  id: string
  at: string
  title: string
  detail: string
  projectPath?: string
}

type StallNotice = {
  agentName: string
  turnId: string
  durationSeconds: number
}

type WorkflowStopNotice = {
  projectName: string
  sourceAgentName: string
  stopNames: string[]
  cycle: number
  targetCycles: number
  durationMs: number
}

type PendingApproval = {
  id: string
  method: string
  threadId: string
  turnId: string
  reason: string
  command: string
  cwd: string
  createdAt: string
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
  projectId?: string
  projectPath?: string
  projectAssignmentPending?: boolean
}

type ChatMessage = {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  text: string
  phase: string
  turnStatus: string
  sourceAgentId?: string
  sourceAgentName?: string
  sourceThreadTitle?: string
  workspaceChanges?: WorkspaceFileChange[]
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
  sourceHandle?: 'output' | 'interval'
  lastForwardedTask?: string
}

type WorkflowPrompt = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  condition: string
  prompt: string
  intervalSource: 'none' | 'custom' | 'project'
  interval: number
  intervalCount: number
  intervalMode: ForwardIntervalMode
  intervalPrompt: string
}

type WorkflowInitial = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  instruction: string
  instructionSource?: 'user'
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
  interval?: number
  intervalCount?: number
  intervalMode?: ForwardIntervalMode
  intervalPrompt?: string
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

type WorkflowLoop = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  targetAgentId: string
  targetAgentIds?: string[]
}

type WorkflowLayoutPattern = {
  id: string
  projectPath: string
  dashboardId: string
  savedAt: string
  nodes: Array<{
    id: string
    kind: 'agent' | 'prompt' | 'initial' | 'status' | 'stop' | 'timer' | 'loop'
    x: number
    y: number
  }>
}

type WorkflowDelivery = {
  route: WorkflowRoute
  target?: Agent
  stop?: WorkflowStop
  promptNodeId?: string
  promptBranch?: 'normal' | 'interval'
  promptNextCount?: number
}

function normalizeWorkflowPrompt(value: Partial<WorkflowPrompt>): WorkflowPrompt {
  const interval = normalizeForwardInterval(value.interval)
  return {
    id: value.id ?? crypto.randomUUID(),
    ownerAgentId: value.ownerAgentId ?? '',
    projectPath: value.projectPath ?? '',
    name: value.name ?? 'Weiterleiten',
    condition: value.condition ?? '',
    prompt: value.prompt ?? '',
    intervalSource: ['none', 'custom', 'project'].includes(value.intervalSource ?? '')
      ? value.intervalSource!
      : interval > 0
        ? 'custom'
        : 'none',
    interval,
    intervalCount: normalizeForwardIntervalCount(value.intervalCount, interval),
    intervalMode: normalizeForwardIntervalMode(value.intervalMode),
    intervalPrompt: value.intervalPrompt ?? '',
  }
}

function normalizeWorkflowPrompts(value: unknown): WorkflowPrompt[] {
  return Array.isArray(value) ? value.map((prompt) => normalizeWorkflowPrompt(prompt)) : []
}

function normalizeWorkflowStatusFilter(value: Partial<WorkflowStatusFilter>): WorkflowStatusFilter {
  const interval = normalizeForwardInterval(value.interval)
  return {
    id: value.id ?? crypto.randomUUID(),
    ownerAgentId: value.ownerAgentId ?? '',
    projectPath: value.projectPath ?? '',
    name: value.name ?? 'Weiterleiten',
    statusId: value.statusId ?? '',
    interval,
    intervalCount: normalizeForwardIntervalCount(value.intervalCount, interval),
    intervalMode: normalizeForwardIntervalMode(value.intervalMode),
    intervalPrompt: value.intervalPrompt ?? '',
  }
}

function normalizeWorkflowStatusFilters(value: unknown): WorkflowStatusFilter[] {
  return Array.isArray(value) ? value.map((filter) => normalizeWorkflowStatusFilter(filter)) : []
}

function chatMessageIdentity(message: ChatMessage, agentName: string, language: UiLanguage) {
  const sourceName = message.sourceAgentName || agentName
  if (message.role === 'assistant') {
    return {
      name: sourceName,
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

  const initial = message.text.match(/^(?:Neutrales Startsignal|Initial-Anfrage) von (.+?)(?:\r?\n|$)/)
  if (initial) {
    return {
      name: initial[1],
      label: language === 'de' ? 'Startsignal' : 'Start signal',
    }
  }

  if (/^Start(?:\r?\n|$)/.test(message.text)) {
    return {
      name: 'Orchestrator',
      label: language === 'de' ? 'Startsignal' : 'Start signal',
    }
  }

  return { name: message.sourceAgentName ? `Orchestrator -> ${message.sourceAgentName}` : 'Orchestrator', label: language === 'de' ? 'Eingang' : 'Input' }
}

const STORAGE_KEY = 'codex-workflow-orchestrator'
const LANGUAGE_STORAGE_KEY = 'codex-workflow-orchestrator-language'
const PROGRAM_SETTINGS_STORAGE_KEY = 'codex-workflow-orchestrator-program-settings'
const TEAM_PLAN_FORMAT_CLAIM_PREFIX = 'codex-orchestrator-team-plan-format-v1:'
const PROMPT_NODES_ENABLED = true
const LEGACY_STATUS_UI_ENABLED = false

function teamPlanFormatClaimKey(agentId: string, sourceTurnId: string) {
  return `${TEAM_PLAN_FORMAT_CLAIM_PREFIX}${agentId}:${sourceTurnId || 'unknown'}`
}

function claimAutomaticTeamPlanFormatRequest(agentId: string, sourceTurnId: string) {
  try {
    const key = teamPlanFormatClaimKey(agentId, sourceTurnId)
    if (window.localStorage.getItem(key)) return false
    window.localStorage.setItem(key, new Date().toISOString())
    return true
  } catch {
    return true
  }
}

function clearAutomaticTeamPlanFormatClaim(agentId: string) {
  try {
    const prefix = `${TEAM_PLAN_FORMAT_CLAIM_PREFIX}${agentId}:`
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key)
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

const defaultProgramSettings: ProgramSettings = {
  displayName: '',
  theme: 'dark',
  accentColor: '#4b545d',
  backgroundColor: '#0a0f12',
  foregroundColor: '#e6edf3',
  buttonColor: '#21262d',
  buttonTextColor: '#e6edf3',
  topbarColor: '#0a0f12',
  projectBarColor: '#0a0f12',
  agentRailColor: '#0a0f12',
  workspaceColor: '#0a0f12',
  eventLogColor: '#0a0f12',
  uiFont: 'Segoe UI Variable Text',
  codeFont: 'Cascadia Code',
  contrast: 60,
  showWorkflowStatusLines: false,
}

function loadProgramSettings(): ProgramSettings {
  try {
    const stored = window.localStorage.getItem(PROGRAM_SETTINGS_STORAGE_KEY)
    if (!stored) {
      return defaultProgramSettings
    }
    const parsed = JSON.parse(stored) as Partial<ProgramSettings>
    return normalizeProgramSettingsClient(parsed)
  } catch {
    return defaultProgramSettings
  }
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeProgramSettingsClient(settings: Partial<ProgramSettings>): ProgramSettings {
  const merged = { ...defaultProgramSettings, ...settings }
  const background = merged.backgroundColor?.toLowerCase()
  const foreground = merged.foregroundColor?.toLowerCase()
  const accent = merged.accentColor?.toLowerCase()
  const hasStaleLightPalette = merged.theme === 'light'
    && background === defaultProgramSettings.backgroundColor
    && foreground === defaultProgramSettings.foregroundColor
  const hasStaleDarkPalette = merged.theme === 'dark'
    && background === '#f7f7f8'
    && foreground === '#18181b'
  const usesOldDarkDefaults = merged.theme === 'dark' && (
    (background === '#0b0b0c' && foreground === '#f2f2f3' && (!accent || accent === '#72d6c9')) ||
    (background === '#000000' && (!accent || accent === '#47a9c2')) ||
    (background === '#0d1117' && foreground === '#e6edf3' && (!accent || accent === '#8b949e')) ||
    (background === '#090c10' && foreground === '#e6edf3' && (!accent || accent === '#8b949e'))
  )
  if (hasStaleLightPalette) {
    return {
      ...merged,
      backgroundColor: '#f7f7f8',
      foregroundColor: '#18181b',
      contrast: Math.min(100, Math.max(0, Number(merged.contrast ?? defaultProgramSettings.contrast))),
    }
  }
  if (hasStaleDarkPalette) {
    return {
      ...merged,
      backgroundColor: defaultProgramSettings.backgroundColor,
      foregroundColor: defaultProgramSettings.foregroundColor,
      contrast: Math.min(100, Math.max(0, Number(merged.contrast ?? defaultProgramSettings.contrast))),
    }
  }
  if (!usesOldDarkDefaults) {
    return {
      ...merged,
      contrast: Math.min(100, Math.max(0, Number(merged.contrast ?? defaultProgramSettings.contrast))),
    }
  }
  return {
    ...merged,
    accentColor: defaultProgramSettings.accentColor,
    backgroundColor: defaultProgramSettings.backgroundColor,
    foregroundColor: defaultProgramSettings.foregroundColor,
    buttonColor: defaultProgramSettings.buttonColor,
    buttonTextColor: defaultProgramSettings.buttonTextColor,
    topbarColor: defaultProgramSettings.topbarColor,
    projectBarColor: defaultProgramSettings.projectBarColor,
    agentRailColor: defaultProgramSettings.agentRailColor,
    workspaceColor: defaultProgramSettings.workspaceColor,
    eventLogColor: defaultProgramSettings.eventLogColor,
    contrast: defaultProgramSettings.contrast,
  }
}

function hasCustomizedProgramSettings(settings: ProgramSettings) {
  return (Object.keys(defaultProgramSettings) as Array<keyof ProgramSettings>)
    .some((key) => settings[key] !== defaultProgramSettings[key])
}

function mixHexColors(background: string, foreground: string, foregroundWeight: number) {
  if (!isHexColor(background) || !isHexColor(foreground)) {
    return background
  }
  const weight = Math.min(1, Math.max(0, foregroundWeight))
  const channel = (start: number) => {
    const from = Number.parseInt(background.slice(start, start + 2), 16)
    const to = Number.parseInt(foreground.slice(start, start + 2), 16)
    return Math.round(from + (to - from) * weight).toString(16).padStart(2, '0')
  }
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

function getProfileInitials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase()
  }
  return (parts[0] ?? 'C').slice(0, 2).toLocaleUpperCase()
}

const languageCopy: Record<UiLanguage, {
  week: string
  free: string
  unlimited: string
  credit: string
  start: string
  stop: string
  projects: string
  project: string
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
    projects: 'Projekt',
    project: 'Projekt',
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
    projects: 'Project',
    project: 'Project',
    online: 'Codex Connector connected',
    offline: 'Codex Connector offline',
    liveSync: 'No live synchronization',
  },
}

const initialCodexProjects: CodexProject[] = []

type ProvisioningRecovery = {
  status: 'pending' | 'complete' | 'attention' | 'failed'
  completedAt: string | null
  transactions: number
  archived: number
  preserved: number
  failures: number
}

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
  'Benutzerbestätigung abgebrochen': 'User confirmation cancelled',
  'Benutzerbestätigung erforderlich': 'User confirmation required',
  'Benutzerbestätigung gesendet': 'User confirmation sent',
  'Benutzerantwort erforderlich': 'User answer required',
  'Benutzerantwort gesendet': 'User answer sent',
  'Chat-Nachricht gesendet': 'Chat message sent',
  'Codex Task ausgeblendet': 'Codex task hidden',
  'Codex Task bereits verlinkt': 'Codex task already linked',
  'Codex Task übernommen': 'Codex task imported',
  'Codex-Ergebnis empfangen': 'Codex result received',
  'Codex-Task umbenannt': 'Codex task renamed',
  'Ergebnisabfrage fehlgeschlagen': 'Result query failed',
  'Identische Aufgabe nicht weitergegeben': 'Duplicate task not forwarded',
  'Interner Workflow-Fehler gemeldet': 'Internal workflow error reported',
  'Initial-Anfrage gesendet': 'Initial request sent',
  'Keine Status-Weitergabe': 'No status forwarding',
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
  'Unterbrochener Ablauf erkannt': 'Interrupted workflow detected',
  'Weitergabe blockiert': 'Forwarding blocked',
  'Weitergabe gestoppt': 'Forwarding stopped',
  'Weitergabe nicht gesendet': 'Forwarding not sent',
  'Wiederaufnahme blockiert': 'Resume blocked',
  'Wiederaufnahme vorgemerkt': 'Resume checkpoint saved',
  'Workflow wiederaufgenommen': 'Workflow resumed',
  'Workflow-Statuskorrektur angefordert': 'Workflow status correction requested',
  'Workflow-Statuskorrektur fehlgeschlagen': 'Workflow status correction failed',
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
    sha256: '',
    lastSentContent: null,
    updatedAt: new Date().toISOString(),
  }
}

function activePromptDocumentForAgent(agent: Agent) {
  return agent.promptDocuments.find((document) => document.id === agent.activePromptDocumentId) ??
    agent.promptDocuments[0]
}

function agentPromptInstruction(agent: Agent) {
  const content = (activePromptDocumentForAgent(agent)?.content ?? agent.prompt).trim()
  return content || `Du bist ${agent.name}. Arbeite entsprechend deiner Rolle: ${agent.role}`
}

function normalizedInstructionText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')
}

function promptFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
  const baseName = cleaned || 'Neue Prompt-Datei'
  return baseName.toLocaleLowerCase('de-DE').endsWith('.md') ? baseName : `${baseName}.md`
}

function defaultAgentRole(name: string) {
  return `du bist ${name.trim() || 'Agent'}`
}

function isDefaultAgentRole(role: string, name: string) {
  return !role.trim() || role === 'Rolle definieren' || role === defaultAgentRole(name)
}

function normalizeAgent(agent: Partial<Agent>): Agent {
  const legacyAgent = agent as Partial<Agent> & { handoffTo?: string; managementInstructions?: string }
  const name = normalizeGermanTypography(agent.name ?? 'Agent')
  const legacyPrompt = normalizeGermanTypography(agent.prompt ?? '')
  const normalizedStatus =
    agent.status === 'laeuft' && !agent.pendingTurnId ? 'wartet' : agent.status ?? 'wartet'
  const promptDocuments = Array.isArray(agent.promptDocuments) && agent.promptDocuments.length > 0
    ? agent.promptDocuments.map((document) => ({
        id: document.id || crypto.randomUUID(),
        name: normalizeGermanTypography(document.name || 'Anweisung'),
        fileName: promptFileName(document.fileName || document.name || 'Anweisung'),
        content: normalizeGermanTypography(document.content ?? ''),
        filePath: document.filePath ?? '',
        sha256: document.sha256 ?? '',
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
    name,
    role: isDefaultAgentRole(agent.role ?? '', name)
      ? defaultAgentRole(name)
      : normalizeGermanTypography(agent.role as string),
    projectId: agent.projectId ?? '',
    projectPath: agent.projectPath ?? '',
    threadTitle: agent.threadTitle ?? '',
    threadId: agent.threadId ?? '',
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
    usesTeamChat: agent.usesTeamChat ?? true,
    usesProjectKnowledge: agent.usesProjectKnowledge ?? true,
    webAccess: agent.webAccess === 'prompt' || agent.webAccess === 'allowed' ? agent.webAccess : 'off',
    assignment: agent.assignment === 'management' ? 'management' : 'agent',
    teamProvisioningEnabled: agent.teamProvisioningEnabled === true,
    managementInstructionRules: Array.isArray(agent.managementInstructionRules)
      ? agent.managementInstructionRules.filter((instruction): instruction is string => typeof instruction === 'string')
      : [
          ...DEFAULT_CEO_INSTRUCTIONS,
          ...(legacyAgent.managementInstructions?.trim() ? [legacyAgent.managementInstructions.trim()] : []),
        ],
    lastAppliedTeamPlanSignature: agent.lastAppliedTeamPlanSignature ?? '',
    workflowStatusIds: Array.isArray(agent.workflowStatusIds)
      ? Array.from(new Set(agent.workflowStatusIds.filter((id): id is string => typeof id === 'string')))
      : [],
    workflowStatusUpdatedAt: agent.workflowStatusUpdatedAt ?? '',
    finishSignal: agent.finishSignal ?? '"status":"fertig"',
    lastResult: agent.lastResult ?? '',
    instructionVersion: agent.instructionVersion ?? 1,
    lastInstruction: agent.lastInstruction ?? '',
    runStartedAt: agent.runStartedAt ?? '',
    lastDurationMs: agent.lastDurationMs ?? 0,
    completedRuns: agent.completedRuns ?? 0,
    consecutiveFailedRuns: Math.max(0, agent.consecutiveFailedRuns ?? 0),
    pendingTurnId: agent.pendingTurnId ?? '',
    runPurpose: ['chat', 'chat-forward', 'handoff', 'handoff-repair', 'initial', 'prompt', 'status-repair', 'timer'].includes(agent.runPurpose ?? '')
      ? agent.runPurpose as AgentRunPurpose
      : '',
    lastCompletedTurnId: agent.lastCompletedTurnId ?? '',
    lastInboundAgentId: agent.lastInboundAgentId ?? '',
    pendingUserConfirmation: normalizeUserConfirmationRequest(agent.pendingUserConfirmation),
    updatedAt: agent.updatedAt ?? new Date().toISOString(),
  }
}

function normalizeAgentsWithExplicitStatuses(
  values: Array<Partial<Agent>>,
  filters: WorkflowStatusFilter[],
  routes: WorkflowRoute[],
) {
  return values.map((value) => {
    const agent = normalizeAgent(value)
    return {
      ...agent,
      workflowStatusIds: explicitAgentStatusIds(value.workflowStatusIds, agent.id, filters, routes),
    }
  })
}

function deduplicateAgents(agents: Agent[]) {
  const configurationScore = (agent: Agent) => {
    const activeDocument = activePromptDocumentForAgent(agent)
    return (
      (isDefaultAgentRole(agent.role, agent.name) ? 0 : 8) +
      (activeDocument?.filePath ? 8 : 0) +
      (activeDocument && normalizedInstructionText(activeDocument.content) !== normalizedInstructionText('Definiere die Rollen-Anweisung für diesen Codex Task.') ? 4 : 0) +
      (agent.workflowStatusIds?.length ?? 0) * 2 +
      (agent.assignment === 'management' ? 8 : 0) +
      (agent.teamProvisioningEnabled ? 4 : 0) +
      (agent.lastAppliedTeamPlanSignature ? 4 : 0)
    )
  }
  const preferredByThreadId = new Map<string, Agent>()

  agents.forEach((agent) => {
    if (!agent.threadId) return
    const current = preferredByThreadId.get(agent.threadId)
    if (!current || configurationScore(agent) > configurationScore(current)) {
      preferredByThreadId.set(agent.threadId, agent)
    }
  })

  const emittedThreadIds = new Set<string>()
  return agents.filter((agent) => {
    if (agent.threadId) {
      if (preferredByThreadId.get(agent.threadId)?.id !== agent.id || emittedThreadIds.has(agent.threadId)) {
        return false
      }
      emittedThreadIds.add(agent.threadId)
      return true
    }

    return !agents.some(
      (linkedAgent) =>
        linkedAgent.threadId &&
        samePath(linkedAgent.projectPath, agent.projectPath) &&
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
      workflowLoops: [] as WorkflowLoop[],
      workflowLayoutPatterns: [] as WorkflowLayoutPattern[],
      workflowPositions: {} as Record<string, { x: number; y: number }>,
      workflowBoardAgentIds: {} as Record<string, string[]>,
      deliveryQueue: {} as DeliveryQueue,
      workflowRuntime: normalizeWorkflowRuntime(null),
      workflowLoopCounts: {} as WorkflowLoopCounts,
      selectedProjectId: '',
      autoRun: false,
    }
  }

  try {
    const parsed = JSON.parse(stored)
    const parsedRoutes = Array.isArray(parsed.routes) ? parsed.routes : []
    const parsedStatusFilters = normalizeWorkflowStatusFilters(parsed.workflowStatusFilters)
    return {
      agents: Array.isArray(parsed.agents)
        ? deduplicateAgents(normalizeAgentsWithExplicitStatuses(parsed.agents, parsedStatusFilters, parsedRoutes))
        : initialAgents,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      hiddenThreadIds: Array.isArray(parsed.hiddenThreadIds) ? parsed.hiddenThreadIds : [],
      routes: parsedRoutes,
      workflowPrompts: normalizeWorkflowPrompts(parsed.workflowPrompts),
      workflowInitials: Array.isArray(parsed.workflowInitials) ? parsed.workflowInitials : [],
      workflowStatuses: Array.isArray(parsed.workflowStatuses) ? parsed.workflowStatuses : [],
      workflowStatusFilters: parsedStatusFilters,
      workflowStops: Array.isArray(parsed.workflowStops) ? parsed.workflowStops : [],
      workflowTimers: Array.isArray(parsed.workflowTimers) ? parsed.workflowTimers : [],
      workflowLoops: Array.isArray(parsed.workflowLoops) ? parsed.workflowLoops : [],
      workflowLayoutPatterns: Array.isArray(parsed.workflowLayoutPatterns) ? parsed.workflowLayoutPatterns : [],
      workflowPositions:
        parsed.workflowPositions && typeof parsed.workflowPositions === 'object'
          ? parsed.workflowPositions
          : {},
      workflowBoardAgentIds:
        parsed.workflowBoardAgentIds && typeof parsed.workflowBoardAgentIds === 'object'
          ? parsed.workflowBoardAgentIds
          : {},
      deliveryQueue: normalizeDeliveryQueue(parsed.deliveryQueue),
      workflowRuntime: normalizeWorkflowRuntime(parsed.workflowRuntime),
      workflowLoopCounts: normalizeWorkflowLoopCounts(parsed.workflowLoopCounts),
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
      workflowLoops: [] as WorkflowLoop[],
      workflowLayoutPatterns: [] as WorkflowLayoutPattern[],
      workflowPositions: {} as Record<string, { x: number; y: number }>,
      workflowBoardAgentIds: {} as Record<string, string[]>,
      deliveryQueue: {} as DeliveryQueue,
      workflowRuntime: normalizeWorkflowRuntime(null),
      workflowLoopCounts: {} as WorkflowLoopCounts,
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

function isInsideInventoryReconciliationGrace(agent: Agent, now = Date.now()) {
  const updatedAt = new Date(agent.updatedAt).getTime()
  return Number.isFinite(updatedAt) && now - updatedAt < INVENTORY_RECONCILIATION_GRACE_MS
}

function managementInstruction(agent: Agent) {
  if (agent.assignment !== 'management') return ''

  return withInternalInstructions('', [
    'Verwaltungs-Erweiterung:',
    managementRulebook('configuration', agent.managementInstructionRules),
    'Wenn dir ein fehlgeschlagener Agent gemeldet wird, entscheide eindeutig zwischen drei Wegen:',
    '1. Kann derselbe Agent fortfahren, gib ihm eine konkrete, kleinere Wiederaufnahme- oder Überarbeitungsaufgabe und beende deine Antwort mit einem passenden, nicht technischen Workflow-Status.',
    '2. Nutze bei normalen Änderungen, Reparaturen und Weiterentwicklungen immer zuerst das bestehende Team und seine Statuswege. Ein Team-Vorschlag ist nur erlaubt, wenn der Benutzer ausdrücklich einen Teamumbau oder neue Agenten verlangt oder der Orchestrator nach wiederholtem technischem Fehlschlag ausdrücklich eine zusätzliche Rolle anfordert.',
    `3. Ist keine sichere Fortsetzung möglich, melde [Workflow-Status: ${MANAGEMENT_ERROR_STATUS_NAME}]. Der Orchestrator stoppt dann für eine Benutzerentscheidung.`,
    'Du darfst Aufgaben und Rollen vorschlagen. Technische Änderungen an Agenten, Prompts und Verdrahtungen führt weiterhin ausschließlich der Workflow-Orchestrator aus.',
    agent.teamProvisioningEnabled ? managementTeamPlanInstruction() : '',
  ].join('\n'))
}

function managementTeamPlanInstruction(existingStatuses: WorkflowStatusDefinition[] = []) {
  const existingStatusContext = existingStatuses.length > 0
    ? [
        'Bereits vorhandene projektweite Statusbefehle (unverändert wiederverwenden):',
        ...existingStatuses.map((status) => `- ${status.name}: ${status.description}`),
      ]
    : ['Es sind noch keine projektweiten Statusbefehle vorhanden.']
  return [
    '',
    'Kontrollierter Team-Aufbau:',
    'Nur wenn der Benutzer ausdrücklich verlangt, ein Team neu zu erstellen, umzustrukturieren oder Agenten hinzuzufügen beziehungsweise zu ersetzen, planst du vollständig: Agenten, Rollen-Prompts, benötigte Statusbefehle und alle Dashboard-Verbindungen.',
    'Eine Produktänderung, Weiterentwicklung, Reparatur oder neue Funktion ist niemals ein Team-Aufbau. Nutze dafür immer das vorhandene Team und seine Statuswege. Gib in diesem Fall keinen orchestrator_team_plan aus und ändere weder Rollen-Prompts noch Dashboard-Verbindungen.',
    'Der Initial-Baustein enthält niemals eine fachliche Aufgabe. Er führt bei Auto Start immer zuerst zum Verwaltungsagenten beziehungsweise CEO. Erst der CEO wählt mit einem normalen Statusbefehl den ersten Fachagenten aus.',
    'Das Projektziel ist ausschließlich benutzerverwaltet. Nimm kein Feld projectGoal in den Teamplan auf und schlage keine Änderung des Projektziels vor.',
    'Verwende in allen deutschen Namen, Rollen, Bedeutungen und Anweisungen echte Umlaute und ß; niemals ae, oe, ue oder ss als Ersatz.',
    'Liefere zusätzlich genau einen maschinenlesbaren Vorschlag in diesem Format:',
    '<orchestrator_team_plan>',
    '{',
    '  "startAgent": "Erster Fachagent nach der Entscheidung des CEO",',
    '  "startStatus": "Statusbefehl, mit dem der CEO an diesen Fachagenten übergibt",',
    '  "startInstruction": "Nur Dokumentation des Projektziels; wird niemals im Initial gespeichert",',
    '  "statusCommands": [',
    '    { "name": "Weiterleitung", "meaning": "Das Ergebnis soll an den nächsten Agenten weitergegeben werden." }',
    '  ],',
    '  "agents": [',
    '    { "name": "Agentenname", "role": "Klare Rolle", "prompt": "Vollständige Arbeitsanweisung", "usesProjectKnowledge": true, "webAccess": "off", "workflowStatuses": ["Weiterleitung"] }',
    '  ],',
    '  "connections": [',
    '    { "from": "Agentenname", "to": "Anderer Agent", "status": "Weiterleitung" }',
    '  ],',
    '  "stops": [',
    '    { "from": "Abschlussprüfer", "status": "Projekt abgeschlossen", "name": "Projekt abgeschlossen" }',
    '  ]',
    '}',
    '</orchestrator_team_plan>',
    'Definiere unter statusCommands alle Statusbefehle, die der Arbeitsablauf tatsächlich benötigt. Jeder Status braucht einen eindeutigen Namen und eine klare Bedeutung.',
    ...existingStatusContext,
    'Nimm wiederverwendete Statusbefehle mit exakt demselben Namen und exakt derselben Bedeutung in statusCommands auf. Erstelle nur dann einen neuen Statusbefehl, wenn keiner der vorhandenen Befehle den benötigten Zweck abdeckt.',
    'Jede Verbindung muss einen vorhandenen Statusbefehl nennen. Weise jedem Agenten unter workflowStatuses genau die Statusbefehle zu, die er verwenden darf.',
    'Der CEO selbst erhält bei der Übernahme ausschließlich den unter startStatus genannten Statusbefehl. Fachliche Verteilungsstatus gehören nur zu dem Agenten, von dessen Dashboard ihr Pfad ausgeht.',
    'Entscheide für jeden Agenten ausdrücklich mit usesProjectKnowledge: true oder false, ob er für seine Rolle auf die projektweite Wissensdatenbank zugreifen muss. Aktiviere sie nur bei fachlichem Quellenbedarf; eine bloße Workflow-Teilnahme reicht nicht aus.',
    'Entscheide für jeden Agenten ausdrücklich mit webAccess: "off", "prompt" oder "allowed" über den externen Webzugriff. Verwende "allowed" nur, wenn die Rolle das Internet zwingend benötigt, "prompt" für bestätigungspflichtige Ausnahmezugriffe und ansonsten "off".',
    'Definiere unter stops mindestens einen ausdrücklichen Abschlussweg. Ein Stop nennt den Quellagenten, den eindeutigen Abschlussstatus und einen kurzen Namen. Ein normaler Weiterleitungsstatus ist kein Abschlussstatus.',
    'Der Arbeitsablauf darf nicht nur aus einer Endlosschleife bestehen. Jeder erfolgreiche Gesamtabschluss muss über einen Status-Filter zu einem Stop führen.',
    `Der Systemstatus "${MANAGEMENT_ERROR_STATUS_NAME}" ist verpflichtend. Verwende ihn mit der Bedeutung: "${MANAGEMENT_ERROR_STATUS_MEANING}". Weise ihn jedem vorgeschlagenen Agenten zu. Der Orchestrator verdrahtet diesen Status automatisch zurück zum Verwaltungsagenten.`,
    'Wähle ein startAgent aus dem vorgeschlagenen Team und einen startStatus aus statusCommands. Der Orchestrator baut daraus fest Start → CEO → Status-Filter → startAgent. Die startInstruction wird nicht als Initial-Aufgabe ausgeführt.',
    'Verwende nur gültiges JSON. Erfinde keine Projektpfade. Der Orchestrator prüft den Vorschlag und ein Benutzer muss ihn übernehmen.',
  ].join('\n')
}

function internalProjectGoalInstruction(goal: string) {
  const instruction = projectGoalInstruction(goal)
  return instruction ? withInternalInstructions('', instruction) : ''
}

function buildInstruction(
  agent: Agent,
  promptPath: string,
  promptSha256: string,
  promptContent: string,
  statuses: WorkflowStatusDefinition[],
  sources: KnowledgeSource[],
  projectGoal: string,
) {
  return [
    `Rollen-Anweisung für: ${agent.name}`,
    `Rolle: ${agent.role}`,
    managementInstruction(agent),
    '',
    verifiedPromptInstruction({
      path: promptPath,
      projectPath: agent.projectPath,
      sha256: promptSha256,
      content: promptContent,
    }),
    '',
    internalProjectGoalInstruction(projectGoal),
    '',
    knowledgeSourceInstruction(sources),
    '',
    workflowStatusInstruction(statuses),
  ].join('\n')
}

function buildHandoffMessage(
  source: Agent,
  target: Agent,
  route: WorkflowRoute,
  statuses: WorkflowStatusDefinition[],
  sources: KnowledgeSource[],
  projectGoal: string,
  fixedForwarding = false,
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
    'Verbindliche Arbeitsanweisung des Ziel-Agenten:',
    agentPromptInstruction(target),
    target.assignment === 'management'
      ? withInternalInstructions('', managementRulebook('automation', target.managementInstructionRules))
      : '',
    '',
    currentHandoffContextInstruction(),
    fixedForwarding
      ? 'Feste Weiterleitung: Der Orchestrator hat die vorherige Antwort automatisch als Gesprächsbeitrag weitergegeben. Bearbeite den Eingang gemäß deiner Rolle und der Übergabe-Anweisung.'
      : '',
    '',
    'Ergebnis / Auftrag:',
    source.lastResult || 'Kein Ergebnistext hinterlegt.',
    '',
    internalProjectGoalInstruction(projectGoal),
    '',
    knowledgeSourceInstruction(sources),
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

function workflowStatusesForAgent(agent: Agent, statuses: WorkflowStatusDefinition[]) {
  const projectStatuses = statuses.filter((status) =>
    status.id !== UNCONDITIONAL_FORWARD_STATUS_ID &&
    samePath(status.projectPath, agent.projectPath),
  )
  const assignedStatuses = projectStatuses.filter((status) => agent.workflowStatusIds.includes(status.id))
  const fixedForwarding = agent.workflowStatusIds.includes(UNCONDITIONAL_FORWARD_STATUS_ID)
    ? [unconditionalForwardStatus(agent.projectPath)]
    : []
  return [...fixedForwarding, ...assignedStatuses]
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

function translateWorkflowNodeLabel(label: string, language: UiLanguage) {
  if (language === 'de') return label
  const normalized = label.trim()
  if (normalized === 'Weiterleiten') return 'Forward'
  if (normalized === 'Rücksprung') return 'Return'
  if (normalized === 'Zeitplan') return 'Schedule'
  if (normalized === 'Start') return 'Start'
  if (normalized === 'Stop') return 'Stop'
  return label
}

function WorkflowDashboard({
  agents,
  prompts,
  initials,
  statusFilters,
  stops,
  timers,
  loops,
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
  onSelectLoop,
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
  loops: WorkflowLoop[]
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
  onSelectLoop: (loopId: string) => void
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void
  onAgentDrop: (agentId: string, position: { x: number; y: number }) => void
  draggedAgentId: string
  selectedAgentNodeId: string
  language: UiLanguage
}) {
  void statuses
  const portLabels = useMemo(() => ({
    inputLabel: language === 'de' ? 'IN' : 'IN',
    outputLabel: language === 'de' ? 'OUT' : 'OUT',
    normalOutputLabel: language === 'de' ? 'NORMAL' : 'NORMAL',
    intervalOutputLabel: language === 'de' ? 'INTERVALL' : 'INTERVAL',
  }), [language])
  const initialNodes = useMemo<Node[]>(
    () =>
      [
        ...agents.map((agent, index) => {
          const activeStep = isAgentWorking({
            status: agent.status,
            pendingTurnId: agent.pendingTurnId,
            isTransmitting: false,
          })
          return {
            id: agent.id,
            type: 'workflow',
            width: 190,
            height: 64,
            position: positions[agent.id] ?? { x: 70 + (index % 3) * 220, y: 70 + Math.floor(index / 3) * 150 },
            data: { label: agent.name, kind: 'agent' as const, status: agent.status, kindLabel: 'Agent', ...portLabels },
            className: `workflowNode agent ${agent.status} ${activeStep ? 'activeStep' : ''} ${agent.id === selectedAgentNodeId ? 'nodeSelected' : ''}`,
          }
        }),
        ...prompts.map((prompt, index) => ({
          id: prompt.id,
          type: 'workflow',
          width: 190,
          height: prompt.interval ? 128 : 64,
          position: positions[prompt.id] ?? { x: 180 + (index % 3) * 220, y: 250 + Math.floor(index / 3) * 150 },
          data: {
            label: translateWorkflowNodeLabel(prompt.name, language),
            kind: 'prompt' as const,
            kindLabel: language === 'de' ? 'Weiterleiten' : 'Forward',
            interval: prompt.interval,
            intervalCount: prompt.intervalCount,
            intervalMode: prompt.intervalMode,
            ...portLabels,
          },
          className: 'workflowNode prompt',
        })),
        ...initials.map((initial, index) => ({
          id: initial.id,
          type: 'workflow',
          width: 190,
          height: 64,
          position: positions[initial.id] ?? { x: 40, y: 70 + index * 130 },
          data: {
            label: translateWorkflowNodeLabel(initial.name, language),
            kind: 'initial' as const,
            kindLabel: 'Start',
            hasInstruction: initial.instructionSource === 'user' && Boolean(initial.instruction.trim()),
            instructionIndicatorLabel: language === 'de'
              ? 'Optionale Anweisung vorhanden'
              : 'Optional instruction available',
            ...portLabels,
          },
          className: 'workflowNode initial',
        })),
        ...statusFilters.map((filter, index) => {
          return {
            id: filter.id,
            type: 'workflow',
            width: 190,
            height: filter.interval ? 128 : 64,
            position: positions[filter.id] ?? { x: 260 + (index % 3) * 220, y: 430 + Math.floor(index / 3) * 130 },
            data: {
              label: language === 'de' ? 'Weiterleiten' : 'Forward',
              kind: 'status' as const,
              kindLabel: language === 'de' ? 'Weiterleiten' : 'Forward',
              interval: filter.interval,
              intervalCount: filter.intervalCount,
              intervalMode: filter.intervalMode,
              ...portLabels,
            },
            className: 'workflowNode statusFilter',
          }
        }),
        ...stops.map((stop, index) => ({
          id: stop.id,
          type: 'workflow',
          width: 190,
          height: 64,
          position: positions[stop.id] ?? { x: 700, y: 120 + index * 130 },
          data: {
            label: translateWorkflowNodeLabel(stop.name, language),
            kind: 'stop' as const,
            kindLabel: language === 'de' ? 'Pfad beenden' : 'End path',
            ...portLabels,
          },
          className: 'workflowNode stop',
        })),
        ...timers.map((timer, index) => ({
          id: timer.id,
          type: 'workflow',
          width: 190,
          height: 64,
          position: positions[timer.id] ?? { x: 40, y: 240 + index * 130 },
          data: {
            label: translateWorkflowNodeLabel(timer.name, language),
            kind: 'timer' as const,
            kindLabel: language === 'de' ? 'Zeitsteuerung' : 'Schedule',
            ...portLabels,
          },
          className: `workflowNode timer ${timer.enabled ? 'enabled' : 'disabled'}`,
        })),
        ...loops.map((loop, index) => ({
          id: loop.id,
          type: 'workflow',
          width: 190,
          height: 72 + Math.max(0, ((loop.targetAgentIds?.length || (loop.targetAgentId ? 1 : 0)) - 1)) * 18,
          position: positions[loop.id] ?? { x: 700, y: 300 + index * 130 },
          data: {
            label: translateWorkflowNodeLabel(loop.name, language),
            kind: 'loop' as const,
            kindLabel: loop.targetAgentIds?.length
              ? `${language === 'de' ? 'Zu' : 'To'}: ${loop.targetAgentIds
                .map((targetId) => agents.find((agent) => agent.id === targetId)?.name)
                .filter(Boolean)
                .join(', ')}`
              : language === 'de' ? 'Ziel wählen' : 'Select target',
            ...portLabels,
          },
          className: 'workflowNode loop',
        })),
      ],
    [agents, initials, language, loops, portLabels, positions, prompts, selectedAgentNodeId, statusFilters, stops, timers],
  )
  const initialEdges = useMemo<Edge[]>(
    () =>
      routes.map((route) => ({
        id: route.id,
        source: route.sourceId,
        target: route.targetId,
        sourceHandle: route.sourceHandle ?? 'output',
        targetHandle: 'input',
        type: 'workflow',
        interactionWidth: 28,
        animated: autoRun,
        className: route.id === selectedRouteId ? 'selectedRoute' : '',
      })),
    [autoRun, routes, selectedRouteId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const updateNodeInternals = useUpdateNodeInternals()
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [agentDragOver, setAgentDragOver] = useState(false)
  const [gridEnabled, setGridEnabled] = useState(false)
  const initialNodesRef = useRef(initialNodes)
  const isNodeDraggingRef = useRef(false)
  const previousDashboardIdRef = useRef(dashboardId)
  const nodeSignature = initialNodes.map((node) => node.id).sort().join(':')
  const handleSignature = [
    ...prompts.map((prompt) => `${prompt.id}:${prompt.interval}:${prompt.intervalMode}`),
    ...statusFilters.map((filter) => `${filter.id}:${filter.interval ?? 0}:${filter.intervalMode ?? 'replace'}`),
  ].join(':')

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

  useEffect(() => {
    if (!nodeSignature) return
    const frame = window.requestAnimationFrame(() => {
      initialNodesRef.current.forEach((node) => updateNodeInternals(node.id))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [dashboardId, handleSignature, nodeSignature, updateNodeInternals])

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
          flowInstance.screenToFlowPosition(
            { x: event.clientX, y: event.clientY },
            { snapToGrid: gridEnabled, snapGrid: WORKFLOW_SNAP_GRID },
          ),
        )
      }}
    >
      <button
        aria-label={language === 'de' ? 'Raster ein- oder ausschalten' : 'Toggle grid snapping'}
        aria-pressed={gridEnabled}
        className={`workflowGridToggle ${gridEnabled ? 'active' : ''}`}
        onClick={() => setGridEnabled((current) => !current)}
        title={language === 'de' ? 'Snap to Grid' : 'Snap to grid'}
        type="button"
      >
        G
      </button>
      <ReactFlow
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        onInit={setFlowInstance}
        nodes={nodes}
        edges={initialEdges}
        onNodesChange={onNodesChange}
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
          } else if (loops.some((loop) => loop.id === node.id)) {
            onSelectLoop(node.id)
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
        autoPanOnConnect={false}
        connectionLineComponent={WorkflowConnectionLine}
        connectionLineStyle={{ stroke: '#a1a1aa', strokeWidth: 2.5 }}
        connectionRadius={26}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        nodeDragThreshold={4}
        reconnectRadius={26}
        snapGrid={WORKFLOW_SNAP_GRID}
        snapToGrid={gridEnabled}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export const ChatComposer = function ChatComposer({
  agentId,
  enabled,
  sending,
  ariaLabel,
  placeholder,
  sendTitle,
  onSend,
}: {
  agentId: string
  enabled: boolean
  sending: boolean
  ariaLabel: string
  placeholder: string
  sendTitle: string
  onSend: (agentId: string, text: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')

  useEffect(() => setDraft(''), [agentId])

  const submit = async () => {
    const text = draft.trim()
    if (!text || !enabled || sending) return
    if (await onSend(agentId, text)) setDraft('')
  }

  return (
    <form
      className="chatComposer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <textarea
        aria-label={ariaLabel}
        disabled={!enabled || sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={placeholder}
        rows={2}
        value={draft}
      />
      <button
        aria-label={sendTitle}
        className="sendChatButton"
        disabled={!draft.trim() || !enabled || sending}
        title={sendTitle}
        type="submit"
      >
        {sending ? '…' : '↑'}
      </button>
    </form>
  )
}

function chatMessageSnapshot(messages: readonly ChatMessage[]) {
  return messages.map((message) => [
    message.id,
    message.sourceAgentId ?? '',
    message.turnStatus,
    message.text.length,
    message.text.slice(-80),
    message.workspaceChanges?.length ?? 0,
  ].join(':')).join('|')
}

function App() {
  const [storedState] = useState(loadStoredState)
  const [programSettings, setProgramSettings] = useState(loadProgramSettings)
  const initialProgramSettingsRef = useRef(programSettings)
  const [programSettingsHydrated, setProgramSettingsHydrated] = useState(false)
  const programSettingsUpdatedAtRef = useRef('')
  const programSettingsDirtyRef = useRef(false)
  const skipNextProgramSettingsSaveRef = useRef(true)
  const programSettingsRemoteUpdateRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [settingsSearch, setSettingsSearch] = useState('')
  const [accountSuggestedName, setAccountSuggestedName] = useState('')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [agents, setAgents] = useState<Agent[]>(storedState.agents)
  const [events, setEvents] = useState<EventLog[]>(storedState.events)
  const [codexProjects, setCodexProjects] = useState<CodexProject[]>(initialCodexProjects)
  const [codexThreads, setCodexThreads] = useState<CodexThread[]>(initialCodexThreads)
  const [connectorOnline, setConnectorOnline] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [approvalResolvingId, setApprovalResolvingId] = useState('')
  const [approvalError, setApprovalError] = useState('')
  const [userConfirmationResolvingAgentId, setUserConfirmationResolvingAgentId] = useState('')
  const [userConfirmationError, setUserConfirmationError] = useState('')
  const [userQuestionAnswer, setUserQuestionAnswer] = useState('')
  const [stallNotice, setStallNotice] = useState<StallNotice | null>(null)
  const [workflowStopNotice, setWorkflowStopNotice] = useState<WorkflowStopNotice | null>(null)
  const [provisioningRecovery, setProvisioningRecovery] = useState<ProvisioningRecovery | null>(null)
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
  const [agentPendingDeletionId, setAgentPendingDeletionId] = useState('')
  const [agentDeleteError, setAgentDeleteError] = useState('')
  const [agentCreationOpen, setAgentCreationOpen] = useState(false)
  const [newAgentChatId, setNewAgentChatId] = useState('')
  const [agentCreationBusy, setAgentCreationBusy] = useState(false)
  const [agentCreationError, setAgentCreationError] = useState('')
  const [agentEditId, setAgentEditId] = useState('')
  const [agentEditName, setAgentEditName] = useState('')
  const [agentEditChatId, setAgentEditChatId] = useState('')
  const [agentEditBusy, setAgentEditBusy] = useState(false)
  const [agentEditError, setAgentEditError] = useState('')
  const [teamPlanApplying, setTeamPlanApplying] = useState(false)
  const [teamPlanFormatRequesting, setTeamPlanFormatRequesting] = useState(false)
  const [teamPlanError, setTeamPlanError] = useState('')
  const [teamPlanProgress, setTeamPlanProgress] = useState('')
  const [dismissedTeamPlanSignature, setDismissedTeamPlanSignature] = useState('')
  const [teamReadyNotice, setTeamReadyNotice] = useState<{ project: string; agents: number; statuses: number; connections: number; stops: number } | null>(null)
  const [autoRun, setAutoRun] = useState(storedState.autoRun)
  const [workflowLoopCounts, setWorkflowLoopCounts] = useState<WorkflowLoopCounts>(storedState.workflowLoopCounts)
  const [workflowLoopCountDraft, setWorkflowLoopCountDraft] = useState('')
  const [workflowLoopCountEditing, setWorkflowLoopCountEditing] = useState(false)
  const workflowLoopInputRef = useRef<HTMLInputElement | null>(null)
  const [workflowResetting, setWorkflowResetting] = useState(false)
  const [projectFilter, setProjectFilter] = useState(storedState.selectedProjectId)
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>(storedState.hiddenThreadIds)
  const [routes, setRoutes] = useState<WorkflowRoute[]>(storedState.routes)
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPrompt[]>(storedState.workflowPrompts)
  const [workflowInitials, setWorkflowInitials] = useState<WorkflowInitial[]>(storedState.workflowInitials)
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatusDefinition[]>(storedState.workflowStatuses)
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([])
  const [projectGoals, setProjectGoals] = useState<ProjectGoal[]>([])
  const [workflowStatusFilters, setWorkflowStatusFilters] = useState<WorkflowStatusFilter[]>(
    storedState.workflowStatusFilters,
  )
  const [workflowStops, setWorkflowStops] = useState<WorkflowStop[]>(storedState.workflowStops)
  const [workflowTimers, setWorkflowTimers] = useState<WorkflowTimer[]>(storedState.workflowTimers)
  const [workflowLoops, setWorkflowLoops] = useState<WorkflowLoop[]>(storedState.workflowLoops)
  const [workflowLayoutPatterns, setWorkflowLayoutPatterns] = useState<WorkflowLayoutPattern[]>(storedState.workflowLayoutPatterns)
  const [workflowPositions, setWorkflowPositions] = useState<Record<string, { x: number; y: number }>>(
    storedState.workflowPositions,
  )
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [selectedInitialId, setSelectedInitialId] = useState('')
  const [selectedStatusFilterId, setSelectedStatusFilterId] = useState('')
  const [selectedStopId, setSelectedStopId] = useState('')
  const [selectedTimerId, setSelectedTimerId] = useState('')
  const [selectedLoopId, setSelectedLoopId] = useState('')
  const [newWorkflowStatusName, setNewWorkflowStatusName] = useState('')
  const [newWorkflowStatusDescription, setNewWorkflowStatusDescription] = useState('')
  const [statusLibraryOpen, setStatusLibraryOpen] = useState(false)
  const [knowledgeLibraryOpen, setKnowledgeLibraryOpen] = useState(false)
  const [projectGoalOpen, setProjectGoalOpen] = useState(false)
  const [projectGoalDraft, setProjectGoalDraft] = useState('')
  const [projectGoalSaving, setProjectGoalSaving] = useState(false)
  const [projectGoalError, setProjectGoalError] = useState('')
  const [knowledgeSourceName, setKnowledgeSourceName] = useState('')
  const [knowledgeSourceType, setKnowledgeSourceType] = useState<KnowledgeSourceType>('repository')
  const [knowledgeSourceLocation, setKnowledgeSourceLocation] = useState('')
  const [knowledgeSourceDescription, setKnowledgeSourceDescription] = useState('')
  const [knowledgeSourceSaving, setKnowledgeSourceSaving] = useState(false)
  const [knowledgeSourceError, setKnowledgeSourceError] = useState('')
  const [editingWorkflowStatusId, setEditingWorkflowStatusId] = useState('')
  const [editingWorkflowStatusName, setEditingWorkflowStatusName] = useState('')
  const [editingWorkflowStatusDescription, setEditingWorkflowStatusDescription] = useState('')
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [layoutPatternFeedback, setLayoutPatternFeedback] = useState('')
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState('')
  const [workflowBoardAgentIds, setWorkflowBoardAgentIds] = useState<Record<string, string[]>>(
    storedState.workflowBoardAgentIds,
  )
  const [deliveryQueue, setDeliveryQueue] = useState<DeliveryQueue>(storedState.deliveryQueue)
  const [workflowRuntime, setWorkflowRuntime] = useState<WorkflowRuntime>(storedState.workflowRuntime)
  const [eventLogCollapsed, setEventLogCollapsed] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [managementInstructionsOpen, setManagementInstructionsOpen] = useState(false)
  const [managementInstructionDraft, setManagementInstructionDraft] = useState('')
  const [promptCreationOpen, setPromptCreationOpen] = useState(false)
  const [newPromptName, setNewPromptName] = useState('')
  const [promptRenameOpen, setPromptRenameOpen] = useState(false)
  const [renamedPromptName, setRenamedPromptName] = useState('')
  const [pendingPromptDeliveryAgentId, setPendingPromptDeliveryAgentId] = useState('')
  const [transmittingAgentIds, setTransmittingAgentIds] = useState<string[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    if (!layoutPatternFeedback) return undefined
    const timeout = window.setTimeout(() => setLayoutPatternFeedback(''), 1600)
    return () => window.clearTimeout(timeout)
  }, [layoutPatternFeedback])

  const copy = languageCopy[language]
  const effectiveTheme: Exclude<ThemeMode, 'system'> = programSettings.theme === 'system'
    ? systemDark ? 'dark' : 'light'
    : programSettings.theme
  const profileName = programSettings.displayName.trim() || accountSuggestedName || 'Codex'
  const profileInitials = getProfileInitials(profileName)
  const themeVariables = useMemo(() => {
    const background = isHexColor(programSettings.backgroundColor)
      ? programSettings.backgroundColor
      : defaultProgramSettings.backgroundColor
    const foreground = isHexColor(programSettings.foregroundColor)
      ? programSettings.foregroundColor
      : defaultProgramSettings.foregroundColor
    const accent = isHexColor(programSettings.accentColor)
      ? programSettings.accentColor
      : defaultProgramSettings.accentColor
    const button = isHexColor(programSettings.buttonColor)
      ? programSettings.buttonColor
      : defaultProgramSettings.buttonColor
    const buttonText = isHexColor(programSettings.buttonTextColor)
      ? programSettings.buttonTextColor
      : defaultProgramSettings.buttonTextColor
    const topbar = isHexColor(programSettings.topbarColor)
      ? programSettings.topbarColor
      : defaultProgramSettings.topbarColor
    const projectBar = isHexColor(programSettings.projectBarColor)
      ? programSettings.projectBarColor
      : defaultProgramSettings.projectBarColor
    const agentRail = isHexColor(programSettings.agentRailColor)
      ? programSettings.agentRailColor
      : defaultProgramSettings.agentRailColor
    const workspace = isHexColor(programSettings.workspaceColor)
      ? programSettings.workspaceColor
      : defaultProgramSettings.workspaceColor
    const eventLog = isHexColor(programSettings.eventLogColor)
      ? programSettings.eventLogColor
      : defaultProgramSettings.eventLogColor
    const contrast = programSettings.contrast / 100
    const isLightTheme = effectiveTheme === 'light'
    return {
      '--canvas': background,
      '--surface': mixHexColors(background, foreground, 0.035 + contrast * 0.045),
      '--surface-raised': mixHexColors(background, foreground, 0.06 + contrast * 0.065),
      '--surface-hover': mixHexColors(background, foreground, 0.09 + contrast * 0.08),
      '--surface-inset': mixHexColors(background, foreground, isLightTheme ? 0.018 : 0.025),
      '--surface-accent': mixHexColors(background, accent, isLightTheme ? 0.11 : 0.16),
      '--message-user': mixHexColors(background, foreground, isLightTheme ? 0.045 : 0.095),
      '--message-agent': mixHexColors(background, accent, isLightTheme ? 0.1 : 0.14),
      '--line': mixHexColors(background, foreground, 0.11 + contrast * 0.1),
      '--line-strong': mixHexColors(background, foreground, 0.17 + contrast * 0.12),
      '--text': foreground,
      '--muted': mixHexColors(
        background,
        foreground,
        isLightTheme ? 0.68 + contrast * 0.06 : 0.54 + contrast * 0.12,
      ),
      '--accent': accent,
      '--accent-strong': isLightTheme ? mixHexColors(accent, foreground, 0.62) : accent,
      '--button-surface': button,
      '--button-surface-hover': mixHexColors(button, buttonText, 0.12),
      '--button-text': buttonText,
      '--topbar-surface': topbar,
      '--project-surface': projectBar,
      '--agent-surface': agentRail,
      '--workspace-surface': workspace,
      '--event-surface': eventLog,
      '--shadow-color': isLightTheme ? 'rgb(15 23 42 / 16%)' : 'rgb(0 0 0 / 45%)',
      '--ui-font': `"${programSettings.uiFont}", "Segoe UI", sans-serif`,
      '--code-font': `"${programSettings.codeFont}", ui-monospace, monospace`,
    } as CSSProperties
  }, [effectiveTheme, programSettings])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    window.localStorage.setItem(PROGRAM_SETTINGS_STORAGE_KEY, JSON.stringify(programSettings))
    if (!programSettingsHydrated) return
    if (skipNextProgramSettingsSaveRef.current) {
      skipNextProgramSettingsSaveRef.current = false
      programSettingsRemoteUpdateRef.current = false
      return
    }
    if (programSettingsRemoteUpdateRef.current) {
      programSettingsRemoteUpdateRef.current = false
      return
    }
    programSettingsDirtyRef.current = true
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/program-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: programSettings }),
        })
        if (!response.ok) return
        const data = await response.json()
        programSettingsUpdatedAtRef.current = typeof data.updatedAt === 'string' ? data.updatedAt : ''
        programSettingsDirtyRef.current = false
      } catch {
        // The local copy remains available while the connector is offline.
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [programSettings, programSettingsHydrated])

  useEffect(() => {
    let active = true
    const loadGlobalSettings = async () => {
      try {
        const response = await fetch('/api/program-settings')
        if (!response.ok) return
        const data = await response.json()
        if (!active) return
        if (data.settings) {
          programSettingsRemoteUpdateRef.current = true
          setProgramSettings((current) => normalizeProgramSettingsClient({ ...current, ...data.settings }))
          programSettingsUpdatedAtRef.current = typeof data.updatedAt === 'string' ? data.updatedAt : ''
        } else if (hasCustomizedProgramSettings(initialProgramSettingsRef.current)) {
          const createResponse = await fetch('/api/program-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: initialProgramSettingsRef.current }),
          })
          if (createResponse.ok) {
            const created = await createResponse.json()
            programSettingsUpdatedAtRef.current = typeof created.updatedAt === 'string' ? created.updatedAt : ''
          }
        }
      } catch {
        // Browser-local settings remain usable until the connector is available.
      } finally {
        if (active) setProgramSettingsHydrated(true)
      }
    }
    void loadGlobalSettings()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!programSettingsHydrated) return
    let active = true
    const syncGlobalSettings = async () => {
      if (programSettingsDirtyRef.current) return
      try {
        const response = await fetch('/api/program-settings')
        if (!response.ok) return
        const data = await response.json()
        if (!active || !data.settings || data.updatedAt === programSettingsUpdatedAtRef.current) return
        programSettingsUpdatedAtRef.current = typeof data.updatedAt === 'string' ? data.updatedAt : ''
        programSettingsRemoteUpdateRef.current = true
        setProgramSettings((current) => normalizeProgramSettingsClient({ ...current, ...data.settings }))
      } catch {
        // Connector health is shown separately.
      }
    }
    const timer = window.setInterval(() => void syncGlobalSettings(), 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [programSettingsHydrated])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemDark(media.matches)
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    document.documentElement.style.colorScheme = effectiveTheme
    document.body.style.background = programSettings.backgroundColor
  }, [effectiveTheme, programSettings.backgroundColor])

  useEffect(() => {
    if (programSettings.theme !== 'system') {
      return
    }
    const backgroundColor = systemDark ? defaultProgramSettings.backgroundColor : '#f7f7f8'
    const foregroundColor = systemDark ? defaultProgramSettings.foregroundColor : '#18181b'
    setProgramSettings((current) => {
      if (current.backgroundColor === backgroundColor && current.foregroundColor === foregroundColor) {
        return current
      }
      return { ...current, backgroundColor, foregroundColor }
    })
  }, [programSettings.theme, systemDark])
  const [chatError, setChatError] = useState('')
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true)
  const [communicationView, setCommunicationView] = useState<'overview' | 'chat'>('overview')
  const [communicationChatScope, setCommunicationChatScope] = useState<'team' | 'agent'>('team')
  const [, setChatSending] = useState(false)
  const chatMessagesSnapshotRef = useRef('')
  const chatSendHandlerRef = useRef<(agentId: string, text: string) => Promise<boolean>>(
    async () => false,
  )
  const [usageSummary, setUsageSummary] = useState<UsageSummary>({
    remainingPercent: null,
    resetsAt: null,
    credits: null,
    unlimited: false,
  })
  const [sharedStateReady, setSharedStateReady] = useState(false)
  const [checkpointRecoveryRevision, setCheckpointRecoveryRevision] = useState(0)
  const sharedStateVersion = useRef('')
  const sharedStateDirty = useRef(false)
  const sharedStateWrites = useRef(createLatestWriteQueue())
  const teamPlanApplyingRef = useRef(false)
  const automaticTeamPlanFormatRequests = useRef(new Set<string>())
  const authorizedTeamPlanRequestAgentIds = useRef(new Set<string>())
  const requestTeamPlanFormatCorrectionRef = useRef<(agent: Agent) => Promise<void>>(async () => {})
  const startInitialWorkflowsRef = useRef<(
    options?: { repeatCycle?: number; targetCycles?: number }
  ) => Promise<{ sentCount: number; busyCount: number }>>(
    async () => ({ sentCount: 0, busyCount: 0 }),
  )
  const autoRunRef = useRef(autoRun)
  const automationTabId = useRef(crypto.randomUUID())
  const automationLeaderRef = useRef(false)
  const [automationLeader, setAutomationLeader] = useState(false)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const pollingTurnIds = useRef(new Set<string>())
  const processedTurnIds = useRef(new Set(agents.map((agent) => agent.lastCompletedTurnId).filter(Boolean)))
  const recoveredCheckpointIds = useRef(new Set<string>())
  agents.forEach((agent) => {
    if (agent.lastCompletedTurnId) processedTurnIds.current.add(agent.lastCompletedTurnId)
  })
  const watchdogInterventionTurnIds = useRef(new Set<string>())
  const terminalResultObservations = useRef(new Map<string, number>())
  const turnActivityObservations = useRef(new Map<string, TurnActivityObservation>())
  const activeDeliveryTargetIds = useRef(new Set<string>())
  const deliveryQueueRef = useRef(deliveryQueue)
  deliveryQueueRef.current = deliveryQueue
  const workflowRuntimeRef = useRef(workflowRuntime)
  workflowRuntimeRef.current = workflowRuntime
  const timerDispatchIds = useRef(new Set<string>())
  const chatStreamRef = useRef<HTMLDivElement>(null)
  const tx = useCallback(
    (de: string, en: string) => language === 'de' ? de : en,
    [language],
  )
  const updateDeliveryQueue = useCallback((
    updater: (current: DeliveryQueue) => DeliveryQueue,
  ) => {
    const next = updater(deliveryQueueRef.current)
    deliveryQueueRef.current = next
    setDeliveryQueue(next)
  }, [])
  const updateWorkflowRuntime = useCallback((
    updater: (current: WorkflowRuntime) => WorkflowRuntime,
  ) => {
    const next = updater(workflowRuntimeRef.current)
    workflowRuntimeRef.current = next
    setWorkflowRuntime(next)
  }, [])

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      document.querySelectorAll<HTMLElement>('details.dashboardAgentMenu[open], details.dashboardTools[open], details.dashboardStatusMenu[open], details.promptStatusMenu[open]').forEach((menu) => {
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

  const claimAutomationLease = useCallback(() => {
    const now = Date.now()
    const current = readAutomationLease()
    if (current && current.ownerId !== automationTabId.current && current.expiresAt > now) {
      automationLeaderRef.current = false
      setAutomationLeader(false)
      return false
    }
    const nextLease: AutomationLease = {
      ownerId: automationTabId.current,
      expiresAt: now + AUTOMATION_LEASE_DURATION_MS,
    }
    window.localStorage.setItem(AUTOMATION_LEASE_KEY, JSON.stringify(nextLease))
    const confirmed = readAutomationLease()?.ownerId === automationTabId.current
    automationLeaderRef.current = confirmed
    setAutomationLeader(confirmed)
    return confirmed
  }, [])

  const releaseAutomationLease = useCallback(() => {
    if (readAutomationLease()?.ownerId === automationTabId.current) {
      window.localStorage.removeItem(AUTOMATION_LEASE_KEY)
    }
    automationLeaderRef.current = false
    setAutomationLeader(false)
  }, [])

  useEffect(() => {
    if (!autoRun) {
      releaseAutomationLease()
      return
    }

    const refreshLease = () => claimAutomationLease()
    const handleStorage = (event: StorageEvent) => {
      if (event.key === AUTOMATION_LEASE_KEY) refreshLease()
    }

    refreshLease()
    const timer = window.setInterval(refreshLease, 2_000)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('storage', handleStorage)
      releaseAutomationLease()
    }
  }, [autoRun, claimAutomationLease, releaseAutomationLease])

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
      workflowLoops,
      workflowLayoutPatterns,
      workflowPositions,
      workflowBoardAgentIds,
      deliveryQueue,
      workflowRuntime,
      workflowLoopCounts,
      selectedProjectId: projectFilter,
      autoRun,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // The shared server state remains authoritative when browser storage is full or unavailable.
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Storage can also be entirely unavailable in a restricted browser context.
      }
    }
    if (!sharedStateReady) {
      return
    }
    sharedStateDirty.current = true
    const revision = sharedStateWrites.current.nextRevision()
    const timer = window.setTimeout(() => {
      void sharedStateWrites.current.enqueue(revision, async (isLatest) => {
        try {
          const response = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              state,
              expectedUpdatedAt: sharedStateVersion.current,
            }),
          })
          const data = await response.json()
          if (response.ok) {
            sharedStateVersion.current = data.updatedAt
            if (isLatest()) {
              sharedStateDirty.current = false
            }
          } else if (response.status === 409 && isLatest()) {
            const serverState = data.state && typeof data.state === 'object' ? data.state : null
            const serverUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : ''
            if (!serverState || !serverUpdatedAt) {
              return
            }
            const mergedState = {
              ...serverState,
              workflowLoopCounts: {
                ...normalizeWorkflowLoopCounts(serverState.workflowLoopCounts),
                ...workflowLoopCounts,
              },
            }
            const retryResponse = await fetch('/api/state', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                state: mergedState,
                expectedUpdatedAt: serverUpdatedAt,
              }),
            })
            const retryData = await retryResponse.json()
            if (retryResponse.ok) {
              sharedStateVersion.current = retryData.updatedAt
              sharedStateDirty.current = false
            }
          }
        } catch {
          // LocalStorage remains the offline fallback.
        }
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [agents, autoRun, deliveryQueue, events, hiddenThreadIds, projectFilter, routes, sharedStateReady, workflowBoardAgentIds, workflowInitials, workflowLayoutPatterns, workflowLoopCounts, workflowLoops, workflowPositions, workflowPrompts, workflowRuntime, workflowStatusFilters, workflowStatuses, workflowStops, workflowTimers])

  const applySharedState = useCallback((state: ReturnType<typeof loadStoredState>) => {
    const incomingRoutes = Array.isArray(state.routes) ? state.routes : []
    const incomingStatusFilters = normalizeWorkflowStatusFilters(state.workflowStatusFilters)
    const incomingAgents = Array.isArray(state.agents)
      ? deduplicateAgents(normalizeAgentsWithExplicitStatuses(state.agents, incomingStatusFilters, incomingRoutes))
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
    setRoutes(incomingRoutes)
    setWorkflowPrompts(normalizeWorkflowPrompts(state.workflowPrompts))
    setWorkflowInitials(Array.isArray(state.workflowInitials) ? state.workflowInitials : [])
    setWorkflowStatuses(Array.isArray(state.workflowStatuses) ? state.workflowStatuses : [])
    setWorkflowStatusFilters(incomingStatusFilters)
    setWorkflowStops(Array.isArray(state.workflowStops) ? state.workflowStops : [])
    setWorkflowTimers(Array.isArray(state.workflowTimers) ? state.workflowTimers : [])
    setWorkflowLoops(Array.isArray(state.workflowLoops) ? state.workflowLoops : [])
    setWorkflowLayoutPatterns(Array.isArray(state.workflowLayoutPatterns) ? state.workflowLayoutPatterns : [])
    setWorkflowPositions(state.workflowPositions ?? {})
    setWorkflowBoardAgentIds(state.workflowBoardAgentIds ?? {})
    const incomingDeliveryQueue = normalizeDeliveryQueue(state.deliveryQueue)
    deliveryQueueRef.current = incomingDeliveryQueue
    setDeliveryQueue(incomingDeliveryQueue)
    const incomingWorkflowRuntime = normalizeWorkflowRuntime(state.workflowRuntime)
    workflowRuntimeRef.current = incomingWorkflowRuntime
    setWorkflowRuntime(incomingWorkflowRuntime)
    setWorkflowLoopCounts(normalizeWorkflowLoopCounts(state.workflowLoopCounts))
    setAutoRun(state.autoRun === true)
    if (state.selectedProjectId) {
      setProjectFilter(state.selectedProjectId)
    }
  }, [])

  useEffect(() => {
    let active = true
    const synchronize = async (initial = false) => {
      let loadedSharedState = false
      try {
        const response = await fetch('/api/state')
        if (!response.ok) {
          throw new Error('Gemeinsamer Zustand nicht erreichbar.')
        }
        const data = await response.json()
        loadedSharedState = Boolean(data.state && data.updatedAt)
        if (
          active &&
          data.state &&
          data.updatedAt &&
          (initial || (!sharedStateDirty.current && data.updatedAt !== sharedStateVersion.current))
        ) {
          sharedStateVersion.current = data.updatedAt
          applySharedState(data.state)
        }
      } catch {
        // The current browser state remains available while the connector is offline.
      } finally {
        if (initial && active) {
          setSharedStateReady(loadedSharedState)
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
  const pendingUserConfirmationAgent = agents.find(
    (agent) => agent.pendingUserConfirmation && !agent.pendingUserConfirmation.dismissed,
  )
  useEffect(() => {
    setUserQuestionAnswer('')
    setUserConfirmationError('')
  }, [pendingUserConfirmationAgent?.id, pendingUserConfirmationAgent?.pendingUserConfirmation?.requestedAt])
  const selectedProjectPath = selectedProject?.path ?? ''
  const selectedLoopProjectAliases = useMemo(
    () => selectedProjectPath
      ? [selectedProjectPath, `path:${selectedProjectPath}`]
      : [],
    [selectedProjectPath],
  )
  const selectedWorkflowRun = activeWorkflowRun(workflowRuntime, selectedProjectPath)
  const selectedLoopCount = workflowLoopCountForProject(
    workflowLoopCounts,
    selectedProject?.id ?? projectFilter,
    selectedLoopProjectAliases,
  )
  const persistSelectedLoopCount = useCallback((count: unknown) => {
    if (!selectedProject && !projectFilter) return normalizeWorkflowLoopCount(count)
    const normalized = normalizeWorkflowLoopCount(count)
    sharedStateDirty.current = true
    setWorkflowLoopCounts((current) => setWorkflowLoopCount(
      current,
      selectedProject?.id ?? projectFilter,
      normalized,
      selectedLoopProjectAliases,
    ))
    return normalized
  }, [projectFilter, selectedLoopProjectAliases, selectedProject])
  useEffect(() => {
    if (!workflowLoopCountEditing) {
      setWorkflowLoopCountDraft(String(selectedLoopCount))
    }
  }, [selectedLoopCount, workflowLoopCountEditing])
  const handleSelectedLoopCountInput = useCallback((value: string) => {
    setWorkflowLoopCountDraft(value)
    if (value.trim()) {
      persistSelectedLoopCount(value)
    }
  }, [persistSelectedLoopCount])
  const selectedLoopProgress = selectedWorkflowRun
    ? workflowRunCycleProgress(workflowRuntime, selectedProjectPath)
    : null
  const selectedWorkflowCheckpoint = workflowRuntime.checkpoints.find(
    (checkpoint) => samePath(checkpoint.projectPath, selectedProjectPath),
  )

  useEffect(() => {
    if (!selectedProjectPath) return
    let active = true
    const loadKnowledgeSources = async () => {
      try {
        const response = await fetch(`/api/knowledge-sources?cwd=${encodeURIComponent(selectedProjectPath)}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Wissensdatenbank konnte nicht geladen werden.')
        if (!active) return
        const projectSources: KnowledgeSource[] = (Array.isArray(data.sources) ? data.sources : []).map(
          (source: Omit<KnowledgeSource, 'projectPath'>) => ({ ...source, projectPath: selectedProjectPath }),
        )
        setKnowledgeSources((current) => [
          ...current.filter((source) => !samePath(source.projectPath, selectedProjectPath)),
          ...projectSources,
        ])
        setKnowledgeSourceError('')
      } catch (error) {
        if (active) {
          setKnowledgeSourceError(error instanceof Error ? error.message : 'Wissensdatenbank konnte nicht geladen werden.')
        }
      }
    }
    void loadKnowledgeSources()
    return () => {
      active = false
    }
  }, [selectedProjectPath])

  useEffect(() => {
    if (!selectedProjectPath) return
    let active = true
    const loadProjectGoal = async () => {
      try {
        const response = await fetch(`/api/project-goal?cwd=${encodeURIComponent(selectedProjectPath)}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Projektziel konnte nicht geladen werden.')
        if (!active) return
        setProjectGoals((current) => [
          ...current.filter((entry) => !samePath(entry.projectPath, selectedProjectPath)),
          { projectPath: selectedProjectPath, goal: typeof data.goal === 'string' ? data.goal : '' },
        ])
        setProjectGoalError('')
      } catch (error) {
        if (active) {
          setProjectGoalError(error instanceof Error ? error.message : 'Projektziel konnte nicht geladen werden.')
        }
      }
    }
    void loadProjectGoal()
    return () => {
      active = false
    }
  }, [selectedProjectPath])

  useEffect(() => {
    const agentIds = agents.map((agent) => agent.id)
    const nodeIds = [
      ...agentIds,
      ...workflowPrompts.map((node) => node.id),
      ...workflowInitials.map((node) => node.id),
      ...workflowStatusFilters.map((node) => node.id),
      ...workflowStops.map((node) => node.id),
      ...workflowTimers.map((node) => node.id),
      ...workflowLoops.map((node) => node.id),
    ]
    setWorkflowBoardAgentIds((current) => pruneWorkflowBoardAgentIds(current, agentIds))
    setWorkflowPositions((current) => pruneWorkflowPositions(current, agentIds, nodeIds))
    updateDeliveryQueue((current) => pruneDeliveryQueue(current, agentIds))
  }, [agents, updateDeliveryQueue, workflowInitials, workflowLoops, workflowPrompts, workflowStatusFilters, workflowStops, workflowTimers])

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
    () => selectedProject
      ? codexThreads.filter((thread) => threadBelongsToProject(thread, selectedProject))
      : [],
    [codexThreads, selectedProject],
  )
  const projectAgents = useMemo(
    () => {
      const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id))
      return agents.filter(
        (agent) =>
          (agent.projectId === projectFilter ||
            samePath(agent.projectPath, selectedProject?.path ?? '')) &&
          (!agent.threadId || !hiddenThreadIds.includes(agent.threadId) || !visibleThreadIds.has(agent.threadId)),
      )
    },
    [agents, hiddenThreadIds, projectFilter, selectedProject?.path, visibleThreads],
  )
  const selectedAgent = useMemo(
    () => projectAgents.find((agent) => agent.id === selectedId) ?? projectAgents[0],
    [projectAgents, selectedId],
  )
  const latestBridgeMessage = useMemo(
    () => [...chatMessages].reverse().find((message) => message.role === 'assistant') ?? null,
    [chatMessages],
  )
  const latestBridgeIdentity = latestBridgeMessage
    ? chatMessageIdentity(latestBridgeMessage, selectedAgent?.name ?? '', language)
    : null
  const latestBridgeStatus = latestBridgeMessage?.text.match(/\[Workflow-Status:\s*([^\]]+)\]/i)?.[1]?.trim() ?? ''
  const latestBridgeChanges = latestBridgeMessage?.workspaceChanges ?? []
  const selectedTeamPlan = useMemo(
    () => {
      if (selectedAgent?.assignment !== 'management' || !selectedAgent.teamProvisioningEnabled) {
        return null
      }
      return findAuthorizedManagementTeamPlan(chatMessages)
    },
    [chatMessages, selectedAgent],
  )
  const selectedTeamPlanRequestAuthorized = useMemo(() => {
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      if (chatMessages[index].role === 'user') {
        return isExplicitTeamProvisioningRequest(chatMessages[index].text)
      }
    }
    return false
  }, [chatMessages])
  const selectedTeamPlanComplete = useMemo(() => {
    if (!selectedAgent || !selectedTeamPlan || !selectedAgent.projectPath) return false
    const projectAgentByName = new Map(
      agents
        .filter((agent) => samePath(agent.projectPath, selectedAgent.projectPath))
        .map((agent) => [agent.name.trim().toLocaleLowerCase('de-DE'), agent]),
    )
    const statusByName = new Map(
      workflowStatuses
        .filter((status) => samePath(status.projectPath, selectedAgent.projectPath))
        .map((status) => [status.name.trim().toLocaleLowerCase('de-DE'), status]),
    )
    const proposedAgents = selectedTeamPlan.plan.agents.map((specification) => ({
      specification,
      agent: projectAgentByName.get(specification.name.trim().toLocaleLowerCase('de-DE')),
    }))
    if (proposedAgents.some(({ agent }) => !agent)) return false
    if (selectedTeamPlan.plan.statusCommands.some((command) => {
      const status = statusByName.get(command.name.trim().toLocaleLowerCase('de-DE'))
      return !status || normalizedInstructionText(status.description) !== normalizedInstructionText(command.meaning)
    })) return false
    if (proposedAgents.some(({ specification, agent }) => specification.workflowStatuses.some((name) => {
      const statusId = statusByName.get(name.trim().toLocaleLowerCase('de-DE'))?.id
      return !statusId || !agent?.workflowStatusIds?.includes(statusId)
    }))) return false
    if (proposedAgents.some(({ specification, agent }) =>
      agent?.usesProjectKnowledge !== specification.usesProjectKnowledge,
    )) return false
    if (proposedAgents.some(({ specification, agent }) =>
      agent?.webAccess !== specification.webAccess,
    )) return false

    const startAgentId = projectAgentByName.get(selectedTeamPlan.plan.startAgent.trim().toLocaleLowerCase('de-DE'))?.id
    const startStatusId = statusByName.get(selectedTeamPlan.plan.startStatus.trim().toLocaleLowerCase('de-DE'))?.id
    const initial = workflowInitials.find((item) =>
      item.ownerAgentId === selectedAgent.id &&
      samePath(item.projectPath, selectedAgent.projectPath) &&
      !item.instruction.trim(),
    )
    const startFilter = workflowStatusFilters.find((item) =>
      item.ownerAgentId === selectedAgent.id &&
      item.statusId === startStatusId &&
      item.name === `${selectedTeamPlan.plan.startStatus}: ${selectedAgent.name} → ${selectedTeamPlan.plan.startAgent}`,
    )
    if (!startAgentId || !startStatusId || !initial || !startFilter || !routes.some((route) =>
      route.ownerAgentId === selectedAgent.id &&
      route.sourceId === initial.id &&
      route.targetId === selectedAgent.id,
    ) || !routes.some((route) =>
      route.ownerAgentId === selectedAgent.id &&
      route.sourceId === selectedAgent.id &&
      route.targetId === startFilter.id,
    ) || !routes.some((route) =>
      route.ownerAgentId === selectedAgent.id &&
      route.sourceId === startFilter.id &&
      route.targetId === startAgentId,
    )) return false
    const managerDashboardAgentIds = workflowBoardAgentIds[selectedAgent.id] ?? []
    if (!managerDashboardAgentIds.includes(selectedAgent.id) || !managerDashboardAgentIds.includes(startAgentId)) return false

    const plannedConnectionsComplete = selectedTeamPlan.plan.connections.every((connection) => {
      const sourceId = projectAgentByName.get(connection.from.trim().toLocaleLowerCase('de-DE'))?.id
      const targetId = projectAgentByName.get(connection.to.trim().toLocaleLowerCase('de-DE'))?.id
      const statusId = statusByName.get(connection.status.trim().toLocaleLowerCase('de-DE'))?.id
      const filter = workflowStatusFilters.find((item) =>
        item.ownerAgentId === sourceId &&
        item.statusId === statusId &&
        item.name === `${connection.status}: ${connection.from} → ${connection.to}`,
      )
      const sourceDashboardAgentIds = sourceId ? workflowBoardAgentIds[sourceId] ?? [] : []
      return Boolean(sourceId && targetId && filter &&
        sourceDashboardAgentIds.includes(sourceId) &&
        sourceDashboardAgentIds.includes(targetId) &&
        routes.some((route) => route.ownerAgentId === sourceId && route.sourceId === sourceId && route.targetId === filter.id) &&
        routes.some((route) => route.ownerAgentId === sourceId && route.sourceId === filter.id && route.targetId === targetId))
    })
    if (!plannedConnectionsComplete) return false

    if (selectedTeamPlan.plan.stops.length === 0) return false
    const plannedStopsComplete = selectedTeamPlan.plan.stops.every((plannedStop) => {
      const sourceId = projectAgentByName.get(plannedStop.from.trim().toLocaleLowerCase('de-DE'))?.id
      const statusId = statusByName.get(plannedStop.status.trim().toLocaleLowerCase('de-DE'))?.id
      const stop = workflowStops.find((item) =>
        item.ownerAgentId === sourceId &&
        samePath(item.projectPath, selectedAgent.projectPath) &&
        item.name === plannedStop.name,
      )
      const filter = workflowStatusFilters.find((item) =>
        item.ownerAgentId === sourceId &&
        item.statusId === statusId &&
        item.name === `${plannedStop.status}: ${plannedStop.from} -> ${plannedStop.name}`,
      )
      return Boolean(sourceId && statusId && stop && filter &&
        routes.some((route) => route.ownerAgentId === sourceId && route.sourceId === sourceId && route.targetId === filter.id) &&
        routes.some((route) => route.ownerAgentId === sourceId && route.sourceId === filter.id && route.targetId === stop.id))
    })
    if (!plannedStopsComplete) return false

    const errorStatusId = statusByName.get(MANAGEMENT_ERROR_STATUS_NAME.toLocaleLowerCase('de-DE'))?.id
    if (!errorStatusId) return false
    return proposedAgents.every(({ agent }) => {
      if (!agent) return false
      const filter = workflowStatusFilters.find((item) =>
        item.ownerAgentId === agent.id &&
        item.statusId === errorStatusId &&
        item.name.startsWith(`${MANAGEMENT_ERROR_STATUS_NAME}: ${agent.name}`),
      )
      const boardAgentIds = workflowBoardAgentIds[agent.id] ?? []
      return Boolean(filter &&
        boardAgentIds.includes(agent.id) &&
        boardAgentIds.includes(selectedAgent.id) &&
        routes.some((route) => route.ownerAgentId === agent.id && route.sourceId === agent.id && route.targetId === filter.id) &&
        routes.some((route) => route.ownerAgentId === agent.id && route.sourceId === filter.id && route.targetId === selectedAgent.id))
    })
  }, [agents, routes, selectedAgent, selectedTeamPlan, workflowBoardAgentIds, workflowInitials, workflowStatusFilters, workflowStatuses, workflowStops])
  const selectedTeamPlanMalformed = Boolean(
    selectedAgent?.teamProvisioningEnabled &&
    selectedTeamPlanRequestAuthorized &&
    /<orchestrator_team_plan>/i.test(selectedAgent.lastResult) &&
    !selectedTeamPlan,
  )
  const selectedTeamPlanNeedsFormat = Boolean(
    selectedAgent?.teamProvisioningEnabled &&
    selectedTeamPlanRequestAuthorized &&
    !selectedTeamPlan &&
    looksLikeManagementTeamPlan(selectedAgent.lastResult),
  )
  const pendingPromptDeliveryAgent = useMemo(
    () => agents.find((agent) => agent.id === pendingPromptDeliveryAgentId),
    [agents, pendingPromptDeliveryAgentId],
  )
  const editingWorkflowStatus = useMemo(
    () => workflowStatuses.find((status) => status.id === editingWorkflowStatusId) ?? null,
    [editingWorkflowStatusId, workflowStatuses],
  )

  const teamChatAgents = useMemo(
    () => projectAgents.filter((agent) => agent.usesTeamChat && agent.threadId),
    [projectAgents],
  )
  const teamChatAgentKey = useMemo(
    () => teamChatAgents.map((agent) => `${agent.id}:${agent.threadId}:${agent.name}`).join('|'),
    [teamChatAgents],
  )
  const selectedAgentChatKey = selectedAgent
    ? `${selectedAgent.id}:${selectedAgent.threadId ?? ''}:${selectedAgent.name}`
    : ''

  useEffect(() => {
    let active = true
    let loading = false
    const chatAgents = communicationChatScope === 'team'
      ? teamChatAgents
      : selectedAgent
        ? [selectedAgent]
        : []
    setChatPinnedToBottom(true)
    chatMessagesSnapshotRef.current = ''
    if (chatAgents.length === 0) {
      setChatMessages([])
      setChatError(communicationChatScope === 'team'
        ? tx('Kein Agent ist für den gemeinsamen Chat freigegeben.', 'No agent is enabled for the shared chat.')
        : tx('Dieser Agent ist mit keinem Codex-Chat verknüpft.', 'This agent is not linked to a Codex chat.'))
      return
    }

    const loadConversation = async () => {
      if (loading) return
      loading = true
      try {
        const conversations = await Promise.all(chatAgents.map(async (agent) => {
          const response = await fetch(
            `/api/threads/${encodeURIComponent(agent.threadId)}/conversation?limit=50`,
          )
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || tx('Chat konnte nicht gelesen werden.', 'The chat could not be loaded.'))
          }
          return {
            agent,
            messages: Array.isArray(data.messages) ? data.messages as ChatMessage[] : [],
          }
        }))
        if (active) {
          const nextMessages = conversations.flatMap(({ agent, messages }) =>
            messages.map((message) => ({
              ...message,
              id: `${agent.id}:${message.id}`,
              sourceAgentId: agent.id,
              sourceAgentName: agent.name,
              sourceThreadTitle: agent.threadTitle || agent.name,
            })),
          )
          const nextSnapshot = chatMessageSnapshot(nextMessages)
          if (nextSnapshot !== chatMessagesSnapshotRef.current) {
            chatMessagesSnapshotRef.current = nextSnapshot
            setChatMessages(nextMessages)
          }
          setChatError('')
        }
      } catch (error) {
        if (active) {
          setChatError(
            error instanceof Error ? error.message : tx('Codex-Connector nicht erreichbar.', 'Codex connector is unavailable.'),
          )
        }
      } finally {
        loading = false
      }
    }

    void loadConversation()
    const timer = window.setInterval(() => void loadConversation(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [communicationChatScope, selectedAgentChatKey, teamChatAgentKey, tx])

  useEffect(() => {
    const stream = chatStreamRef.current
    if (!stream || !chatPinnedToBottom || communicationView !== 'chat') return

    const frame = window.requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chatMessages, chatPinnedToBottom, communicationView, selectedAgent?.id])

  const activeDashboardOwnerId = selectedProject?.path ? `project:${selectedProject.path}` : ''
  const projectWorkflowStatuses = [
    unconditionalForwardStatus(selectedProject?.path ?? ''),
    ...workflowStatuses.filter((status) =>
      status.id !== UNCONDITIONAL_FORWARD_STATUS_ID &&
      samePath(status.projectPath, selectedProject?.path ?? ''),
    ),
  ]
  const projectKnowledgeSources = knowledgeSourcesForProject(
    knowledgeSources,
    selectedProject?.path ?? '',
  )
  const selectedProjectGoal = projectGoalForProject(projectGoals, selectedProject?.path ?? '')
  const visibleProjectKnowledgeSources = projectKnowledgeSources.filter(
    (source) => source.type === knowledgeSourceType,
  )
  const projectStatusFilters = LEGACY_STATUS_UI_ENABLED
    ? workflowStatusFilters.filter(
        (filter) =>
          samePath(filter.projectPath, selectedProject?.path ?? ''),
      )
    : []
  const projectStops = workflowStops.filter(
    (stop) =>
      samePath(stop.projectPath, selectedProject?.path ?? ''),
  )
  const projectTimers = workflowTimers.filter(
    (timer) =>
      samePath(timer.projectPath, selectedProject?.path ?? ''),
  )
  const projectLoops = workflowLoops.filter((loop) =>
    samePath(loop.projectPath, selectedProject?.path ?? ''),
  )
  const projectRoutes = useMemo(
    () =>
      routes.filter(
        (route) =>
          samePath(route.projectPath, selectedProject?.path ?? '') &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters, ...projectStops, ...projectTimers, ...projectLoops].some((node) => node.id === route.sourceId) &&
          [...projectAgents, ...workflowPrompts, ...workflowInitials, ...projectStatusFilters, ...projectStops, ...projectTimers, ...projectLoops].some((node) => node.id === route.targetId),
      ),
    [projectAgents, projectLoops, projectStatusFilters, projectStops, projectTimers, routes, selectedProject?.path, workflowInitials, workflowPrompts],
  )
  const projectPrompts = workflowPrompts.filter(
    (prompt) =>
      samePath(prompt.projectPath, selectedProject?.path ?? ''),
  )
  const dashboardPrompts = PROMPT_NODES_ENABLED ? projectPrompts : []
  const projectInitials = workflowInitials.filter(
    (initial) =>
      samePath(initial.projectPath, selectedProject?.path ?? ''),
  )
  const existingDashboardInitial = workflowInitials.find((initial) =>
    samePath(initial.projectPath, selectedProject?.path ?? ''),
  )
  const initialToolUnavailableReason = existingDashboardInitial
    ? tx(
        'In diesem Agenten-Dashboard ist bereits ein Initial-Baustein vorhanden.',
        'This agent dashboard already has an initial node.',
      )
    : ''
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
    ...projectLoops.map((loop) => loop.id),
  ])
  const dashboardRoutes = projectRoutes.filter(
    (route) => dashboardNodeIds.has(route.sourceId) && dashboardNodeIds.has(route.targetId),
  )
  const dashboardPositions = Object.fromEntries(
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters, ...projectStops, ...projectTimers, ...projectLoops].map((node) => [
      node.id,
      workflowPositions[`${activeDashboardOwnerId}:${node.id}`],
    ]).filter((entry) => Boolean(entry[1])),
  ) as Record<string, { x: number; y: number }>
  if (
    activeDashboardOwnerId &&
    !activeDashboardOwnerId.startsWith('project:') &&
    projectInitials.length > 0 &&
    !dashboardPositions[activeDashboardOwnerId]
  ) {
    dashboardPositions[activeDashboardOwnerId] = { x: 50, y: 260 }
  }
  const activeLayoutPattern = workflowLayoutPatterns
    .filter((pattern) =>
      samePath(pattern.projectPath, selectedProject?.path ?? '') &&
      pattern.dashboardId === activeDashboardOwnerId,
    )
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))[0]
  const selectedRoute = projectRoutes.find((route) => route.id === selectedRouteId)
  const selectedRouteSourceForwarding = selectedRoute
    ? projectPrompts.find((prompt) => prompt.id === selectedRoute.sourceId) ??
      projectStatusFilters.find((filter) => filter.id === selectedRoute.sourceId)
    : undefined
  const selectedPrompt = projectPrompts.find((prompt) => prompt.id === selectedPromptId)
  const selectedInitial = projectInitials.find((initial) => initial.id === selectedInitialId)
  const selectedStatusFilter = projectStatusFilters.find((filter) => filter.id === selectedStatusFilterId)
  const selectedStop = projectStops.find((stop) => stop.id === selectedStopId)
  const selectedTimer = projectTimers.find((timer) => timer.id === selectedTimerId)
  const selectedLoop = projectLoops.find((loop) => loop.id === selectedLoopId)
  const selectedWorkflowAgent = projectAgents.find((agent) => agent.id === selectedWorkflowAgentId)
  const dashboardNodeLabel = (nodeId: string) =>
    [...dashboardAgents, ...dashboardPrompts, ...projectInitials, ...projectStatusFilters, ...projectStops, ...projectTimers, ...projectLoops].find(
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
    if (!connectorOnline || teamPlanApplyingRef.current) {
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
            (thread.projectId ? thread.projectId === agent.projectId : samePath(thread.cwd, agent.projectPath)) &&
            [agent.name, agent.threadTitle].some(
              (name) =>
                name.trim().toLocaleLowerCase('de-DE') ===
                thread.title.trim().toLocaleLowerCase('de-DE'),
            ),
        )
        if (!replacement) {
          if (agent.threadId && isInsideInventoryReconciliationGrace(agent)) {
            return [agent]
          }
          hasChanges = true
          return []
        }

        assignedThreadIds.add(replacement.id)
        hasChanges = true
        return [{
          ...agent,
          name: replacement.title,
          role: isDefaultAgentRole(agent.role, agent.name)
            ? defaultAgentRole(replacement.title)
            : agent.role,
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
        const synchronizedName = hasExternalNameChange && !hasLocalNameEdit
          ? thread.title
          : agent.name
        return {
          ...agent,
          name: synchronizedName,
          role: synchronizedName !== agent.name && isDefaultAgentRole(agent.role, agent.name)
            ? defaultAgentRole(synchronizedName)
            : agent.role,
          threadTitle:
            hasExternalNameChange && !hasLocalNameEdit ? thread.title : agent.threadTitle,
          status: nextStatus as AgentStatus,
          updatedAt: new Date().toISOString(),
        }
      })

      const reconciled = synchronized

      const validAgentIds = new Set(reconciled.map((agent) => agent.id))
      const cleaned = reconciled.map((agent) => ({
        ...agent,
        talkTo: agent.talkTo.filter((targetId) => validAgentIds.has(targetId)),
      }))

      return hasChanges ? cleaned : current
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
      { id: crypto.randomUUID(), at: nowLabel(), title, detail, projectPath: selectedProjectPath },
      ...current.slice(0, 39),
    ])
  }, [selectedProjectPath])

  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
    // Block incoming shared-state snapshots until this local change is persisted.
    sharedStateDirty.current = true
    setAgents((current) =>
      current.map((agent) =>
        agent.id === id ? { ...agent, ...patch, updatedAt: new Date().toISOString() } : agent,
      ),
    )
  }, [])

  const resetInactiveAgentStatuses = useCallback(() => {
    sharedStateDirty.current = true
    setAgents((current) =>
      current.map((agent) => {
        if (
          agent.pendingTurnId ||
          agent.status === 'wartet' ||
          agent.status === 'rueckfrage'
        ) {
          return agent
        }
        return {
          ...agent,
          status: 'wartet',
          runStartedAt: '',
          updatedAt: new Date().toISOString(),
        }
      }),
    )
  }, [])

  useEffect(() => {
    if (!autoRun) {
      resetInactiveAgentStatuses()
    }
  }, [autoRun, resetInactiveAgentStatuses])

  useEffect(() => {
    if (!sharedStateReady) return
    const missingDashboardAssignments = workflowStatusFilters.some((filter) => {
      const owner = agents.find((agent) => agent.id === filter.ownerAgentId)
      return owner && !owner.workflowStatusIds.includes(filter.statusId)
    })
    if (!missingDashboardAssignments) return

    sharedStateDirty.current = true
    const now = new Date().toISOString()
    setAgents((current) => current.map((agent) => {
      const dashboardStatusIds = workflowStatusFilters
        .filter((filter) => filter.ownerAgentId === agent.id)
        .map((filter) => filter.statusId)
      if (dashboardStatusIds.every((statusId) => agent.workflowStatusIds.includes(statusId))) {
        return agent
      }
      return {
        ...agent,
        workflowStatusIds: Array.from(new Set([...agent.workflowStatusIds, ...dashboardStatusIds])),
        workflowStatusUpdatedAt: now,
        updatedAt: now,
      }
    }))
  }, [agents, sharedStateReady, workflowStatusFilters])

  useEffect(() => {
    const managementAgents = new Map(
      agents
        .filter((agent) => agent.assignment === 'management')
        .map((agent) => [agent.id, agent]),
    )
    const obsoleteFilterIds = new Set(
      workflowStatusFilters
        .filter((filter) => {
          const manager = managementAgents.get(filter.ownerAgentId)
          if (!manager) return false
          const expectedName = `${MANAGEMENT_ERROR_STATUS_NAME}: ${manager.name} -> ${manager.name}`
          return filter.name.trim().toLocaleLowerCase('de-DE') ===
            expectedName.toLocaleLowerCase('de-DE')
        })
        .map((filter) => filter.id),
    )
    if (obsoleteFilterIds.size === 0) return

    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) =>
      current.filter((filter) => !obsoleteFilterIds.has(filter.id)),
    )
    setRoutes((current) =>
      current.filter(
        (route) =>
          !obsoleteFilterIds.has(route.sourceId) &&
          !obsoleteFilterIds.has(route.targetId),
      ),
    )
    setWorkflowPositions((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !obsoleteFilterIds.has(key.slice(key.indexOf(':') + 1)),
        ),
      ),
    )

    if (autoRunRef.current) {
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      activeDeliveryTargetIds.current.clear()
      resetInactiveAgentStatuses()
      addEvent(
        'Automatik gestoppt',
        'Eine veraltete Selbstverknüpfung des Verwaltungsagenten wurde entfernt. Bitte den Workflow prüfen und neu starten.',
      )
    } else {
      sharedStateDirty.current = true
      addEvent(
        'Workflow bereinigt',
        'Eine veraltete Selbstverknüpfung des Verwaltungsagenten wurde entfernt.',
      )
    }
  }, [addEvent, agents, resetInactiveAgentStatuses, updateDeliveryQueue, workflowStatusFilters])

  useEffect(() => {
    if (
      !selectedAgent ||
      !selectedTeamPlan ||
      !selectedTeamPlanComplete ||
      selectedAgent.lastAppliedTeamPlanSignature === selectedTeamPlan.signature
    ) {
      return
    }

    updateAgent(selectedAgent.id, {
      lastAppliedTeamPlanSignature: selectedTeamPlan.signature,
    })
  }, [selectedAgent, selectedTeamPlan, selectedTeamPlanComplete, updateAgent])

  useEffect(() => {
    if (!sharedStateReady) return
    let nextInitials = workflowInitials
    let nextRoutes = routes
    let nextPositions = workflowPositions
    let changed = false

    agents.filter((agent) => agent.assignment === 'management').forEach((manager) => {
      const repaired = repairManagementStartTopology({
        manager,
        projectPath: manager.projectPath,
        initials: nextInitials,
        filters: workflowStatusFilters,
        routes: nextRoutes,
        boardAgentIds: workflowBoardAgentIds,
        positions: nextPositions,
        createId: () => crypto.randomUUID(),
      })
      nextInitials = repaired.initials
      nextRoutes = repaired.routes
      nextPositions = repaired.positions
      changed = changed || repaired.changed
    })

    if (!changed) return
    sharedStateDirty.current = true
    setWorkflowInitials(nextInitials)
    setRoutes(nextRoutes)
    setWorkflowPositions(nextPositions)
  }, [agents, routes, sharedStateReady, workflowBoardAgentIds, workflowInitials, workflowPositions, workflowStatusFilters])

  const setAgentTransmission = useCallback((agentId: string, active: boolean) => {
    setTransmittingAgentIds((current) =>
      active
        ? current.includes(agentId) ? current : [...current, agentId]
        : current.filter((id) => id !== agentId),
    )
  }, [])

  const isAgentBusy = (agent: Agent) => isAgentWorking({
    status: agent.status,
    pendingTurnId: agent.pendingTurnId,
    isTransmitting: transmittingAgentIds.includes(agent.id),
  })

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
    const nextIds = enabled
      ? Array.from(new Set([...agent.workflowStatusIds, statusId]))
      : agent.workflowStatusIds.filter((id) => id !== statusId)

    sharedStateDirty.current = true
    updateAgent(agent.id, {
      workflowStatusIds: nextIds,
      workflowStatusUpdatedAt: new Date().toISOString(),
    })

    if (enabled) {
      if (!workflowStatusFilters.some((filter) =>
        filter.ownerAgentId === agent.id && filter.statusId === statusId,
      )) {
        const status = projectWorkflowStatuses.find((item) => item.id === statusId)
        if (status) {
          setWorkflowStatusFilters((current) => [...current, {
            id: crypto.randomUUID(),
            ownerAgentId: agent.id,
            projectPath: agent.projectPath,
            name: `Status: ${status.name}`,
            statusId,
          }])
        }
      }
      return
    }

    const removedFilterIds = new Set(
      workflowStatusFilters
        .filter((filter) => filter.ownerAgentId === agent.id && filter.statusId === statusId)
        .map((filter) => filter.id),
    )
    if (removedFilterIds.size === 0) return
    setWorkflowStatusFilters((current) => current.filter((filter) => !removedFilterIds.has(filter.id)))
    setRoutes((current) => current.filter((route) =>
      !removedFilterIds.has(route.sourceId) && !removedFilterIds.has(route.targetId),
    ))
    setWorkflowPositions((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) =>
        !removedFilterIds.has(key.slice(key.indexOf(':') + 1)),
      ),
    ))
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
        projectId: agent.projectId,
        projectPath: agent.projectPath,
      },
    ])
    addEvent(
      'Codex-Chat technisch migriert',
      `${agent.name} verwendet ab jetzt einen kompatiblen Codex-Chat. Der alte Chat bleibt erhalten.`,
    )
  }, [addEvent, updateAgent])

  const syncCodex = useCallback(async () => {
    try {
      const [projectsResponse, threadsResponse, recoveryResponse] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/threads'),
        fetch('/api/provisioning-recovery'),
      ])
      if (!projectsResponse.ok || !threadsResponse.ok || !recoveryResponse.ok) {
        throw new Error('Codex-Projekte und -Tasks konnten nicht geladen werden.')
      }
      const projectsData = await projectsResponse.json()
      const threadsData = await threadsResponse.json()
      const recoveryData: ProvisioningRecovery = await recoveryResponse.json()
      const projects: CodexProject[] = projectsData.projects
      const threads: CodexThread[] = threadsData.threads.map(
        (thread: { id: string; name?: string | null; preview?: string; cwd: string; status: string; projectId?: string; projectPath?: string; projectAssignmentPending?: boolean }) => ({
          id: thread.id,
          title: thread.name || thread.preview || 'Unbenannter Chat',
          cwd: thread.cwd,
          status: thread.status,
          projectId: thread.projectId,
          projectPath: thread.projectPath,
          projectAssignmentPending: thread.projectAssignmentPending,
        }),
      ).filter((thread: CodexThread) => (
        projects.some((project) => threadBelongsToProject(thread, project))
      ))
      setCodexProjects(projects)
      setCodexThreads(threads)
      setProvisioningRecovery(recoveryData)
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
    const syncApprovals = async () => {
      try {
        const response = await fetch('/api/approvals')
        const data = await response.json()
        if (active && response.ok) {
          const nextApprovals = Array.isArray(data.approvals) ? data.approvals : []
          setPendingApprovals((current) =>
            JSON.stringify(current) === JSON.stringify(nextApprovals) ? current : nextApprovals,
          )
        }
      } catch {
        // Connector health reporting already covers an unavailable bridge.
      }
    }
    void syncApprovals()
    const timer = window.setInterval(() => void syncApprovals(), 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const resolvePendingApproval = async (approval: PendingApproval, approved: boolean) => {
    if (approvalResolvingId) return
    setApprovalResolvingId(approval.id)
    setApprovalError('')
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Freigabe konnte nicht übermittelt werden.')
      setPendingApprovals((current) => current.filter((item) => item.id !== approval.id))
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : 'Freigabe konnte nicht übermittelt werden.')
    } finally {
      setApprovalResolvingId('')
    }
  }

  const dismissUserConfirmation = (agent: Agent) => {
    const request = agent.pendingUserConfirmation
    if (!request || userConfirmationResolvingAgentId) return
    setUserConfirmationError('')
    setUserQuestionAnswer('')
    updateAgent(agent.id, {
      status: 'rueckfrage',
      pendingUserConfirmation: { ...request, dismissed: true },
    })
    addEvent(
      'Benutzerbestätigung abgebrochen',
      `${agent.name} wartet auf eine direkte Nachricht des Benutzers.`,
    )
  }

  const resolveUserConfirmation = async (agent: Agent, answer = '') => {
    const request = agent.pendingUserConfirmation
    if (!request || !agent.threadId || userConfirmationResolvingAgentId) return
    const visibleText = request.kind === 'question' ? answer.trim() : request.confirmationText
    if (!visibleText) {
      setUserConfirmationError('Bitte gib eine Antwort ein.')
      return
    }
    if (!reserveAgentDispatch(activeDeliveryTargetIds.current, {
      ...agent,
      pendingUserConfirmation: null,
    })) return

    setUserConfirmationResolvingAgentId(agent.id)
    setUserConfirmationError('')
    setAgentTransmission(agent.id, true)
    const message = withInternalInstructions(visibleText, [
      request.kind === 'question'
        ? 'Der Benutzer beantwortet hiermit deine unmittelbar zuvor gestellte Rückfrage.'
        : 'Der Benutzer hat die von dir verlangte Bestätigung ausdrücklich erteilt.',
      'Setze ausschließlich den unmittelbar zuvor wartenden Auftrag entsprechend dieser Benutzerantwort fort.',
      'Kontaktiere keine anderen Codex-Chats; eine mögliche Weitergabe übernimmt ausschließlich der Workflow-Orchestrator.',
      projectGoalInstruction(projectGoalForProject(projectGoals, agent.projectPath)),
      knowledgeSourceInstruction(
        knowledgeSourcesForAgent(knowledgeSources, agent.projectPath, agent.usesProjectKnowledge),
      ),
      workflowStatusInstruction(workflowStatusesForAgent(agent, workflowStatuses)),
    ].filter(Boolean).join('\n\n'))

    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(agent.threadId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          cwd: agent.projectPath,
          webAccess: agent.webAccess,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Benutzerbestätigung konnte nicht gesendet werden.')
      const turnId = requireStartedTurnId(data, 'die Benutzerbestätigung')
      applyThreadReplacement(agent, data.replacementThread)
      updateAgent(agent.id, {
        status: 'laeuft',
        pendingTurnId: turnId,
        pendingUserConfirmation: null,
        runStartedAt: new Date().toISOString(),
        runPurpose: request.forwardAfterConfirmation ? 'chat-forward' : 'chat',
        lastInstruction: visibleText,
      })
      setUserQuestionAnswer('')
      if (request.resumeAutomation && claimAutomationLease()) {
        autoRunRef.current = true
        setAutoRun(true)
      }
      addEvent(
        request.kind === 'question' ? 'Benutzerantwort gesendet' : 'Benutzerbestätigung gesendet',
        `${agent.name}: ${visibleText}`,
      )
    } catch (error) {
      releaseAgentDispatch(activeDeliveryTargetIds.current, agent.id)
      setUserConfirmationError(
        error instanceof Error ? error.message : 'Benutzerbestätigung konnte nicht gesendet werden.',
      )
    } finally {
      setAgentTransmission(agent.id, false)
      setUserConfirmationResolvingAgentId('')
    }
  }

  useEffect(() => {
    let active = true
    const loadCodexMeta = async () => {
      try {
        const [usageResponse, accountResponse] = await Promise.all([
          fetch('/api/usage'),
          fetch('/api/account'),
        ])
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
        if (accountResponse.ok) {
          const data = await accountResponse.json()
          if (active && typeof data.suggestedName === 'string') {
            setAccountSuggestedName(data.suggestedName.trim())
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

  const createAgent = async () => {
    const chatId = newAgentChatId.trim()
    if (!chatId || !selectedProject || agentCreationBusy) {
      return
    }
    if (autoRun || autoRunRef.current) {
      setAgentCreationError(tx(
        'Agenten können nur bei Auto Stop erstellt werden.',
        'Agents can only be created while Auto Stop is active.',
      ))
      return
    }

    const existingAgent = agents.find((agent) => agent.threadId === chatId)
    if (existingAgent) {
      setSelectedId(existingAgent.id)
      setAgentCreationError(tx(
        'Diese Chat-ID ist bereits mit einem Agenten verknuepft.',
        'This chat ID is already linked to an agent.',
      ))
      return
    }

    setAgentCreationBusy(true)
    setAgentCreationError('')
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(chatId)}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Codex-Chat wurde nicht gefunden.', 'The Codex chat was not found.'))
      }

      const thread: CodexThread = {
        id: data.thread.id,
        title: data.thread.name || data.thread.preview || tx('Unbenannter Chat', 'Untitled chat'),
        cwd: data.thread.cwd || selectedProject.path,
        status: data.thread.status || 'notLoaded',
        projectId: data.thread.projectId || selectedProject.id,
        projectPath: data.thread.projectPath || selectedProject.path,
        projectAssignmentPending: data.thread.projectAssignmentPending,
      }
      const threadProject = projectForThread(thread, codexProjects) ?? selectedProject
      const name = thread.title
      const agent: Agent = {
        id: crypto.randomUUID(),
        name,
        role: defaultAgentRole(name),
        projectId: threadProject.id,
        projectPath: threadProject.path,
        threadTitle: thread.title,
        threadId: thread.id,
        prompt: 'Definiere die Rollen-Anweisung für diesen Codex-Agenten.',
        promptDocuments: [createDefaultPromptDocument('Definiere die Rollen-Anweisung für diesen Codex-Agenten.')],
        activePromptDocumentId: 'default',
        status: thread.status === 'active' ? 'laeuft' : 'wartet',
        talkTo: [],
        autoForward: true,
        usesTeamChat: true,
        usesProjectKnowledge: true,
        webAccess: 'off',
        assignment: 'agent',
        teamProvisioningEnabled: false,
        managementInstructionRules: [...DEFAULT_CEO_INSTRUCTIONS],
        lastAppliedTeamPlanSignature: '',
        workflowStatusIds: [],
        workflowStatusUpdatedAt: '',
        finishSignal: '"status":"fertig"',
        lastResult: '',
        instructionVersion: 1,
        lastInstruction: '',
        runStartedAt: '',
        lastDurationMs: 0,
        completedRuns: 0,
        consecutiveFailedRuns: 0,
        pendingTurnId: '',
        runPurpose: '',
        lastCompletedTurnId: '',
        lastInboundAgentId: '',
        pendingUserConfirmation: null,
        updatedAt: new Date().toISOString(),
      }

      sharedStateDirty.current = true
      setCodexThreads((current) => [
        ...current.filter((item) => item.id !== thread.id),
        thread,
      ])
      setAgents((current) => [...current, agent])
      setSelectedId(agent.id)
      setAgentCreationOpen(false)
      setNewAgentChatId('')
      addEvent('Codex-Chat verlinkt', `${threadProject.label} / ${name}`)
    } catch (error) {
      setAgentCreationError(
        error instanceof Error ? error.message : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.'),
      )
    } finally {
      setAgentCreationBusy(false)
    }
  }

  const openAgentEdit = (agent: Agent) => {
    setSelectedId(agent.id)
    setAgentEditId(agent.id)
    setAgentEditName(agent.name)
    setAgentEditChatId(agent.threadId)
    setAgentEditError('')
  }

  const saveAgentEdit = async () => {
    const agent = agents.find((item) => item.id === agentEditId)
    const name = agentEditName.trim()
    const chatId = agentEditChatId.trim()
    if (!agent || agentEditBusy) {
      return
    }
    if (!name) {
      setAgentEditError(tx('Ein Name ist erforderlich.', 'A name is required.'))
      return
    }
    if (!chatId) {
      setAgentEditError(tx('Eine Chat-ID ist erforderlich.', 'A chat ID is required.'))
      return
    }
    if (agents.some((item) => item.id !== agent.id && item.threadId === chatId)) {
      setAgentEditError(tx(
        'Diese Chat-ID ist bereits mit einem anderen Agenten verknuepft.',
        'This chat ID is already linked to another agent.',
      ))
      return
    }

    setAgentEditBusy(true)
    setAgentEditError('')
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(chatId)}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Codex-Chat wurde nicht gefunden.', 'The Codex chat was not found.'))
      }
      const thread: CodexThread = {
        id: data.thread.id,
        title: data.thread.name || data.thread.preview || name,
        cwd: data.thread.cwd || agent.projectPath,
        status: data.thread.status || 'notLoaded',
        projectId: data.thread.projectId || agent.projectId,
        projectPath: data.thread.projectPath || agent.projectPath,
        projectAssignmentPending: data.thread.projectAssignmentPending,
      }
      const threadProject = projectForThread(thread, codexProjects)
      updateAgent(agent.id, {
        name,
        role: isDefaultAgentRole(agent.role, agent.name) ? defaultAgentRole(name) : agent.role,
        projectId: threadProject?.id ?? agent.projectId,
        projectPath: threadProject?.path ?? agent.projectPath,
        threadId: thread.id,
        threadTitle: thread.title,
        status: thread.status === 'active' ? 'laeuft' : agent.status === 'laeuft' ? 'wartet' : agent.status,
        updatedAt: new Date().toISOString(),
      })
      setCodexThreads((current) => [
        ...current.filter((item) => item.id !== thread.id),
        thread,
      ])
      addEvent('Agent-Verknuepfung aktualisiert', `${name} -> ${thread.id}`)
      setAgentEditId('')
      setAgentEditName('')
      setAgentEditChatId('')
    } catch (error) {
      setAgentEditError(
        error instanceof Error ? error.message : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.'),
      )
    } finally {
      setAgentEditBusy(false)
    }
  }

  const applyManagementTeamPlan = async (manager: Agent) => {
    if (!selectedProject || !selectedTeamPlan || teamPlanApplying || teamPlanApplyingRef.current) return
    if (autoRun || autoRunRef.current) {
      setTeamPlanError(tx(
        'Der Team-Aufbau ist nur bei Auto Stop möglich.',
        'The team can only be created while Auto Stop is active.',
      ))
      return
    }
    if (manager.assignment !== 'management' || !manager.teamProvisioningEnabled) return

    const { plan, signature } = selectedTeamPlan
    if (plan.stops.length === 0) {
      setTeamPlanError(tx(
        'Der Team-Vorschlag benötigt mindestens einen Abschlussweg zu einem Stopp-Baustein.',
        'The team proposal requires at least one completion path to a stop node.',
      ))
      return
    }
    if (selectedTeamPlanComplete) {
      setTeamPlanError(tx('Dieser Team-Vorschlag ist bereits vollständig eingerichtet.', 'This team proposal is already fully configured.'))
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
    const invalidStop = plan.stops.find((stop) =>
      !allowedNames.has(stop.from.toLocaleLowerCase('de-DE')),
    )
    if (invalidStop) {
      setTeamPlanError(tx(
        `Ungültiger Abschlussweg: ${invalidStop.from} -> ${invalidStop.name}.`,
        `Invalid completion path: ${invalidStop.from} -> ${invalidStop.name}.`,
      ))
      return
    }

    const nextWorkflowStatuses = [...workflowStatuses]
    const statusByName = new Map(
      projectWorkflowStatuses.map((status) => [status.name.trim().toLocaleLowerCase('de-DE'), status]),
    )
    const conflictingStatus = plan.statusCommands.find((command) => {
      const existing = statusByName.get(command.name.toLocaleLowerCase('de-DE'))
      return existing && normalizedInstructionText(existing.description) !== normalizedInstructionText(command.meaning)
    })
    if (conflictingStatus) {
      setTeamPlanError(tx(
        `Der Statusbefehl „${conflictingStatus.name}“ existiert bereits mit einer anderen Bedeutung. Passe den Team-Vorschlag an die bestehende Statusliste an.`,
        `The status command “${conflictingStatus.name}” already exists with a different meaning. Align the team proposal with the existing status list.`,
      ))
      return
    }
    plan.statusCommands.forEach((command) => {
      const normalizedName = command.name.toLocaleLowerCase('de-DE')
      if (statusByName.has(normalizedName)) return
      const status: WorkflowStatusDefinition = {
        id: crypto.randomUUID(),
        projectPath: selectedProject.path,
        name: command.name,
        description: command.meaning,
      }
      statusByName.set(normalizedName, status)
      nextWorkflowStatuses.push(status)
    })
    const unknownStatus = plan.agents
      .flatMap((agent) => agent.workflowStatuses)
      .find((status) => !statusByName.has(status.toLocaleLowerCase('de-DE')))
    if (unknownStatus) {
      setTeamPlanError(tx(
        `Der Statusbefehl „${unknownStatus}“ ist weder vorhanden noch im Team-Vorschlag definiert.`,
        `The status command “${unknownStatus}” neither exists nor is defined in the team proposal.`,
      ))
      return
    }

    // Codex exposes newly created threads before the complete team state is ready.
    // Keep reconciliation from importing those threads as default agents meanwhile.
    teamPlanApplyingRef.current = true
    sharedStateDirty.current = true
    setTeamPlanApplying(true)
    setTeamPlanProgress(tx('Team-Einrichtung wird vorbereitet…', 'Preparing team setup…'))
    setTeamPlanError('')
    const nextAgentMap = new Map(agents.map((agent) => [agent.id, agent]))
    const createdThreads: CodexThread[] = []
    try {
      await runProvisioningTransaction(async ({ addRollback }) => {
        const transactionResponse = await fetch('/api/provisioning-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: selectedProject.path,
            managerAgentId: manager.id,
            signature,
          }),
        })
        const transactionData = await transactionResponse.json()
        if (!transactionResponse.ok || !transactionData.transaction?.id) {
          throw new Error(transactionData.error || tx(
            'Die dauerhafte Team-Transaktion konnte nicht gestartet werden.',
            'The durable team transaction could not be started.',
          ))
        }
        const provisioningTransactionId = transactionData.transaction.id as string
        addRollback(async () => {
          const rollbackResponse = await fetch(
            `/api/provisioning-transactions/${encodeURIComponent(provisioningTransactionId)}/rollback`,
            { method: 'POST' },
          )
          if (!rollbackResponse.ok) {
            const rollbackData = await rollbackResponse.json().catch(() => ({}))
            throw new Error(rollbackData.error || tx(
              'Die unvollständige Team-Erstellung konnte nicht vollständig bereinigt werden.',
              'The incomplete team setup could not be cleaned up completely.',
            ))
          }
        })

        for (const [index, specification] of plan.agents.entries()) {
        setTeamPlanProgress(tx(
          `Agent ${index + 1} von ${plan.agents.length} wird eingerichtet: ${specification.name}`,
          `Configuring agent ${index + 1} of ${plan.agents.length}: ${specification.name}`,
        ))
        const normalizedName = specification.name.toLocaleLowerCase('de-DE')
        let agent = projectAgentMap.get(normalizedName)
        if (!agent) {
          const response = await fetch('/api/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cwd: selectedProject.path,
              projectId: selectedProject.id,
              name: specification.name,
              webAccess: specification.webAccess,
              provisioningTransactionId,
              initialPrompt: tx(
                'Dieser Codex-Chat wurde als Agent eingerichtet. Antworte ausschließlich mit BEREIT und warte danach auf eine Benutzeranweisung.',
                'This Codex chat was created as an agent. Reply only with READY, then wait for a user instruction.',
              ),
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
            projectId: selectedProject.id,
            projectPath: selectedProject.path,
          }
          sharedStateDirty.current = true
          createdThreads.push(thread)
          agent = normalizeAgent({
            id: crypto.randomUUID(),
            name: specification.name,
            role: specification.role,
            projectId: selectedProject.id,
            projectPath: selectedProject.path,
            threadTitle: data.inventoryPending ? '' : thread.title,
            threadId: thread.id,
            prompt: specification.prompt,
            promptDocuments: [createDefaultPromptDocument(specification.prompt)],
            activePromptDocumentId: 'default',
            status: data.turn?.id ? 'laeuft' : 'wartet',
            workflowStatusIds: specification.workflowStatuses.length > 0
              ? specification.workflowStatuses.map((status) => statusByName.get(status.toLocaleLowerCase('de-DE'))?.id).filter((id): id is string => Boolean(id))
              : [],
            usesProjectKnowledge: specification.usesProjectKnowledge,
            webAccess: specification.webAccess,
            pendingTurnId: data.turn?.id ?? '',
            runStartedAt: data.turn?.id ? new Date().toISOString() : '',
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
              : [],
            usesProjectKnowledge: specification.usesProjectKnowledge,
            webAccess: specification.webAccess,
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
        if (!promptData.path || !promptData.sha256) {
          throw new Error(`${specification.name}: Prompt-Datei wurde nicht vollständig verifiziert.`)
        }
        agent = {
          ...agent,
          promptDocuments: agent.promptDocuments.map((document) =>
            document.id === promptDocument.id
              ? {
                  ...document,
                  content: specification.prompt,
                  filePath: promptData.path,
                  sha256: promptData.sha256,
                  updatedAt: new Date().toISOString(),
                }
              : document,
          ),
        }
        nextAgentMap.set(agent.id, agent)
        projectAgentMap.set(normalizedName, agent)
      }

      const resolvedAgents = [...nextAgentMap.values()]
      setTeamPlanProgress(tx('Statusbefehle und Verdrahtung werden eingerichtet…', 'Configuring status commands and workflow wiring…'))
      const startAgent = projectAgentMap.get(plan.startAgent.toLocaleLowerCase('de-DE'))
      if (!startAgent) throw new Error(tx('Der Start-Agent des Teamplans wurde nicht gefunden.', 'The team plan start agent was not found.'))
      const teamInitial = workflowInitials.find((item) =>
        item.ownerAgentId === manager.id && item.name === 'Team-Start',
      ) ?? {
        id: crypto.randomUUID(),
        ownerAgentId: manager.id,
        projectPath: selectedProject.path,
        name: 'Team-Start',
        instruction: '',
      }
      const configuredInitial = {
        ...teamInitial,
        instruction: teamInitial.instructionSource === 'user' ? teamInitial.instruction : '',
        instructionSource: teamInitial.instructionSource === 'user' ? 'user' as const : undefined,
      }
      const planFilters = plan.connections.map((connection) => {
        const status = statusByName.get(connection.status.toLocaleLowerCase('de-DE'))
        if (!status) throw new Error(`${tx('Statusbefehl fehlt', 'Missing status command')}: ${connection.status}`)
        const source = projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!
        const name = `${connection.status}: ${connection.from} → ${connection.to}`
        const existing = workflowStatusFilters.find((item) =>
          samePath(item.projectPath, selectedProject.path) && item.name === name,
        )
        return {
          id: existing?.id ?? crypto.randomUUID(),
          ownerAgentId: source.id,
          projectPath: selectedProject.path,
          name,
          statusId: status.id,
        }
      })
      const errorStatus = statusByName.get(MANAGEMENT_ERROR_STATUS_NAME.toLocaleLowerCase('de-DE'))
      if (!errorStatus) throw new Error(`${tx('Statusbefehl fehlt', 'Missing status command')}: ${MANAGEMENT_ERROR_STATUS_NAME}`)
      const managedAgents = plan.agents.map((specification) =>
        projectAgentMap.get(specification.name.toLocaleLowerCase('de-DE'))!,
      )
      const errorFilters = managedAgents.map((source) => {
        const name = `${MANAGEMENT_ERROR_STATUS_NAME}: ${source.name} -> ${manager.name}`
        const existing = workflowStatusFilters.find((item) =>
          samePath(item.projectPath, selectedProject.path) && item.name === name,
        )
        return {
          id: existing?.id ?? crypto.randomUUID(),
          ownerAgentId: source.id,
          projectPath: selectedProject.path,
          name,
          statusId: errorStatus.id,
        }
      })
      const planStops = plan.stops.map((plannedStop) => {
        const source = projectAgentMap.get(plannedStop.from.toLocaleLowerCase('de-DE'))!
        const existing = workflowStops.find((item) =>
          item.ownerAgentId === source.id &&
          samePath(item.projectPath, selectedProject.path) &&
          item.name === plannedStop.name,
        )
        return {
          id: existing?.id ?? crypto.randomUUID(),
          ownerAgentId: source.id,
          projectPath: selectedProject.path,
          name: plannedStop.name,
        }
      })
      const stopFilters = plan.stops.map((plannedStop, index) => {
        const source = projectAgentMap.get(plannedStop.from.toLocaleLowerCase('de-DE'))!
        const status = statusByName.get(plannedStop.status.toLocaleLowerCase('de-DE'))
        if (!status) throw new Error(`${tx('Statusbefehl fehlt', 'Missing status command')}: ${plannedStop.status}`)
        const name = `${plannedStop.status}: ${plannedStop.from} -> ${plannedStop.name}`
        const existing = workflowStatusFilters.find((item) =>
          item.ownerAgentId === source.id &&
          samePath(item.projectPath, selectedProject.path) &&
          item.name === name,
        )
        return {
          id: existing?.id ?? crypto.randomUUID(),
          ownerAgentId: source.id,
          projectPath: selectedProject.path,
          name,
          statusId: status.id,
          stopId: planStops[index].id,
        }
      })
      const newRoutes: WorkflowRoute[] = [
        {
          id: crypto.randomUUID(),
          ownerAgentId: manager.id,
          projectPath: selectedProject.path,
          sourceId: configuredInitial.id,
          targetId: startAgent.id,
          condition: 'Immer',
          prompt: plan.startInstruction,
        },
        ...plan.connections.flatMap((connection, index) => {
          const source = projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!
          const target = projectAgentMap.get(connection.to.toLocaleLowerCase('de-DE'))!
          const filter = planFilters[index]
          return [
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: source.id, targetId: filter.id, condition: 'Immer', prompt: '',
            },
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: filter.id, targetId: target.id, condition: 'Immer',
              prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.',
            },
          ]
        }),
        ...managedAgents.flatMap((source, index) => {
          const filter = errorFilters[index]
          return [
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: source.id, targetId: filter.id, condition: 'Immer', prompt: '',
            },
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: filter.id, targetId: manager.id, condition: 'Immer',
              prompt: 'Prüfe den fehlgeschlagenen Lauf, entscheide über den nächsten Schritt und gib dem Benutzer eine klare Rückmeldung.',
            },
          ]
        }),
        ...plan.stops.flatMap((plannedStop, index) => {
          const source = projectAgentMap.get(plannedStop.from.toLocaleLowerCase('de-DE'))!
          const filter = stopFilters[index]
          return [
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: source.id, targetId: filter.id, condition: 'Immer', prompt: '',
            },
            {
              id: crypto.randomUUID(), ownerAgentId: source.id, projectPath: selectedProject.path,
              sourceId: filter.id, targetId: filter.stopId, condition: 'Immer', prompt: '',
            },
          ]
        }),
      ]
      const teamCommittedAt = new Date().toISOString()
      const startStatusId = statusByName.get(plan.startStatus.toLocaleLowerCase('de-DE'))?.id
      if (!startStatusId) throw new Error(`${tx('Statusbefehl fehlt', 'Missing status command')}: ${plan.startStatus}`)
      const finalAgents = resolvedAgents.map((agent) => ({
        ...agent,
        workflowStatusIds: agent.id === manager.id ? [startStatusId] : agent.workflowStatusIds,
        lastAppliedTeamPlanSignature: agent.id === manager.id
          ? signature
          : agent.lastAppliedTeamPlanSignature,
        updatedAt: teamCommittedAt,
      }))
      let finalInitials = [
        ...workflowInitials.filter((item) => item.id !== configuredInitial.id),
        configuredInitial,
      ]
      const allPlanFilters = [...planFilters, ...errorFilters, ...stopFilters]
      let finalStatusFilters = [
        ...workflowStatusFilters.filter((item) => !allPlanFilters.some((filter) => filter.id === item.id)),
        ...planFilters,
        ...errorFilters,
        ...stopFilters.map(({ stopId: _stopId, ...filter }) => filter),
      ]
      let finalStops = [
        ...workflowStops.filter((item) => !planStops.some((stop) => stop.id === item.id)),
        ...planStops,
      ]
      let finalBoardAgentIds = { ...workflowBoardAgentIds }
      finalBoardAgentIds[manager.id] = Array.from(new Set([manager.id, startAgent.id]))
      plan.connections.forEach((connection) => {
        const source = projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!
        const target = projectAgentMap.get(connection.to.toLocaleLowerCase('de-DE'))!
        finalBoardAgentIds[source.id] = Array.from(new Set([
          source.id,
          ...(finalBoardAgentIds[source.id] ?? []),
          target.id,
        ]))
      })
      managedAgents.forEach((source) => {
        finalBoardAgentIds[source.id] = Array.from(new Set([
          source.id,
          ...(finalBoardAgentIds[source.id] ?? []),
          manager.id,
        ]))
      })
      const planFilterIds = new Set(allPlanFilters.map((filter) => filter.id))
      const planSourceIds = new Set(plan.connections.map((connection) =>
        projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!.id,
      ))
      const proposedPairs = new Set(plan.connections.map((connection) => {
        const sourceId = projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!.id
        const targetId = projectAgentMap.get(connection.to.toLocaleLowerCase('de-DE'))!.id
        return `${sourceId}:${targetId}`
      }))
      const retainedRoutes = routes.filter((route) => !(
        samePath(route.projectPath, selectedProject.path) && (
          route.sourceId === configuredInitial.id ||
          planFilterIds.has(route.sourceId) ||
          planFilterIds.has(route.targetId) ||
          (planSourceIds.has(route.sourceId) && proposedPairs.has(`${route.sourceId}:${route.targetId}`))
        )
      ))
      let finalRoutes = [...retainedRoutes, ...newRoutes]
      let finalPositions = {
        ...workflowPositions,
        [`${manager.id}:${configuredInitial.id}`]: { x: 50, y: 90 },
        [`${manager.id}:${startAgent.id}`]: { x: 280, y: 90 },
        [`${manager.id}:${manager.id}`]: { x: 50, y: 260 },
        ...Object.fromEntries(plan.connections.flatMap((connection, index) => {
          const source = projectAgentMap.get(connection.from.toLocaleLowerCase('de-DE'))!
          const target = projectAgentMap.get(connection.to.toLocaleLowerCase('de-DE'))!
          const branchIndex = plan.connections
            .slice(0, index)
            .filter((item) => item.from.toLocaleLowerCase('de-DE') === connection.from.toLocaleLowerCase('de-DE')).length
          const y = 60 + branchIndex * 140
          return [
            [`${source.id}:${source.id}`, { x: 40, y: 130 }],
            [`${source.id}:${planFilters[index].id}`, { x: 270, y }],
            [`${source.id}:${target.id}`, { x: 500, y }],
          ]
        })),
        ...Object.fromEntries(managedAgents.flatMap((source, index) => [
          [`${source.id}:${errorFilters[index].id}`, { x: 270, y: 300 }],
          [`${source.id}:${manager.id}`, { x: 500, y: 300 }],
        ])),
        ...Object.fromEntries(plan.stops.flatMap((plannedStop, index) => {
          const source = projectAgentMap.get(plannedStop.from.toLocaleLowerCase('de-DE'))!
          return [
            [`${source.id}:${stopFilters[index].id}`, { x: 270, y: 460 + index * 120 }],
            [`${source.id}:${planStops[index].id}`, { x: 500, y: 460 + index * 120 }],
          ]
        })),
      }

      const topology = buildTeamTopology({
        plan,
        manager,
        agents: [...projectAgentMap.values()],
        projectPath: selectedProject.path,
        statuses: [unconditionalForwardStatus(selectedProject.path), ...nextWorkflowStatuses],
        initials: workflowInitials,
        filters: workflowStatusFilters,
        stops: workflowStops,
        routes,
        positions: workflowPositions,
        boardAgentIds: workflowBoardAgentIds,
        createId: () => crypto.randomUUID(),
      })
      finalInitials = topology.initials
      finalStatusFilters = topology.filters
      finalStops = topology.stops
      finalBoardAgentIds = topology.boardAgentIds
      finalRoutes = topology.routes
      finalPositions = topology.positions

      const commitResponse = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          state: {
            agents: finalAgents,
            events,
            hiddenThreadIds,
            routes: finalRoutes,
            workflowPrompts,
            workflowInitials: finalInitials,
            workflowStatuses: nextWorkflowStatuses,
            workflowStatusFilters: finalStatusFilters,
            workflowStops: finalStops,
            workflowTimers,
            workflowPositions: finalPositions,
            workflowBoardAgentIds: finalBoardAgentIds,
            workflowLoopCounts,
            selectedProjectId: projectFilter,
            autoRun: false,
          },
        }),
      })
      if (!commitResponse.ok) {
        throw new Error(tx('Die vollständige Teamkonfiguration konnte nicht gespeichert werden.', 'The complete team configuration could not be saved.'))
      }
      const commitData = await commitResponse.json()
      sharedStateVersion.current = commitData.updatedAt
      sharedStateDirty.current = false
      const journalCommitResponse = await fetch(
        `/api/provisioning-transactions/${encodeURIComponent(provisioningTransactionId)}`,
        { method: 'DELETE' },
      )
      if (!journalCommitResponse.ok) {
        console.warn('Das Team wurde gespeichert, aber der Transaktionseintrag wird erst beim Connector-Neustart bereinigt.')
      }
      setAgents(finalAgents)
      setWorkflowStatuses(nextWorkflowStatuses)
      setWorkflowInitials(finalInitials)
      setWorkflowStatusFilters(finalStatusFilters)
      setWorkflowStops(finalStops)
      setCodexThreads((current) => [
        ...current.filter((thread) => !createdThreads.some((created) => created.id === thread.id)),
        ...createdThreads,
      ])
      setWorkflowBoardAgentIds(finalBoardAgentIds)
      setRoutes(finalRoutes)
      setWorkflowPositions(finalPositions)
      addEvent(
        'Team-Vorschlag übernommen',
        `${manager.name}: ${plan.agents.length} Agenten, ${plan.statusCommands.length} Statusbefehle, ${plan.connections.length} Verbindungen und ${plan.stops.length} Abschlusswege. Automatik bleibt gestoppt.`,
      )
      setTeamPlanProgress(tx('Team-Einrichtung abgeschlossen.', 'Team setup complete.'))
      setTeamReadyNotice({
        project: selectedProject.label,
        agents: plan.agents.length,
        statuses: plan.statusCommands.length,
        connections: plan.connections.length,
        stops: plan.stops.length,
      })
      })
    } catch (error) {
      sharedStateDirty.current = false
      setCodexThreads((current) => [
        ...current.filter((thread) => !createdThreads.some((created) => created.id === thread.id)),
      ])
      setTeamPlanError(error instanceof Error ? error.message : tx('Team-Aufbau fehlgeschlagen.', 'Team creation failed.'))
      addEvent('Team-Aufbau fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler.')
    } finally {
      teamPlanApplyingRef.current = false
      setTeamPlanApplying(false)
      window.setTimeout(() => setTeamPlanProgress(''), 1200)
    }
  }

  const dismissManagementTeamPlan = () => {
    if (!selectedTeamPlan || teamPlanApplying) return
    setDismissedTeamPlanSignature(selectedTeamPlan.signature)
    setTeamPlanError('')
    setTeamPlanProgress('')
  }

  const deleteAgent = async (agent: Agent) => {
    setAgentDeleteError('')
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
            (thread: { id: string; name?: string | null; preview?: string; cwd: string; status: string; projectId?: string; projectPath?: string; projectAssignmentPending?: boolean }) => ({
              id: thread.id,
              title: thread.name || thread.preview || 'Unbenannter Chat',
              cwd: thread.cwd,
              status: thread.status,
              projectId: thread.projectId,
              projectPath: thread.projectPath,
              projectAssignmentPending: thread.projectAssignmentPending,
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
        const message = error instanceof Error ? error.message : tx(
          'Der Codex-Connector ist nicht erreichbar.',
          'The Codex connector is unavailable.',
        )
        addEvent(
          'Agent konnte nicht gelöscht werden',
          message,
        )
        setAgentDeleteError(message)
        setDeletingAgentId('')
        return
      }
    }

    const ownedNodeIds = new Set([
      ...workflowPrompts.filter((node) => node.ownerAgentId === agent.id).map((node) => node.id),
      ...workflowInitials.filter((node) => node.ownerAgentId === agent.id).map((node) => node.id),
      ...workflowStatusFilters.filter((node) => node.ownerAgentId === agent.id).map((node) => node.id),
      ...workflowStops.filter((node) => node.ownerAgentId === agent.id).map((node) => node.id),
      ...workflowTimers.filter((node) => node.ownerAgentId === agent.id).map((node) => node.id),
    ])
    const removedNodeIds = new Set([agent.id, ...ownedNodeIds])
    const remaining = agents.filter((item) => item.id !== agent.id)
    setAgents(
      remaining.map((item) => {
        const talkTo = item.talkTo.filter((targetId) => targetId !== agent.id)
        const lastInboundAgentId = item.lastInboundAgentId === agent.id ? '' : item.lastInboundAgentId
        return talkTo.length !== item.talkTo.length ||
          lastInboundAgentId !== item.lastInboundAgentId
          ? { ...item, talkTo, lastInboundAgentId, updatedAt: new Date().toISOString() }
          : item
      }),
    )
    setRoutes((current) =>
      current.filter((route) =>
        route.ownerAgentId !== agent.id &&
        !removedNodeIds.has(route.sourceId) &&
        !removedNodeIds.has(route.targetId),
      ),
    )
    setWorkflowPrompts((current) =>
      current.filter((prompt) => prompt.ownerAgentId !== agent.id),
    )
    setWorkflowInitials((current) =>
      current.filter((initial) => initial.ownerAgentId !== agent.id),
    )
    setWorkflowStatusFilters((current) =>
      current.filter((filter) => filter.ownerAgentId !== agent.id),
    )
    setWorkflowStops((current) =>
      current.filter((stop) => stop.ownerAgentId !== agent.id),
    )
    setWorkflowTimers((current) =>
      current.filter((timer) => timer.ownerAgentId !== agent.id),
    )
    setWorkflowPositions((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => {
          if (key.startsWith(`${agent.id}:`)) return false
          return !Array.from(removedNodeIds).some((nodeId) => key.endsWith(`:${nodeId}`))
        }),
      )
    })
    setWorkflowBoardAgentIds((current) => pruneWorkflowBoardAgentIds(current, remaining.map((item) => item.id)))
    updateDeliveryQueue((current) => removeDeliveryAgent(current, agent.id))
    setSelectedId(remaining[0]?.id ?? '')
    addEvent(
      'Agent gelöscht',
      agent.threadId
        ? `${agent.name} wurde entfernt. Der Codex-Chat ist archiviert und nicht mehr aktiv.`
        : `${agent.name} wurde aus dem Orchestrator entfernt.`,
    )
    setDeletingAgentId('')
    setAgentPendingDeletionId('')
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
      promptDocument.content === promptDocument.lastSentContent &&
      promptDocument.filePath &&
      promptDocument.sha256
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
    let promptSha256 = promptDocument.sha256 ?? ''
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
      promptSha256 = data.sha256
      if (!filePath || !promptSha256) {
        throw new Error('Die gespeicherte Prompt-Datei wurde vom Server nicht vollständig verifiziert.')
      }
      updateAgent(agent.id, {
        prompt: promptDocument.content,
        promptDocuments: agent.promptDocuments.map((document) =>
          document.id === promptDocument.id
            ? { ...document, filePath, sha256: promptSha256, updatedAt: new Date().toISOString() }
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
      promptSha256,
      promptDocument.content,
      workflowStatusesForAgent(agent, workflowStatuses),
      knowledgeSourcesForAgent(knowledgeSources, agent.projectPath, agent.usesProjectKnowledge),
      projectGoalForProject(projectGoals, agent.projectPath),
    )
    let startedTurnId = ''
    try {
      const response = await fetch(
        `/api/threads/${encodeURIComponent(agent.threadId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: instruction, cwd: agent.projectPath, webAccess: agent.webAccess }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Prompt konnte nicht gesendet werden.')
      }
      startedTurnId = requireStartedTurnId(data, 'die Prompt-Übertragung')
      applyThreadReplacement(agent, data.replacementThread)
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
              sha256: promptSha256,
              lastSentContent: promptDocument.content,
              updatedAt: new Date().toISOString(),
            }
          : document,
      ),
      status: 'laeuft',
      runStartedAt: new Date().toISOString(),
      pendingTurnId: startedTurnId,
      runPurpose: 'prompt',
    })
    setAgentTransmission(agent.id, false)
    addEvent(
      'Prompt an Codex übergeben',
      `${agent.name} -> ${agent.threadTitle || agent.threadId || 'nicht verlinkt'} | ${promptDocument.fileName} | v${nextVersion}`,
    )
  }

  const sendChatMessage = async (agent: Agent, draft: string) => {
    const text = draft.trim()
    if (!text || !agent.threadId) {
      return false
    }

    setChatSending(true)
    setAgentTransmission(agent.id, true)
    setChatError('')
    const requiresWorkflowStatus = /\bstatus\s+hinzuf(?:ü|ue)gen\b/i.test(text)
    const resumesDismissedConfirmation =
      agent.pendingUserConfirmation?.dismissed === true &&
      isAffirmativeUserConfirmation(text)
    const requestsWorkflowForwarding =
      requiresWorkflowStatus ||
      requestsManualChatForwarding(text) ||
      resumesDismissedConfirmation
    const requestsTeamPlan =
      agent.assignment === 'management' &&
      agent.teamProvisioningEnabled &&
      isExplicitTeamProvisioningRequest(text)
    const messageParts = [text]
    if (agent.assignment === 'management') {
      messageParts.push('', withInternalInstructions(
        '',
        managementRulebook(autoRun ? 'automation' : 'manual', agent.managementInstructionRules),
      ))
    }
    if (requestsWorkflowForwarding) {
      messageParts.push('', workflowStatusInstruction(workflowStatusesForAgent(agent, workflowStatuses)))
      if (resumesDismissedConfirmation) {
        messageParts.push('', withInternalInstructions(
          '',
          'Der Benutzer bestätigt mit dieser Nachricht die zuvor abgebrochene Rückfrage. Setze den wartenden Auftrag fort.',
        ))
      }
    } else {
      messageParts.push('', withInternalInstructions(
        '',
        [
          'Diese direkte Benutzernachricht gehört ausschließlich zu diesem Chat.',
          'Gib keinen Workflow-Status aus und fordere keine Weiterleitung an, solange der Benutzer dies nicht ausdrücklich verlangt.',
          'Antworte nur dem Benutzer im aktuellen Chat.',
        ].join('\n'),
      ))
      messageParts.push('', withInternalInstructions('', userInteractionInstruction()))
    }
    if (requestsTeamPlan) {
      authorizedTeamPlanRequestAgentIds.current.add(agent.id)
      automaticTeamPlanFormatRequests.current.delete(agent.id)
      clearAutomaticTeamPlanFormatClaim(agent.id)
      messageParts.push('', managementTeamPlanInstruction(projectWorkflowStatuses))
    } else {
      authorizedTeamPlanRequestAgentIds.current.delete(agent.id)
    }
    const sourceInstruction = knowledgeSourceInstruction(
      knowledgeSourcesForAgent(knowledgeSources, agent.projectPath, agent.usesProjectKnowledge),
    )
    const goalInstruction = projectGoalInstruction(projectGoalForProject(projectGoals, agent.projectPath))
    if (goalInstruction) {
      messageParts.push('', withInternalInstructions('', goalInstruction))
    }
    if (sourceInstruction) {
      messageParts.push('', withInternalInstructions('', sourceInstruction))
    }
    const message = messageParts.join('\n')
    try {
      const response = await fetch(
        `/api/threads/${encodeURIComponent(agent.threadId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, cwd: agent.projectPath, webAccess: agent.webAccess }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Nachricht konnte nicht gesendet werden.', 'The message could not be sent.'))
      }
      const turnId = requireStartedTurnId(data, 'die Chat-Nachricht')

      applyThreadReplacement(agent, data.replacementThread)
      setChatPinnedToBottom(true)
      updateAgent(agent.id, {
        status: 'laeuft',
        runStartedAt: new Date().toISOString(),
        pendingTurnId: turnId,
        pendingUserConfirmation: requestsWorkflowForwarding
          ? null
          : agent.pendingUserConfirmation,
        runPurpose: requestsWorkflowForwarding ? 'chat-forward' : 'chat',
        lastInstruction: text,
      })
      addEvent(
        'Chat-Nachricht gesendet',
        requestsTeamPlan
          ? `${agent.name} hat den Auftrag für einen kontrollierten Team-Vorschlag erhalten.`
          : requestsWorkflowForwarding
          ? `${agent.name} hat eine direkte Anweisung mit ausdrücklicher Workflow-Weitergabe erhalten.`
          : `${agent.name} hat eine lokale Chat-Anweisung ohne Workflow-Weitergabe erhalten.`,
      )
      return true
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.'),
      )
      return false
    } finally {
      setChatSending(false)
      setAgentTransmission(agent.id, false)
    }
  }

  chatSendHandlerRef.current = async (agentId, text) => {
    const agent = agentsRef.current.find((item) => item.id === agentId)
    return agent ? sendChatMessage(agent, text) : false
  }

  const requestTeamPlanFormatCorrection = async (agent: Agent) => {
    if (!agent.threadId || teamPlanFormatRequesting || autoRun) return

    setTeamPlanFormatRequesting(true)
    setAgentTransmission(agent.id, true)
    setTeamPlanError('')
    setChatError('')
    const message = [
      'Dein letzter Teamvorschlag ist fachlich vollständig, konnte aber nicht automatisch übernommen werden.',
      'Gib exakt denselben Vorschlag jetzt zusätzlich im unten beschriebenen Orchestrator-Format aus.',
      'Plane nichts neu, ändere keine Dateien und starte die Automatik nicht.',
      '',
      managementTeamPlanInstruction(projectWorkflowStatuses),
    ].join('\n')
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(agent.threadId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, cwd: agent.projectPath, webAccess: agent.webAccess }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || tx('Formatkorrektur konnte nicht angefordert werden.', 'Could not request format correction.'))
      }
      const turnId = requireStartedTurnId(data, 'die Formatkorrektur')
      applyThreadReplacement(agent, data.replacementThread)
      setChatPinnedToBottom(true)
      updateAgent(agent.id, {
        status: 'laeuft',
        runStartedAt: new Date().toISOString(),
        pendingTurnId: turnId,
        runPurpose: 'chat',
      })
      addEvent('Team-Vorschlag wird korrigiert', `${agent.name}: Orchestrator-Format angefordert.`)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : tx('Der Codex-Connector ist nicht erreichbar.', 'The Codex connector is unavailable.')
      setTeamPlanError(message)
      setChatError(message)
    } finally {
      setTeamPlanFormatRequesting(false)
      setAgentTransmission(agent.id, false)
    }
  }
  requestTeamPlanFormatCorrectionRef.current = requestTeamPlanFormatCorrection

  const persistWorkflowCheckpoint = useCallback(({
    source,
    targets,
    statusIds,
    statusNames,
    state,
    reason = '',
  }: {
    source: Agent
    targets: Agent[]
    statusIds: string[]
    statusNames: string[]
    state: WorkflowCheckpoint['state']
    reason?: string
  }) => {
    updateWorkflowRuntime((current) => {
      const now = new Date().toISOString()
      const ensured = ensureWorkflowRun(current, source.projectPath, now)
      const existing = ensured.runtime.checkpoints.find(
        (checkpoint) =>
          samePath(checkpoint.projectPath, source.projectPath) &&
          checkpoint.sourceAgentId === source.id,
      )
      const checkpoint: WorkflowCheckpoint = {
        id: existing?.id ?? crypto.randomUUID(),
        runId: ensured.run.id,
        projectPath: source.projectPath,
        sourceAgentId: source.id,
        sourceAgentName: source.name,
        sourceTurnId: source.lastCompletedTurnId,
        targetAgentIds: targets.map((target) => target.id),
        targetAgentNames: targets.map((target) => target.name),
        statusIds,
        statusNames,
        result: source.lastResult,
        state,
        reason,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      const withCheckpoint = saveWorkflowCheckpoint(ensured.runtime, checkpoint)
      return appendWorkflowRunEntry(
        withCheckpoint,
        source.projectPath,
        workflowRunEntry(state === 'pending' ? 'handoff-pending' : 'paused', {
          agentId: source.id,
          agentName: source.name,
          targetAgentIds: checkpoint.targetAgentIds,
          targetAgentNames: checkpoint.targetAgentNames,
          statusIds,
          statusNames,
          detail: reason || source.lastResult.slice(0, 6_000),
        }, now),
      )
    })
  }, [updateWorkflowRuntime])

  const commitForwardIntervalHits = useCallback((deliveries: readonly WorkflowDelivery[]) => {
    const updates = new Map<string, { count: number; branch: 'normal' | 'interval' }>()
    deliveries.forEach((delivery) => {
      if (
        delivery.promptNodeId &&
        delivery.promptBranch &&
        typeof delivery.promptNextCount === 'number'
      ) {
        updates.set(delivery.promptNodeId, {
          count: delivery.promptNextCount,
          branch: delivery.promptBranch,
        })
      }
    })
    if (updates.size === 0) return

    sharedStateDirty.current = true
    setWorkflowPrompts((current) => current.map((prompt) => {
      const update = updates.get(prompt.id)
      return update ? { ...prompt, intervalCount: update.count } : prompt
    }))
    setWorkflowStatusFilters((current) => current.map((filter) => {
      const update = updates.get(filter.id)
      return update ? { ...filter, intervalCount: update.count } : filter
    }))
    updates.forEach((update, promptId) => {
      if (update.branch !== 'interval') return
      const forwardingNode = workflowPrompts.find((item) => item.id === promptId) ??
        workflowStatusFilters.find((item) => item.id === promptId)
      addEvent(
        'Weiterleiten-Intervall erreicht',
        `${forwardingNode?.name ?? 'Weiterleiten'}: Der Intervall-Ausgang wurde verwendet; der Zähler beginnt wieder bei 0.`,
      )
    })
  }, [addEvent, workflowPrompts, workflowStatusFilters])

  const recordSupervisorDiagnosis = useCallback(({
    source,
    diagnosis,
    statusIds = [],
    statusNames = [],
  }: {
    source: Agent
    diagnosis: ReturnType<typeof diagnoseWorkflowStall>
    statusIds?: string[]
    statusNames?: string[]
  }) => {
    const detail = `${diagnosis.summary} ${diagnosis.nextStep}`
    addEvent('Aufsicht: Ablauf angehalten', `${source.name}: ${detail}`)
    updateWorkflowRuntime((current) => appendWorkflowRunEntry(
      current,
      source.projectPath,
      workflowRunEntry('supervisor', {
        agentId: source.id,
        agentName: 'Orchestrator-Aufsicht',
        targetAgentIds: [],
        targetAgentNames: [],
        statusIds,
        statusNames,
        detail,
      }),
    ))
  }, [addEvent, updateWorkflowRuntime])

  const capturePendingContinuation = useCallback((agent: Agent) => {
    if (!agent.autoForward) return false
    if (workflowRuntimeRef.current.checkpoints.some((checkpoint) =>
      samePath(checkpoint.projectPath, agent.projectPath) && checkpoint.sourceAgentId === agent.id,
    )) return false
    const unconditionalForwarding = resolveUnconditionalForwarding({
      sourceId: agent.id,
      statusId: UNCONDITIONAL_FORWARD_STATUS_ID,
      routes,
      statusFilters: workflowStatusFilters,
      targetIds: new Set(agents.map((item) => item.id)),
    })
    if (unconditionalForwarding.enabled) {
      const targetIds = (unconditionalForwarding.deliveries ?? [])
        .map((delivery) => delivery.targetId)
        .filter(Boolean)
      const targets = agents.filter((item) => targetIds.includes(item.id))
      if (targets.length === 0 || unconditionalForwarding.issue) return false
      persistWorkflowCheckpoint({
        source: agent,
        targets,
        statusIds: [UNCONDITIONAL_FORWARD_STATUS_ID],
        statusNames: [UNCONDITIONAL_FORWARD_STATUS_NAME],
        state: 'pending',
      })
      return true
    }
    const projectStatuses = workflowStatusesForAgent(agent, workflowStatuses)
    const signal = parseWorkflowSignal(agent.lastResult, projectStatuses)
    if (signal.kind !== 'valid') return false
    const signature = deliveryDeduplicationSignature(
      taskSignature(agent.lastResult),
      agent.lastCompletedTurnId,
      false,
    )
    const targetIds = resolveConfiguredDeliveries({
      sourceId: agent.id,
      result: agent.lastResult,
      resultStatusIds: signal.statusIds,
      routes,
      statusFilters: workflowStatusFilters,
      promptNodes: workflowPrompts,
      loopNodes: workflowLoops,
      targetIds: new Set(agents.map((item) => item.id)),
      stopIds: new Set(workflowStops.map((item) => item.id)),
    })
      .filter((delivery) => !signature || delivery.route.lastForwardedTask !== signature)
      .map((delivery) => delivery.targetId)
      .filter(Boolean)
    const targets = agents.filter((item) => targetIds.includes(item.id))
    if (targets.length === 0) return false
    persistWorkflowCheckpoint({
      source: agent,
      targets,
      statusIds: signal.statusIds,
      statusNames: signal.names,
      state: 'pending',
    })
    return true
  }, [agents, persistWorkflowCheckpoint, routes, workflowLoops, workflowPrompts, workflowStatusFilters, workflowStatuses, workflowStops])

  useEffect(() => {
    if (
      autoRun ||
      !sharedStateReady ||
      !selectedProjectPath ||
      workflowRuntimeRef.current.checkpoints.some((checkpoint) =>
        samePath(checkpoint.projectPath, selectedProjectPath),
      )
    ) return
    const candidate = [...agents]
      .filter((agent) =>
        samePath(agent.projectPath, selectedProjectPath) &&
        isRecoverableContinuationCandidate(agent),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .find((agent) => capturePendingContinuation(agent))
    if (candidate) {
      addEvent(
        'Unterbrochener Ablauf erkannt',
        `${candidate.name}: Eine noch nicht ausgeführte Weitergabe wurde als Kontrollpunkt übernommen.`,
      )
    }
  }, [addEvent, agents, autoRun, capturePendingContinuation, selectedProjectPath, sharedStateReady])

  const handoff = useCallback(async (
    agent: Agent,
    { replayCheckpoint = false }: { replayCheckpoint?: boolean } = {},
  ) => {
    if (!autoRunRef.current) {
      addEvent('Weitergabe blockiert', `${agent.name}: Die Automatik ist ausgeschaltet.`)
      return
    }
    if (!automationLeaderRef.current) {
      return
    }
    const activeRoutes = routes.filter(
      (route) => route.sourceId === agent.id,
    )
    const projectStatuses = workflowStatusesForAgent(agent, workflowStatuses)
    const unconditionalForwarding = resolveUnconditionalForwarding({
      sourceId: agent.id,
      statusId: UNCONDITIONAL_FORWARD_STATUS_ID,
      routes,
      statusFilters: workflowStatusFilters,
      targetIds: new Set(agents.map((item) => item.id)),
    })
    const workflowSignal = unconditionalForwarding.enabled
      ? {
          kind: 'valid' as const,
          statusIds: [UNCONDITIONAL_FORWARD_STATUS_ID],
          names: [UNCONDITIONAL_FORWARD_STATUS_NAME],
          unknownNames: [],
          source: 'none' as const,
        }
      : parseWorkflowSignal(agent.lastResult, projectStatuses)
    const constraintViolation = workflowConstraintViolation([
      agent.assignment,
      agent.lastResult,
    ].filter(Boolean).join('\n'))
    const topologyDeliveries: ResolvedWorkflowDelivery[] =
      unconditionalForwarding.enabled && unconditionalForwarding.deliveries?.length
        ? unconditionalForwarding.deliveries
        : resolveConfiguredDeliveries({
            sourceId: agent.id,
            result: agent.lastResult,
            resultStatusIds: workflowSignal.statusIds,
            routes,
            statusFilters: workflowStatusFilters,
            promptNodes: workflowPrompts,
            loopNodes: workflowLoops,
            targetIds: new Set(agents.map((item) => item.id)),
            stopIds: new Set(workflowStops.map((item) => item.id)),
          })
    const reportsInternalWorkflowError = Boolean(
      constraintViolation || unconditionalForwarding.issue,
    ) || (!unconditionalForwarding.enabled && topologyDeliveries.length === 0 && shouldEscalateInternalWorkflowError({
      assignment: agent.assignment,
      signalKind: workflowSignal.kind,
      runPurpose: agent.runPurpose,
      statusIds: workflowSignal.statusIds,
    }))
    const legacyInternalStatusSignal =
      workflowSignal.names.some((name) =>
        name.trim().toLocaleLowerCase('de-DE') === INTERNAL_WORKFLOW_ERROR_STATUS_NAME.toLocaleLowerCase('de-DE'),
      ) ||
      workflowSignal.statusIds.includes(INTERNAL_WORKFLOW_ERROR_STATUS_ID)
    const resultStatusIds = reportsInternalWorkflowError
      ? [INTERNAL_WORKFLOW_ERROR_STATUS_ID]
      : legacyInternalStatusSignal
        ? []
        : workflowSignal.statusIds
    const resultStatusNames = reportsInternalWorkflowError
      ? [INTERNAL_WORKFLOW_ERROR_STATUS_NAME]
      : legacyInternalStatusSignal
        ? []
        : workflowSignal.names
    const reportsTechnicalFailure = reportsInternalWorkflowError || projectStatuses.some(
      (status) =>
        resultStatusIds.includes(status.id) &&
        status.name.trim().toLocaleLowerCase('de-DE') ===
          MANAGEMENT_ERROR_STATUS_NAME.toLocaleLowerCase('de-DE'),
    )
    const currentTaskSignature = deliveryDeduplicationSignature(
      taskSignature(agent.lastResult),
      agent.lastCompletedTurnId,
      reportsTechnicalFailure || unconditionalForwarding.enabled,
    )
    const resolvedConfiguredDeliveries: ResolvedWorkflowDelivery[] = reportsInternalWorkflowError
      ? []
      : topologyDeliveries
    const configuredDeliveries = resolvedConfiguredDeliveries.flatMap<WorkflowDelivery>(({
      targetId,
      stopId,
      route,
      promptNodeId,
      promptBranch,
      promptNextCount,
    }) => {
      const resolvedRoute = route as WorkflowRoute
      const target = agents.find((item) => item.id === targetId)
      const promptMetadata = { promptNodeId, promptBranch, promptNextCount }
      if (target) return [{ target, route: resolvedRoute, ...promptMetadata }]
      const stop = workflowStops.find((item) => item.id === stopId)
      return stop ? [{ stop, route: resolvedRoute, ...promptMetadata }] : []
    })
    const internalErrorManagerId = reportsInternalWorkflowError
      ? internalWorkflowErrorManagerId(agent, agents)
      : ''
    const internalErrorManager = agents.find((item) => item.id === internalErrorManagerId)
    const internalErrorDelivery: WorkflowDelivery | null = internalErrorManager
      ? {
          target: internalErrorManager,
          route: {
            id: `internal-workflow-error:${agent.id}:${internalErrorManager.id}`,
            ownerAgentId: agent.id,
            projectPath: agent.projectPath,
            sourceId: agent.id,
            targetId: internalErrorManager.id,
            condition: INTERNAL_WORKFLOW_ERROR_STATUS_NAME,
            prompt: internalWorkflowErrorHandoffInstruction(
              constraintViolation || unconditionalForwarding.issue || workflowSignalIssue(workflowSignal),
            ),
          },
        }
      : null
    const managementRecoveryTargetId = resolveManagementRecoveryTargetId({
      isManagementAgent: agent.assignment === 'management',
      inboundSourceAgentId: agent.lastInboundAgentId,
      reportsTechnicalFailure,
      configuredDeliveryCount: configuredDeliveries.length,
      knownAgentIds: agents.map((item) => item.id),
    })
    const managementRecoveryTarget = agents.find(
      (item) => item.id === managementRecoveryTargetId,
    )
    const managementRecoveryDelivery: WorkflowDelivery | null = managementRecoveryTarget
      ? {
          target: managementRecoveryTarget,
          route: {
            id: `management-recovery:${agent.id}:${managementRecoveryTarget.id}`,
            ownerAgentId: agent.id,
            projectPath: agent.projectPath,
            sourceId: agent.id,
            targetId: managementRecoveryTarget.id,
            condition: 'Verwaltungs-Rückgabe',
            prompt:
              'Setze die konkrete Wiederaufnahme- oder Überarbeitungsanweisung des Verwaltungsagenten um. Bewahre bereits nutzbare Ergebnisse und bearbeite nur den klar begrenzten Rest.',
          },
        }
      : null
    const deliveries = [
      ...configuredDeliveries,
      ...(internalErrorDelivery ? [internalErrorDelivery] : []),
      ...(managementRecoveryDelivery ? [managementRecoveryDelivery] : []),
    ]

    const continuation = decideWorkflowContinuation({
      signal: workflowSignal,
      deliveryCount: deliveries.length,
      activeRouteCount: activeRoutes.length,
    })

    if (continuation.action === 'stop') {
      const signalIssue = workflowSignalIssue(workflowSignal)
      const availableStatuses = workflowSignal.kind === 'valid'
        ? workflowSignal.names.join(', ')
        : signalIssue || 'kein Workflow-Status'
      const supervisorDiagnosis = diagnoseWorkflowStall({
        agentName: agent.name,
        automationEnabled: autoRunRef.current,
        activeRouteCount: activeRoutes.length,
        deliveryCount: deliveries.length,
        statusKind: workflowSignal.kind,
        statusNames: workflowSignal.names,
        fixedForwardingEnabled: unconditionalForwarding.enabled,
        fixedForwardingIssue: unconditionalForwarding.issue,
        continuationReason: continuation.reason,
      })
      recordSupervisorDiagnosis({
        source: agent,
        diagnosis: supervisorDiagnosis,
        statusIds: resultStatusIds,
        statusNames: resultStatusNames,
      })
      const supervisorReason = `${supervisorDiagnosis.summary} ${supervisorDiagnosis.nextStep}`
      if (shouldRequestWorkflowStatusRepair({
        signalKind: workflowSignal.kind,
        activeRouteCount: activeRoutes.length,
        runPurpose: agent.runPurpose,
        hasThread: Boolean(agent.threadId),
      })) {
        const correctionMessage = withInternalInstructions(
          'Statuskorrektur',
          workflowStatusRepairInstruction(availableStatuses, projectStatuses),
        )
        try {
          const response = await fetch(
            `/api/threads/${encodeURIComponent(agent.threadId)}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: correctionMessage,
                cwd: agent.projectPath,
                webAccess: agent.webAccess,
              }),
            },
          )
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Workflow-Statuskorrektur konnte nicht gesendet werden.')
          }
          const turnId = requireStartedTurnId(data, 'die Workflow-Statuskorrektur')
          applyThreadReplacement(agent, data.replacementThread)
          updateAgent(agent.id, {
            status: 'laeuft',
            pendingTurnId: turnId,
            runStartedAt: new Date().toISOString(),
            runPurpose: 'status-repair',
          })
          updateWorkflowRuntime((current) => appendWorkflowRunEntry(
            current,
            agent.projectPath,
            workflowRunEntry('status-repair', {
              agentId: agent.id,
              agentName: agent.name,
              statusNames: resultStatusNames,
              detail: availableStatuses,
            }),
          ))
          addEvent(
            'Workflow-Statuskorrektur angefordert',
            `${agent.name}: Der fachliche Inhalt bleibt erhalten; ausschließlich die Statuszeile wird einmal korrigiert.`,
          )
          return
        } catch (error) {
          addEvent(
            'Workflow-Statuskorrektur fehlgeschlagen',
            `${agent.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
          )
        }
      }
      addEvent(
        activeRoutes.length === 0 ? 'Weitergabe gestoppt' : 'Keine Status-Weitergabe',
        activeRoutes.length === 0
          ? `${agent.name}: ${continuation.reason}`
          : `${agent.name}: ${continuation.reason || availableStatuses}`,
      )
      persistWorkflowCheckpoint({
        source: agent,
        targets: [],
        statusIds: resultStatusIds,
        statusNames: resultStatusNames,
        state: 'blocked',
        reason: supervisorReason,
      })
      sharedStateDirty.current = true
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      activeDeliveryTargetIds.current.clear()
      updateAgent(agent.id, {
        status: 'rueckfrage',
        pendingTurnId: '',
        runStartedAt: '',
      })
      addEvent(
        'Automatik gestoppt',
        `${agent.name}: ${supervisorDiagnosis.nextStep}`,
      )
      return
    }
    const newDeliveries = deliveries.filter(({ route, target, stop }) => {
      if (shouldDeliverWorkflowTask({
        currentSignature: currentTaskSignature,
        lastForwardedSignature: route.lastForwardedTask,
        replayCheckpoint,
      })) {
        return true
      }
      addEvent(
        'Identische Aufgabe nicht weitergegeben',
        `${agent.name} → ${target?.name ?? stop?.name ?? 'Stopp'}: Die nächste Aufgabe wurde über diese Verbindung bereits übergeben.`,
      )
      return false
    })
    if (newDeliveries.length === 0) {
      sharedStateDirty.current = true
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      activeDeliveryTargetIds.current.clear()
      updateAgent(agent.id, {
        status: 'rueckfrage',
        pendingTurnId: '',
        runStartedAt: '',
      })
      updateWorkflowRuntime((current) => appendWorkflowRunEntry(
        current,
        agent.projectPath,
        workflowRunEntry('paused', {
          agentId: agent.id,
          agentName: agent.name,
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          detail: 'Keine neue Folgeaufgabe: Die einzige mögliche Übergabe wurde bereits ausgeführt.',
        }),
      ))
      addEvent(
        'Automatik gestoppt',
        `${agent.name} hat keine neue Folgeaufgabe. Der Workflow wartet auf eine Benutzerentscheidung.`,
      )
      return
    }

    const stopDeliveries = newDeliveries.filter(
      (delivery): delivery is WorkflowDelivery & { stop: WorkflowStop } => Boolean(delivery.stop),
    )
    const agentDeliveries = newDeliveries.filter(
      (delivery): delivery is WorkflowDelivery & { target: Agent } => Boolean(delivery.target),
    )

    if (agentDeliveries.length === 1 && stopDeliveries.length === 0) {
      const delivery = agentDeliveries[0]
      const nextDeliveryKey = workflowDeliveryKey({
        sourceId: agent.id,
        targetId: delivery.target.id,
        statusIds: resultStatusIds,
        taskSignature: currentTaskSignature,
      })
      const recentDeliveryKeys = (
        activeWorkflowRun(workflowRuntimeRef.current, agent.projectPath)?.entries ?? []
      )
        .filter((entry) => entry.kind === 'handoff-delivered' && entry.targetAgentIds.length === 1)
        .slice(-12)
        .map((entry) => workflowDeliveryKey({
          sourceId: entry.agentId,
          targetId: entry.targetAgentIds[0],
          statusIds: entry.statusIds,
          taskSignature: entry.taskSignature,
        }))
      if (wouldRepeatWorkflowCycle(recentDeliveryKeys, nextDeliveryKey)) {
        const reason = `Wiederholte Workflow-Schleife erkannt: ${agent.name} und ${delivery.target.name} haben denselben Statuskreis mehrfach ohne neuen Anschluss durchlaufen.`
        persistWorkflowCheckpoint({
          source: agent,
          targets: [],
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          state: 'blocked',
          reason,
        })
        sharedStateDirty.current = true
        autoRunRef.current = false
        setAutoRun(false)
        setTransmittingAgentIds([])
        updateDeliveryQueue(() => ({}))
        activeDeliveryTargetIds.current.clear()
        updateAgent(agent.id, {
          status: 'rueckfrage',
          pendingTurnId: '',
          runStartedAt: '',
        })
        addEvent('Workflow-Schleife gestoppt', reason)
        return
      }
    }

    const projectInitialAgentIds = new Set(
      workflowInitials
        .filter((initial) => samePath(initial.projectPath, agent.projectPath))
        .flatMap((initial) =>
          routes
            .filter((route) => route.sourceId === initial.id)
            .map((route) => route.targetId),
        ),
    )
    const activeRun = activeWorkflowRun(workflowRuntimeRef.current, agent.projectPath)
    const returningToInitialAgent = autoRunRef.current &&
      wouldCompleteWorkflowCycleOnReturn({
        run: activeRun,
        sourceAgentId: agent.id,
        targetAgentIds: agentDeliveries.map(({ target }) => target.id),
        initialAgentIds: projectInitialAgentIds,
      })

    if (agentDeliveries.length > 0 && !returningToInitialAgent) {
      persistWorkflowCheckpoint({
        source: agent,
        targets: agentDeliveries.map((delivery) => delivery.target),
        statusIds: resultStatusIds,
        statusNames: resultStatusNames,
        state: 'pending',
      })
    }

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

    if (stopDeliveries.length > 0) {
      commitForwardIntervalHits(stopDeliveries)
      sharedStateDirty.current = true
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      activeDeliveryTargetIds.current.clear()
      updateAgent(agent.id, {
        status: 'fertig',
        pendingTurnId: '',
        runStartedAt: '',
      })
      const runBeforeStop = activeWorkflowRun(workflowRuntimeRef.current, agent.projectPath)
      const progress = workflowRunCycleProgress(workflowRuntimeRef.current, agent.projectPath)
      const completionDetail = `${agent.name} -> ${stopDeliveries.map((delivery) => delivery.stop.name).join(', ')}`
      updateWorkflowRuntime((current) => {
        const checkpoint = current.checkpoints.find(
          (item) => samePath(item.projectPath, agent.projectPath) && item.sourceAgentId === agent.id,
        )
        const withoutCheckpoint = checkpoint ? removeWorkflowCheckpoint(current, checkpoint.id) : current
        const completedEntry = workflowRunEntry('completed', {
          agentId: agent.id,
          agentName: agent.name,
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          detail: completionDetail,
        })
        return progress.shouldContinue
          ? advanceWorkflowRunCycle(
              withoutCheckpoint,
              agent.projectPath,
              completedEntry,
              workflowRunEntry('started', {
                detail: `Lauf ${progress.cycle + 1}/${progress.targetCycles} gestartet`,
              }),
            )
          : appendWorkflowRunEntry(withoutCheckpoint, agent.projectPath, completedEntry)
      })

      if (progress.shouldContinue) {
        setRoutes((current) => current.map((route) =>
          samePath(route.projectPath, agent.projectPath)
            ? { ...route, lastForwardedTask: undefined }
            : route,
        ))
        resetInactiveAgentStatuses()
        addEvent(
          'Workflow-Lauf abgeschlossen',
          `Lauf ${progress.cycle}/${progress.targetCycles} ist abgeschlossen. Lauf ${progress.cycle + 1}/${progress.targetCycles} wird gestartet.`,
        )
        window.setTimeout(() => {
          void startInitialWorkflowsRef.current({
            repeatCycle: progress.cycle + 1,
            targetCycles: progress.targetCycles,
          })
            .then(({ sentCount, busyCount }) => {
              if (sentCount > 0 || busyCount > 0) return
              autoRunRef.current = false
              setAutoRun(false)
              releaseAutomationLease()
              updateWorkflowRuntime((current) => appendWorkflowRunEntry(
                current,
                agent.projectPath,
                workflowRunEntry('paused', {
                  detail: `Lauf ${progress.cycle + 1}/${progress.targetCycles} konnte nicht gestartet werden.`,
                }),
              ))
              addEvent(
                'Workflow-Loop angehalten',
                `Lauf ${progress.cycle + 1}/${progress.targetCycles} wurde nicht von einem Initial-Agenten angenommen.`,
              )
            })
            .catch((error) => {
              autoRunRef.current = false
              setAutoRun(false)
              releaseAutomationLease()
              addEvent(
                'Workflow-Loop angehalten',
                error instanceof Error ? error.message : 'Der nächste Lauf konnte nicht gestartet werden.',
              )
            })
        }, 0)
        return
      }

      autoRunRef.current = false
      setAutoRun(false)
      releaseAutomationLease()
      addEvent(
        'Automatik am Stopp beendet',
        `${agent.name} hat Lauf ${progress.cycle}/${progress.targetCycles} abgeschlossen. Es werden keine weiteren Übergaben gestartet.`,
      )
      setWorkflowStopNotice({
        projectName: codexProjects.find((project) => samePath(project.path, agent.projectPath))?.label ?? agent.projectPath,
        sourceAgentName: agent.name,
        stopNames: stopDeliveries.map((delivery) => delivery.stop.name),
        cycle: progress.cycle,
        targetCycles: progress.targetCycles,
        durationMs: runBeforeStop
          ? Math.max(0, Date.now() - Date.parse(runBeforeStop.startedAt))
          : agent.lastDurationMs,
      })
      return
    }

    if (agentDeliveries.length === 0) {
      updateAgent(agent.id, {
        status: 'fertig',
        pendingTurnId: '',
        runStartedAt: '',
      })
      return
    }

    if (returningToInitialAgent) {
      sharedStateDirty.current = true
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      activeDeliveryTargetIds.current.clear()
      const progress = workflowRunCycleProgress(workflowRuntimeRef.current, agent.projectPath)
      const completionDetail = `${agent.name}: Rückgabe zum Initial-Agenten beendet Lauf ${progress.cycle}/${progress.targetCycles}.`
      updateWorkflowRuntime((current) => {
        const checkpoint = current.checkpoints.find(
          (item) => samePath(item.projectPath, agent.projectPath) && item.sourceAgentId === agent.id,
        )
        const withoutCheckpoint = checkpoint ? removeWorkflowCheckpoint(current, checkpoint.id) : current
        const completedEntry = workflowRunEntry('completed', {
          agentId: agent.id,
          agentName: agent.name,
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          detail: completionDetail,
        })
        return progress.shouldContinue
          ? advanceWorkflowRunCycle(
              withoutCheckpoint,
              agent.projectPath,
              completedEntry,
              workflowRunEntry('started', {
                detail: `Lauf ${progress.cycle + 1}/${progress.targetCycles} gestartet`,
              }),
            )
          : appendWorkflowRunEntry(withoutCheckpoint, agent.projectPath, completedEntry)
      })

      if (progress.shouldContinue) {
        persistWorkflowCheckpoint({
          source: agent,
          targets: agentDeliveries.map((delivery) => delivery.target),
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          state: 'pending',
        })
        resetInactiveAgentStatuses()
        addEvent(
          'Workflow-Lauf abgeschlossen',
          `Lauf ${progress.cycle}/${progress.targetCycles} ist abgeschlossen. Die Rückgabe von ${agent.name} eröffnet Lauf ${progress.cycle + 1}/${progress.targetCycles}.`,
        )
      } else {
        updateAgent(agent.id, {
          status: 'fertig',
          pendingTurnId: '',
          runStartedAt: '',
        })
        autoRunRef.current = false
        setAutoRun(false)
        releaseAutomationLease()
        addEvent(
          'Automatik am Laufende beendet',
          `${agent.name} hat Lauf ${progress.cycle}/${progress.targetCycles} abgeschlossen. Die Rückgabe zum Initial-Agenten wurde nicht erneut gesendet.`,
        )
        return
      }
    }

    const readyAgentDeliveries = agentDeliveries.filter(({ target }) => {
      const targetBusy = isDeliveryTargetBusy({
        targetId: target.id,
        activeTargetIds: activeDeliveryTargetIds.current,
        agents: agentsRef.current,
      })
      if (!targetBusy) {
        activeDeliveryTargetIds.current.add(target.id)
        return true
      }
      const queuedSourceIds = deliveryQueueRef.current[target.id] ?? []
      if (!queuedSourceIds.includes(agent.id)) {
        updateDeliveryQueue((current) => enqueueDelivery(current, target.id, agent.id))
        addEvent(
          'Weitergabe wartet',
          `${agent.name} -> ${target.name}: Der Zielagent verarbeitet noch eine andere Übergabe.`,
        )
      }
      return false
    })
    if (readyAgentDeliveries.length === 0) return

    const deliveryAttempts = await Promise.all(readyAgentDeliveries.map(async ({ target, route }) => {
      const message = buildHandoffMessage(
        agent,
        target,
        route,
        workflowStatusesForAgent(target, workflowStatuses),
        knowledgeSourcesForAgent(knowledgeSources, target.projectPath, target.usesProjectKnowledge),
        projectGoalForProject(projectGoals, target.projectPath),
        unconditionalForwarding.enabled,
      )
      if (!target.threadId) {
        activeDeliveryTargetIds.current.delete(target.id)
        updateAgent(target.id, {
          status: 'rueckfrage',
          pendingTurnId: '',
          runStartedAt: '',
        })
        addEvent('Weitergabe nicht gesendet', `${target.name} ist mit keinem Codex-Chat verknüpft.`)
        return { targetId: target.id, targetName: target.name, delivered: false }
      }

      updateAgent(target.id, {
        status: 'laeuft',
        lastResult: message,
        runStartedAt: new Date().toISOString(),
        lastInboundAgentId: agent.id,
        runPurpose: 'handoff',
      })
      try {
        const response = await fetch(
          `/api/threads/${encodeURIComponent(target.threadId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message, cwd: target.projectPath, webAccess: target.webAccess }),
          },
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Übergabe konnte nicht gesendet werden.')
        }
        const turnId = requireStartedTurnId(data, 'die Übergabe')
        applyThreadReplacement(target, data.replacementThread)
        updateAgent(target.id, {
          status: 'laeuft',
          pendingTurnId: turnId,
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
        return { targetId: target.id, targetName: target.name, delivered: true }
      } catch (error) {
        activeDeliveryTargetIds.current.delete(target.id)
        updateAgent(target.id, {
          status: 'rueckfrage',
          pendingTurnId: '',
          runStartedAt: '',
        })
        addEvent(
          'Weitergabe nicht gesendet',
          `${target.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
        )
        return { targetId: target.id, targetName: target.name, delivered: false }
      }
    }))
    const deliveryOutcome = summarizeDeliveryAttempts(deliveryAttempts)
    updateAgent(agent.id, {
      status: deliveryOutcome.sourceStatus,
      ...(managementRecoveryDelivery && deliveryOutcome.delivered
        ? { lastInboundAgentId: '' }
        : {}),
    })
    if (deliveryOutcome.delivered) {
      const deliveredTargetIds = new Set(
        deliveryAttempts.filter((attempt) => attempt.delivered).map((attempt) => attempt.targetId),
      )
      commitForwardIntervalHits(
        readyAgentDeliveries.filter((delivery) => deliveredTargetIds.has(delivery.target.id)),
      )
      updateWorkflowRuntime((current) => {
        const checkpoint = current.checkpoints.find(
          (item) => samePath(item.projectPath, agent.projectPath) && item.sourceAgentId === agent.id,
        )
        const withoutCheckpoint = checkpoint
          ? removeWorkflowCheckpoint(current, checkpoint.id)
          : current
        return appendWorkflowRunEntry(
          withoutCheckpoint,
          agent.projectPath,
          workflowRunEntry('handoff-delivered', {
            agentId: agent.id,
            agentName: agent.name,
            targetAgentIds: readyAgentDeliveries
              .filter((delivery) => deliveryOutcome.deliveredTargets.includes(delivery.target.name))
              .map((delivery) => delivery.target.id),
            targetAgentNames: deliveryOutcome.deliveredTargets,
            statusIds: resultStatusIds,
            statusNames: resultStatusNames,
            taskSignature: currentTaskSignature,
            detail: `${agent.name} -> ${deliveryOutcome.deliveredTargets.join(', ')}`,
          }),
        )
      })
      addEvent(
        reportsInternalWorkflowError ? 'Interner Workflow-Fehler gemeldet' : 'Aufgabe weitergegeben',
        reportsInternalWorkflowError
          ? `${agent.name} -> ${deliveryOutcome.deliveredTargets.join(', ')}: Der CEO muss die Statusdefinition oder Workflow-Konfiguration prüfen.`
          : `${agent.name} -> ${deliveryOutcome.deliveredTargets.join(', ')}`,
      )
    } else {
      sharedStateDirty.current = true
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      releaseAutomationLease()
      addEvent(
        'Keine Aufgabe weitergegeben',
        `${agent.name}: Kein Ziel-Chat hat die Übergabe angenommen.`,
      )
      updateWorkflowRuntime((current) => appendWorkflowRunEntry(
        current,
        agent.projectPath,
        workflowRunEntry('paused', {
          agentId: agent.id,
          agentName: agent.name,
          statusIds: resultStatusIds,
          statusNames: resultStatusNames,
          detail: 'Die nächste Übergabe ist fehlgeschlagen. Der Kontrollpunkt bleibt zur manuellen Wiederaufnahme erhalten.',
        }),
      ))
    }
  }, [addEvent, agents, applyThreadReplacement, codexProjects, commitForwardIntervalHits, knowledgeSources, persistWorkflowCheckpoint, projectGoals, recordSupervisorDiagnosis, releaseAutomationLease, resetInactiveAgentStatuses, routes, updateAgent, updateDeliveryQueue, updateWorkflowRuntime, workflowInitials, workflowPrompts, workflowStatusFilters, workflowStatuses, workflowStops])

  useEffect(() => {
    if (!autoRun || !automationLeader || !sharedStateReady || !selectedProjectPath) return
    const checkpoint = resumableWorkflowCheckpoint(
      workflowRuntimeRef.current,
      selectedProjectPath,
    )
    if (!checkpoint || recoveredCheckpointIds.current.has(checkpoint.id)) return
    const checkpointAge = Date.now() - Date.parse(checkpoint.updatedAt)
    if (!Number.isFinite(checkpointAge) || checkpointAge < ORPHANED_HANDOFF_GRACE_MS) {
      const remainingDelay = Number.isFinite(checkpointAge)
        ? Math.max(250, ORPHANED_HANDOFF_GRACE_MS - checkpointAge)
        : ORPHANED_HANDOFF_GRACE_MS
      const timer = window.setTimeout(
        () => setCheckpointRecoveryRevision((current) => current + 1),
        remainingDelay,
      )
      return () => window.clearTimeout(timer)
    }
    if (!shouldRecoverPendingCheckpoint(
      checkpoint,
      agents,
      Date.now(),
      ORPHANED_HANDOFF_GRACE_MS,
    )) return
    const source = agents.find((agent) => agent.id === checkpoint.sourceAgentId)
    if (!source) return

    recoveredCheckpointIds.current.add(checkpoint.id)
    checkpoint.targetAgentIds.forEach((targetId) => activeDeliveryTargetIds.current.delete(targetId))
    addEvent(
      'Unterbrochene Übergabe wird fortgesetzt',
      `${checkpoint.sourceAgentName} → ${checkpoint.targetAgentNames.join(', ')}`,
    )
    void handoff({
      ...source,
      lastResult: checkpoint.result,
      lastCompletedTurnId: checkpoint.sourceTurnId,
    }, { replayCheckpoint: true })
  }, [addEvent, agents, autoRun, automationLeader, checkpointRecoveryRevision, handoff, selectedProjectPath, sharedStateReady])

  const connectAgents = useCallback((connection: Connection) => {
    const sourceHandle = connection.sourceHandle === 'interval' ? 'interval' : 'output'
    const sourcePrompt = workflowPrompts.find((prompt) => prompt.id === connection.source)
    const sourceStatusFilter = workflowStatusFilters.find((filter) => filter.id === connection.source)
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target ||
      !['output', 'interval'].includes(connection.sourceHandle ?? '') ||
      connection.targetHandle !== 'input'
    ) {
      return
    }
    if (
      sourceHandle === 'interval' &&
      !sourcePrompt?.interval &&
      !sourceStatusFilter?.interval
    ) return
    const sourceInitial = workflowInitials.find((initial) => initial.id === connection.source)
    if (sourceInitial) {
      if (connection.target !== sourceInitial.ownerAgentId) {
        addEvent(
          'Workflow-Verbindung abgelehnt',
          'Ein Initial darf ausschließlich direkt mit dem Agenten seines Dashboards verbunden werden.',
        )
        return
      }
    }
    const sourceForwardFilter = sourceStatusFilter?.statusId === UNCONDITIONAL_FORWARD_STATUS_ID
      ? sourceStatusFilter
      : undefined
    const targetForwardFilter = workflowStatusFilters.find((filter) =>
      filter.id === connection.target && filter.statusId === UNCONDITIONAL_FORWARD_STATUS_ID,
    )
    if (targetForwardFilter && connection.source !== targetForwardFilter.ownerAgentId) {
      addEvent(
        'Workflow-Verbindung abgelehnt',
        'Der feste Status „Weiterleiten“ darf nur mit dem Ausgang seines eigenen Agenten verbunden werden.',
      )
      return
    }
    if (sourceForwardFilter) {
      const targetIsAgent = agents.some((agent) => agent.id === connection.target)
      const alreadyHasTarget = routes.some((route) =>
        route.ownerAgentId === sourceForwardFilter.ownerAgentId &&
        route.sourceId === sourceForwardFilter.id &&
        (route.sourceHandle ?? 'output') === sourceHandle,
      )
      const createsUnsupportedCycle = targetIsAgent && wouldCreateUnsupportedUnconditionalForwardCycle({
        sourceAgentId: sourceForwardFilter.ownerAgentId,
        targetAgentId: connection.target,
        statusId: UNCONDITIONAL_FORWARD_STATUS_ID,
        routes,
        statusFilters: workflowStatusFilters,
      })
      if (!targetIsAgent || alreadyHasTarget || createsUnsupportedCycle) {
        addEvent(
          'Workflow-Verbindung abgelehnt',
          createsUnsupportedCycle
            ? 'Der feste Status „Weiterleiten“ erlaubt nur einen direkten Zwei-Agenten-Kreis. Selbstschleifen und größere Kreise sind gesperrt.'
            : sourceForwardFilter.interval
              ? 'Jeder Ausgang des festen Status „Weiterleiten“ darf genau einen Zielagenten besitzen.'
              : 'Der feste Status „Weiterleiten“ muss mit genau einem Zielagenten verbunden sein.',
        )
        return
      }
    }
    if (routes.some((route) =>
      samePath(route.projectPath, selectedProject?.path ?? '') &&
      route.sourceId === connection.source &&
      (route.sourceHandle ?? 'output') === sourceHandle &&
      route.targetId === connection.target,
    )) {
      addEvent('Workflow-Verbindung nicht erstellt', 'Diese Verbindung ist bereits vorhanden.')
      return
    }
    const route: WorkflowRoute = {
      id: crypto.randomUUID(),
      ownerAgentId: selectedAgent?.id ?? '',
      projectPath: selectedProject?.path ?? '',
      sourceId: connection.source,
      targetId: connection.target,
      sourceHandle,
      condition: 'Immer',
      prompt: sourceInitial ? '' : 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.',
    }
    sharedStateDirty.current = true
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
  }, [activeDashboardOwnerId, addEvent, agents, routes, selectedProject?.path, workflowInitials, workflowPrompts, workflowStatusFilters, workflowStops, workflowTimers])

  const addWorkflowPrompt = () => {
    const prompt: WorkflowPrompt = {
      id: crypto.randomUUID(),
      ownerAgentId: selectedAgent?.id ?? '',
      projectPath: selectedProject?.path ?? '',
      name: 'Weiterleiten',
      condition: 'Immer',
      prompt: 'Bearbeite die vorherige Antwort gemäß deiner Rolle und arbeite selbstständig weiter.',
      intervalSource: 'none',
      interval: 0,
      intervalCount: 0,
      intervalMode: 'replace',
      intervalPrompt: '',
    }
    setWorkflowPrompts((current) => [...current, prompt])
  }

  const updateWorkflowPrompt = (promptId: string, patch: Partial<WorkflowPrompt>) => {
    setWorkflowPrompts((current) =>
      current.map((prompt) => (prompt.id === promptId ? { ...prompt, ...patch } : prompt)),
    )
  }

  const updateWorkflowPromptInterval = (promptId: string, value: unknown) => {
    const interval = normalizeForwardInterval(value)
    sharedStateDirty.current = true
    setWorkflowPrompts((current) => current.map((prompt) =>
      prompt.id === promptId
        ? {
            ...prompt,
            interval,
            intervalSource: interval > 0
              ? prompt.intervalSource === 'project'
                ? 'project'
                : 'custom'
              : 'none',
            intervalCount: 0,
          }
        : prompt,
    ))
  }

  const updateWorkflowPromptIntervalSource = (promptId: string, source: WorkflowPrompt['intervalSource']) => {
    sharedStateDirty.current = true
    setWorkflowPrompts((current) => current.map((prompt) => {
      if (prompt.id !== promptId) return prompt
      if (source === 'none') return { ...prompt, intervalSource: 'none', interval: 0, intervalCount: 0 }
      if (source === 'project') return { ...prompt, intervalSource: 'project', interval: selectedLoopCount, intervalCount: 0 }
      const fallbackInterval = prompt.intervalSource === 'project' || prompt.interval <= 0 ? 1 : prompt.interval
      return { ...prompt, intervalSource: 'custom', interval: fallbackInterval, intervalCount: 0 }
    }))
  }

  const updateWorkflowPromptIntervalMode = (promptId: string, value: unknown) => {
    const intervalMode = normalizeForwardIntervalMode(value)
    sharedStateDirty.current = true
    setWorkflowPrompts((current) => current.map((prompt) =>
      prompt.id === promptId ? { ...prompt, intervalMode } : prompt,
    ))
  }

  const updateWorkflowPromptIntervalPrompt = (promptId: string, intervalPrompt: string) => {
    sharedStateDirty.current = true
    setWorkflowPrompts((current) => current.map((prompt) =>
      prompt.id === promptId ? { ...prompt, intervalPrompt } : prompt,
    ))
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

  const persistProjectGoal = async (projectPath: string, goal: string) => {
    const response = await fetch('/api/project-goal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: projectPath, goal, source: 'user' }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Projektziel konnte nicht gespeichert werden.')
    const storedGoal = typeof data.goal === 'string' ? data.goal : ''
    setProjectGoals((current) => [
      ...current.filter((entry) => !samePath(entry.projectPath, projectPath)),
      { projectPath, goal: storedGoal },
    ])
    return storedGoal
  }

  const saveProjectGoal = async (goal = projectGoalDraft) => {
    if (!selectedProject || projectGoalSaving) return
    setProjectGoalSaving(true)
    setProjectGoalError('')
    try {
      const storedGoal = await persistProjectGoal(selectedProject.path, goal)
      setProjectGoalDraft(storedGoal)
      setProjectGoalOpen(false)
      addEvent(
        storedGoal ? 'Projektziel gespeichert' : 'Projektziel entfernt',
        selectedProject.label,
      )
    } catch (error) {
      setProjectGoalError(error instanceof Error ? error.message : 'Projektziel konnte nicht gespeichert werden.')
    } finally {
      setProjectGoalSaving(false)
    }
  }

  const saveProjectKnowledgeSources = async (sources: KnowledgeSource[]) => {
    if (!selectedProject) return false
    setKnowledgeSourceSaving(true)
    setKnowledgeSourceError('')
    try {
      const response = await fetch('/api/knowledge-sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: selectedProject.path,
          sources: sources.map((source) => ({
            id: source.id,
            name: source.name,
            type: source.type,
            location: source.location,
            description: source.description,
            enabled: source.enabled,
          })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Wissensdatenbank konnte nicht gespeichert werden.')
      const storedSources: KnowledgeSource[] = data.sources.map(
        (source: Omit<KnowledgeSource, 'projectPath'>) => ({ ...source, projectPath: selectedProject.path }),
      )
      setKnowledgeSources((current) => [
        ...current.filter((source) => !samePath(source.projectPath, selectedProject.path)),
        ...storedSources,
      ])
      return true
    } catch (error) {
      setKnowledgeSourceError(error instanceof Error ? error.message : 'Wissensdatenbank konnte nicht gespeichert werden.')
      return false
    } finally {
      setKnowledgeSourceSaving(false)
    }
  }

  const addKnowledgeSource = async () => {
    const name = knowledgeSourceName.trim()
    const location = knowledgeSourceLocation.trim()
    if (!name || !location || !selectedProject || knowledgeSourceSaving) return
    if (projectKnowledgeSources.some((source) => source.name.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))) {
      setKnowledgeSourceError(tx('Eine Quelle mit diesem Namen existiert bereits.', 'A source with this name already exists.'))
      return
    }
    const next = [...projectKnowledgeSources, {
      id: crypto.randomUUID(),
      projectPath: selectedProject.path,
      name,
      type: knowledgeSourceType,
      location,
      description: knowledgeSourceDescription.trim(),
      enabled: true,
    }]
    if (await saveProjectKnowledgeSources(next)) {
      setKnowledgeSourceName('')
      setKnowledgeSourceLocation('')
      setKnowledgeSourceDescription('')
      addEvent('Wissensquelle erstellt', `${selectedProject.label}: ${name}`)
    }
  }

  const setKnowledgeSourceEnabled = async (sourceId: string, enabled: boolean) => {
    const source = projectKnowledgeSources.find((item) => item.id === sourceId)
    if (!source || knowledgeSourceSaving) return
    const next = projectKnowledgeSources.map((item) => item.id === sourceId ? { ...item, enabled } : item)
    setKnowledgeSources((current) => current.map((item) => item.id === sourceId ? { ...item, enabled } : item))
    if (await saveProjectKnowledgeSources(next)) {
      addEvent(enabled ? 'Wissensquelle aktiviert' : 'Wissensquelle deaktiviert', source.name)
    } else {
      setKnowledgeSources((current) => current.map((item) => item.id === sourceId ? source : item))
    }
  }

  const deleteKnowledgeSource = async (sourceId: string) => {
    const source = projectKnowledgeSources.find((item) => item.id === sourceId)
    if (!source || knowledgeSourceSaving) return
    if (await saveProjectKnowledgeSources(projectKnowledgeSources.filter((item) => item.id !== sourceId))) {
      addEvent('Wissensquelle gelöscht', source.name)
    }
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
    if (status.id === UNCONDITIONAL_FORWARD_STATUS_ID) return
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
    if (statusId === UNCONDITIONAL_FORWARD_STATUS_ID) {
      addEvent('Workflow-Status nicht gelöscht', `${UNCONDITIONAL_FORWARD_STATUS_NAME} ist ein fester Systemstatus.`)
      return
    }
    const status = projectWorkflowStatuses.find((item) => item.id === statusId)
    setWorkflowStatuses((current) => current.filter((item) => item.id !== statusId))
    const filterIds = workflowStatusFilters.filter((filter) => filter.statusId === statusId).map((filter) => filter.id)
    setWorkflowStatusFilters((current) => current.filter((filter) => filter.statusId !== statusId))
    setRoutes((current) => current.filter((route) => !filterIds.includes(route.sourceId) && !filterIds.includes(route.targetId)))
    setAgents((current) => current.map((agent) => {
      if (!agent.workflowStatusIds?.includes(statusId)) return agent
      return {
        ...agent,
        workflowStatusIds: agent.workflowStatusIds.filter((id) => id !== statusId),
        workflowStatusUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }))
    setSelectedStatusFilterId('')
    addEvent('Workflow-Status gelöscht', status?.name ?? 'Status')
  }

  const addWorkflowStatusFilter = () => {
    const status = projectWorkflowStatuses.find((candidate) =>
      !workflowStatusFilters.some((filter) =>
        samePath(filter.projectPath, selectedProject?.path ?? '') && filter.statusId === candidate.id,
      ),
    )
    if (!status || !activeDashboardOwnerId || !selectedProject) {
      addEvent('Status-Filter nicht erstellt', 'Lege zuerst einen Workflow-Status an.')
      return
    }
    const filter: WorkflowStatusFilter = {
      id: crypto.randomUUID(),
      ownerAgentId: selectedAgent?.id ?? '',
      projectPath: selectedProject.path,
      name: `Status: ${status.name}`,
      statusId: status.id,
      interval: 0,
      intervalCount: 0,
      intervalMode: 'replace',
      intervalPrompt: '',
    }
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) => [...current, filter])
    setAgents((current) => current.map((agent) =>
      agent.id === selectedAgent?.id
        ? {
            ...agent,
            workflowStatusIds: Array.from(new Set([...agent.workflowStatusIds, status.id])),
            workflowStatusUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : agent,
    ))
    addEvent('Status-Filter erstellt', status.name)
  }

  const selectWorkflowStatusFilterStatus = (filterId: string, statusId: string) => {
    const status = projectWorkflowStatuses.find((item) => item.id === statusId)
    const currentFilter = workflowStatusFilters.find((item) => item.id === filterId)
    if (!status || !currentFilter) {
      return
    }
    if (workflowStatusFilters.some((filter) =>
      filter.id !== filterId &&
      filter.ownerAgentId === currentFilter.ownerAgentId &&
      filter.statusId === statusId,
    )) {
      addEvent('Status-Filter nicht geändert', `Der Status „${status.name}“ ist in diesem Dashboard bereits vorhanden.`)
      return
    }
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) =>
      current.map((filter) =>
        filter.id === filterId
          ? { ...filter, statusId: status.id, name: `Status: ${status.name}` }
          : filter,
      ),
    )
    setAgents((current) => current.map((agent) => {
      if (agent.id !== currentFilter.ownerAgentId) return agent
      const oldStatusStillUsed = workflowStatusFilters.some((filter) =>
        filter.id !== filterId &&
        filter.ownerAgentId === currentFilter.ownerAgentId &&
        filter.statusId === currentFilter.statusId,
      )
      const retainedIds = oldStatusStillUsed
        ? agent.workflowStatusIds
        : agent.workflowStatusIds.filter((id) => id !== currentFilter.statusId)
      return {
        ...agent,
        workflowStatusIds: Array.from(new Set([...retainedIds, statusId])),
        workflowStatusUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }))
  }

  const updateWorkflowStatusFilterPrompt = (filterId: string, prompt: string) => {
    sharedStateDirty.current = true
    setRoutes((current) =>
      current.map((route) =>
        route.sourceId === filterId && (route.sourceHandle ?? 'output') === 'output'
          ? { ...route, prompt }
          : route,
      ),
    )
  }

  const updateWorkflowStatusFilterInterval = (filterId: string, value: unknown) => {
    const interval = normalizeForwardInterval(value)
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) => current.map((filter) =>
      filter.id === filterId
        ? { ...filter, interval, intervalCount: 0 }
        : filter,
    ))
  }

  const updateWorkflowStatusFilterIntervalMode = (filterId: string, value: unknown) => {
    const intervalMode = normalizeForwardIntervalMode(value)
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) => current.map((filter) =>
      filter.id === filterId ? { ...filter, intervalMode } : filter,
    ))
  }

  const updateWorkflowStatusFilterIntervalPrompt = (filterId: string, intervalPrompt: string) => {
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) => current.map((filter) =>
      filter.id === filterId ? { ...filter, intervalPrompt } : filter,
    ))
    setRoutes((current) =>
      current.map((route) =>
        route.sourceId === filterId && (route.sourceHandle ?? 'output') === 'interval'
          ? { ...route, prompt: intervalPrompt }
          : route,
      ),
    )
  }

  const deleteWorkflowStatusFilter = (filterId: string) => {
    const removedFilter = workflowStatusFilters.find((filter) => filter.id === filterId)
    sharedStateDirty.current = true
    setWorkflowStatusFilters((current) => current.filter((filter) => filter.id !== filterId))
    setRoutes((current) => current.filter((route) => route.sourceId !== filterId && route.targetId !== filterId))
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${filterId}`]
      return next
    })
    if (removedFilter) {
      const statusStillUsed = workflowStatusFilters.some((filter) =>
        filter.id !== filterId &&
        filter.ownerAgentId === removedFilter.ownerAgentId &&
        filter.statusId === removedFilter.statusId,
      )
      if (!statusStillUsed) {
        setAgents((current) => current.map((agent) =>
          agent.id === removedFilter.ownerAgentId
            ? {
                ...agent,
                workflowStatusIds: agent.workflowStatusIds.filter((id) => id !== removedFilter.statusId),
                workflowStatusUpdatedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : agent,
        ))
      }
    }
    setSelectedStatusFilterId('')
  }

  const addWorkflowInitial = () => {
    if (!activeDashboardOwnerId || !selectedAgent) {
      addEvent('Initial nicht angelegt', 'Es ist kein Agenten-Dashboard ausgewählt.')
      return
    }
    if (workflowInitials.some((initial) =>
      samePath(initial.projectPath, selectedProject?.path ?? ''),
    )) {
      addEvent('Initial nicht angelegt', 'In diesem Agenten-Dashboard existiert bereits ein Initial-Baustein.')
      return
    }
    const initial: WorkflowInitial = {
      id: crypto.randomUUID(),
      ownerAgentId: selectedAgent.id,
      projectPath: selectedProject?.path ?? '',
      name: 'Start',
      instruction: '',
    }
    sharedStateDirty.current = true
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
      ownerAgentId: selectedAgent?.id ?? '',
      projectPath: selectedProject.path,
      name: 'Stop',
    }
    sharedStateDirty.current = true
    setWorkflowStops((current) => [...current, stop])
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
      ownerAgentId: selectedAgent?.id ?? '',
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
    sharedStateDirty.current = true
    setWorkflowTimers((current) => [...current, timer])
    addEvent('Zeitplan erstellt', 'Doppelklick auf den Baustein öffnet die Konfiguration.')
  }

  if (LEGACY_STATUS_UI_ENABLED) {
    void addWorkflowStatusFilter
    void selectWorkflowStatusFilterStatus
    void addWorkflowStop
    void addWorkflowTimer
  }

  const addWorkflowLoop = () => {
    if (!activeDashboardOwnerId || !selectedProject) return
    const loop: WorkflowLoop = {
      id: crypto.randomUUID(),
      ownerAgentId: selectedAgent?.id ?? '',
      projectPath: selectedProject.path,
      name: 'Rücksprung',
      targetAgentId: '',
      targetAgentIds: [],
    }
    sharedStateDirty.current = true
    setWorkflowLoops((current) => [...current, loop])
    addEvent('Rücksprung erstellt', 'Zielagent im Baustein festlegen.')
  }

  const updateWorkflowLoop = (loopId: string, patch: Partial<WorkflowLoop>) => {
    sharedStateDirty.current = true
    setWorkflowLoops((current) =>
      current.map((loop) => (loop.id === loopId ? { ...loop, ...patch } : loop)),
    )
  }

  const deleteWorkflowLoop = (loopId: string) => {
    sharedStateDirty.current = true
    setWorkflowLoops((current) => current.filter((loop) => loop.id !== loopId))
    setRoutes((current) =>
      current.filter((route) => route.sourceId !== loopId && route.targetId !== loopId),
    )
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${loopId}`]
      return next
    })
    setSelectedLoopId('')
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
    if (agentId === activeDashboardOwnerId) {
      addEvent('Agent nicht entfernt', 'Der Dashboard-Eigentümer muss in seinem eigenen Workflow sichtbar bleiben.')
      return
    }
    sharedStateDirty.current = true
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
    setWorkflowPositions((current) => {
      const next = { ...current }
      delete next[`${activeDashboardOwnerId}:${agentId}`]
      return next
    })
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
    sharedStateDirty.current = true
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
  }

  const addAgentToDashboard = (agentId: string) => {
    if (activeBoardAgentIds.includes(agentId)) return
    const index = dashboardAgents.length
    dropAgentIntoDashboard(agentId, {
      x: 70 + (index % 4) * 220,
      y: 90 + Math.floor(index / 4) * 130,
    })
    addEvent(
      'Agent ins Dashboard eingefügt',
      projectAgents.find((agent) => agent.id === agentId)?.name ?? 'Agent',
    )
  }

  const applySavedWorkflowLayoutPattern = () => {
    if (!activeDashboardOwnerId || !activeLayoutPattern) return false
    const visibleNodeIds = new Set([
      ...dashboardAgents.map((node) => node.id),
      ...dashboardPrompts.map((node) => node.id),
      ...projectInitials.map((node) => node.id),
      ...projectStatusFilters.map((node) => node.id),
      ...projectStops.map((node) => node.id),
      ...projectTimers.map((node) => node.id),
      ...projectLoops.map((node) => node.id),
    ])
    const patternPositions = activeLayoutPattern.nodes.filter((node) => visibleNodeIds.has(node.id))
    if (patternPositions.length === 0) return false
    sharedStateDirty.current = true
    setWorkflowPositions((current) => ({
      ...current,
      ...Object.fromEntries(
        patternPositions.map((node) => [
          `${activeDashboardOwnerId}:${node.id}`,
          { x: node.x, y: node.y },
        ]),
      ),
    }))
    setLayoutRevision((current) => current + 1)
    setLayoutPatternFeedback(tx('Muster angewendet', 'Pattern applied'))
    addEvent('Layout-Muster angewendet', `${patternPositions.length} Bausteine aus Vorlage angeordnet.`)
    return true
  }

  const autoArrangeWorkflow = () => {
    if (applySavedWorkflowLayoutPattern()) return
    const nodeIds = [
      ...projectInitials.map((initial) => initial.id),
      ...projectTimers.map((timer) => timer.id),
      ...dashboardAgents.map((agent) => agent.id),
      ...dashboardPrompts.map((prompt) => prompt.id),
      ...projectStatusFilters.map((filter) => filter.id),
      ...projectStops.map((stop) => stop.id),
      ...projectLoops.map((loop) => loop.id),
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
    sharedStateDirty.current = true
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
    setLayoutPatternFeedback(tx('Automatisch angeordnet', 'Arranged automatically'))
  }

  const saveWorkflowLayoutPattern = () => {
    if (!selectedProject || !activeDashboardOwnerId) return
    const nodeEntries: WorkflowLayoutPattern['nodes'] = [
      ...dashboardAgents.map((node) => ({ id: node.id, kind: 'agent' as const })),
      ...dashboardPrompts.map((node) => ({ id: node.id, kind: 'prompt' as const })),
      ...projectInitials.map((node) => ({ id: node.id, kind: 'initial' as const })),
      ...projectStatusFilters.map((node) => ({ id: node.id, kind: 'status' as const })),
      ...projectStops.map((node) => ({ id: node.id, kind: 'stop' as const })),
      ...projectTimers.map((node) => ({ id: node.id, kind: 'timer' as const })),
      ...projectLoops.map((node) => ({ id: node.id, kind: 'loop' as const })),
    ].map((node) => {
      const position = workflowPositions[`${activeDashboardOwnerId}:${node.id}`] ?? dashboardPositions[node.id] ?? { x: 0, y: 0 }
      return { ...node, x: position.x, y: position.y }
    })
    const pattern: WorkflowLayoutPattern = {
      id: crypto.randomUUID(),
      projectPath: selectedProject.path,
      dashboardId: activeDashboardOwnerId,
      savedAt: new Date().toISOString(),
      nodes: nodeEntries,
    }
    sharedStateDirty.current = true
    setWorkflowLayoutPatterns((current) => [
      ...current.filter((item) => !samePath(item.projectPath, selectedProject.path)),
      pattern,
    ])
    setLayoutPatternFeedback(tx('Gespeichert', 'Saved'))
    addEvent('Layout-Muster gespeichert', `${nodeEntries.length} Bausteine als Vorlage gespeichert.`)
  }

  useEffect(() => {
    const poll = async () => {
      if (autoRunRef.current && !automationLeaderRef.current) return
      const forwardNextQueuedSource = async (targetId: string) => {
        const nextDelivery = dequeueDelivery(deliveryQueueRef.current, targetId)
        const sourceId = nextDelivery.sourceId
        if (!sourceId) return
        updateDeliveryQueue(() => nextDelivery.queue)
        const source = agentsRef.current.find((item) => item.id === sourceId)
        if (autoRunRef.current && source) {
          await handoff(source)
        }
      }

      await Promise.all(
        agents
          .filter(
            (agent) => shouldPollPendingTurn({
              threadId: agent.threadId,
              pendingTurnId: agent.pendingTurnId,
              lastCompletedTurnId: agent.lastCompletedTurnId,
              isAlreadyPolling:
                pollingTurnIds.current.has(agent.pendingTurnId) ||
                processedTurnIds.current.has(agent.pendingTurnId),
            }),
          )
          .map(async (agent) => {
            pollingTurnIds.current.add(agent.pendingTurnId)
            try {
              const response = await fetch(
                `/api/threads/${encodeURIComponent(agent.threadId)}/result?turnId=${encodeURIComponent(agent.pendingTurnId)}`,
              )
              let data = await response.json()
              if (!response.ok) {
                throw new Error(data.error || 'Codex-Ergebnis konnte nicht gelesen werden.')
              }
              if (data.status === 'inProgress') {
                const persistedRunStartedAt = resolvePendingTurnStartedAt(
                  agent.runStartedAt,
                  agent.updatedAt,
                )
                const runAgeMs = persistedRunStartedAt
                  ? Math.max(0, Date.now() - persistedRunStartedAt)
                  : 0
                let activeTurnId = agent.pendingTurnId
                let activitySignature = ''
                if (runAgeMs >= 8000) {
                  const conversationResponse = await fetch(
                    `/api/threads/${encodeURIComponent(agent.threadId)}/conversation`,
                  )
                  if (conversationResponse.ok) {
                    const conversation = await conversationResponse.json()
                    const completedMessage = findCompletedConversationTurnById(
                      conversation.messages ?? [],
                      agent.pendingTurnId,
                    ) ?? findCompletedConversationTurn(
                      conversation.messages ?? [],
                      agent.lastResult,
                      agent.lastCompletedTurnId,
                    ) ?? (runAgeMs >= COMPLETED_TURN_RECOVERY_GRACE_MS
                      ? findLatestCompletedConversationTurnAfter(
                          conversation.messages ?? [],
                          agent.lastCompletedTurnId,
                        )
                      : null)
                    if (completedMessage) {
                      if (completedMessage.turnId !== agent.pendingTurnId) {
                        addEvent(
                          'Codex-Ergebnis wiedergefunden',
                          `${agent.name}: Fertige Antwort wurde aus dem Chat nachgelesen und dem offenen Lauf zugeordnet.`,
                        )
                      }
                      data = {
                        turnId: completedMessage.turnId,
                        status: 'completed',
                        text: completedMessage.text,
                        durationMs: runAgeMs,
                        error: null,
                      }
                    } else {
                      const activity = findConversationTurnActivityById(
                        conversation.messages ?? [],
                        agent.pendingTurnId,
                      ) ?? findConversationTurnActivity(
                        conversation.messages ?? [],
                        agent.lastResult,
                        agent.lastCompletedTurnId,
                      )
                      if (activity) {
                        activeTurnId = activity.turnId
                        activitySignature = activity.signature
                      }
                    }
                  }
                }
                if (data.status === 'inProgress') {
                  const now = Date.now()
                  const observation = observeTurnActivity(
                    turnActivityObservations.current.get(agent.id),
                    activeTurnId,
                    activitySignature,
                    now,
                  )
                  turnActivityObservations.current.set(agent.id, observation)
                  if (
                    turnNeedsWatchdogIntervention(observation, persistedRunStartedAt, now) &&
                    !watchdogInterventionTurnIds.current.has(activeTurnId)
                  ) {
                    watchdogInterventionTurnIds.current.add(activeTurnId)
                    addEvent(
                      'Systemueberwachung meldet Verzoegerung',
                      `${agent.name}: Seit mindestens fuenf Minuten wurde keine neue Codex-Aktivitaet erkannt. Der Lauf bleibt aktiv.`,
                    )
                    const noticeDurationSeconds = Math.round(runAgeMs / 1000)
                    setStallNotice({
                      agentName: agent.name,
                      turnId: activeTurnId,
                      durationSeconds: noticeDurationSeconds,
                    })
                  }
                  if (turnNeedsZombieIntervention(observation, persistedRunStartedAt, now)) {
                    const failureDetail = `Bridge-Turn ${activeTurnId} haengt seit ${Math.round(runAgeMs / 60_000)} Minuten ohne verwertbare Codex-Aktivitaet.`
                    const failedAgent: Agent = {
                      ...agent,
                      status: agent.runPurpose === 'chat'
                        ? 'wartet'
                        : autoRunRef.current ? 'rueckfrage' : 'wartet',
                      lastResult: [
                        'Der Codex-Lauf wurde nicht abgeschlossen.',
                        `Agent: ${agent.name}`,
                        `Fehler: ${failureDetail}`,
                        '',
                        `[Workflow-Status: ${MANAGEMENT_ERROR_STATUS_NAME}]`,
                      ].join('\n'),
                      pendingTurnId: '',
                      lastCompletedTurnId: activeTurnId,
                      runStartedAt: '',
                      updatedAt: new Date().toISOString(),
                    }
                    terminalResultObservations.current.delete(agent.pendingTurnId)
                    processedTurnIds.current.add(agent.pendingTurnId)
                    processedTurnIds.current.add(activeTurnId)
                    turnActivityObservations.current.delete(agent.id)
                    watchdogInterventionTurnIds.current.delete(agent.pendingTurnId)
                    watchdogInterventionTurnIds.current.delete(activeTurnId)
                    activeDeliveryTargetIds.current.delete(agent.id)
                    updateDeliveryQueue((current) => removeDeliveryTarget(current, agent.id))
                    updateAgent(agent.id, failedAgent)
                    updateWorkflowRuntime((current) => appendWorkflowRunEntry(
                      current,
                      agent.projectPath,
                      workflowRunEntry('paused', {
                        agentId: agent.id,
                        agentName: agent.name,
                        detail: failureDetail,
                      }),
                    ))
                    sharedStateDirty.current = true
                    if (autoRunRef.current) {
                      autoRunRef.current = false
                      setAutoRun(false)
                      setTransmittingAgentIds([])
                      releaseAutomationLease()
                      resetInactiveAgentStatuses()
                    }
                    addEvent('Bridge-Lauf blockiert', `${agent.name}: ${failureDetail}`)
                    setStallNotice({
                      agentName: agent.name,
                      turnId: activeTurnId,
                      durationSeconds: Math.round(runAgeMs / 1000),
                    })
                    return
                  }
                }
                if (data.status === 'inProgress') {
                  terminalResultObservations.current.delete(agent.pendingTurnId)
                  return
                }
              }
              watchdogInterventionTurnIds.current.delete(agent.pendingTurnId)
              if (data.turnId) {
                watchdogInterventionTurnIds.current.delete(data.turnId)
              }
              if (data.status === 'completed') {
                if (
                  processedTurnIds.current.has(agent.pendingTurnId) ||
                  (data.turnId && processedTurnIds.current.has(data.turnId))
                ) {
                  return
                }
                processedTurnIds.current.add(agent.pendingTurnId)
                if (data.turnId) processedTurnIds.current.add(data.turnId)
              }
              if (data.status !== 'completed') {
                const observations =
                  (terminalResultObservations.current.get(agent.pendingTurnId) ?? 0) + 1
                terminalResultObservations.current.set(agent.pendingTurnId, observations)
                if (!hasStableTerminalResult({
                  runStartedAt: agent.runStartedAt,
                  observations,
                  now: Date.now(),
                })) {
                  return
                }
                terminalResultObservations.current.delete(agent.pendingTurnId)
                processedTurnIds.current.add(agent.pendingTurnId)
                if (data.turnId) processedTurnIds.current.add(data.turnId)
                turnActivityObservations.current.delete(agent.id)
                const failureDetail = data.error?.message ?? data.status
                const consecutiveFailedRuns = nextConsecutiveFailedRuns(agent.consecutiveFailedRuns)
                const overloadEscalation = shouldEscalateWorkload(consecutiveFailedRuns)
                const failedAgent: Agent = {
                  ...agent,
                  status: agent.runPurpose === 'chat'
                    ? 'wartet'
                    : autoRunRef.current ? 'rueckfrage' : 'wartet',
                  lastResult: overloadEscalation
                    ? buildWorkloadEscalationResult({
                        agentName: agent.name,
                        failureDetail,
                        failedRuns: consecutiveFailedRuns,
                        availableProgress: agent.lastResult,
                        errorStatusName: MANAGEMENT_ERROR_STATUS_NAME,
                      })
                    : [
                        'Der Codex-Lauf wurde nicht abgeschlossen.',
                        `Agent: ${agent.name}`,
                        `Fehler: ${failureDetail}`,
                        '',
                        `[Workflow-Status: ${MANAGEMENT_ERROR_STATUS_NAME}]`,
                      ].join('\n'),
                  consecutiveFailedRuns,
                  pendingTurnId: '',
                  lastCompletedTurnId: data.turnId ?? agent.pendingTurnId,
                  runStartedAt: '',
                  updatedAt: new Date().toISOString(),
                }
                activeDeliveryTargetIds.current.delete(agent.id)
                updateAgent(agent.id, failedAgent)
                addEvent(
                  overloadEscalation
                    ? 'Aufgabe wird an CEO eskaliert'
                    : 'Codex-Ausführung nicht abgeschlossen',
                  overloadEscalation
                    ? `${agent.name}: Aufgabe wird nach ${consecutiveFailedRuns} Fehlläufen zur Aufteilung gemeldet.`
                    : `${agent.name}: ${failureDetail}`,
                )
                if (autoRunRef.current && failedAgent.assignment === 'management') {
                  updateDeliveryQueue((current) => removeDeliveryTarget(current, failedAgent.id))
                  sharedStateDirty.current = true
                  autoRunRef.current = false
                  setAutoRun(false)
                  setTransmittingAgentIds([])
                  updateDeliveryQueue(() => ({}))
                  resetInactiveAgentStatuses()
                  addEvent(
                    'Automatik gestoppt',
                    `${failedAgent.name} benötigt nach einem fehlgeschlagenen Lauf eine Benutzerentscheidung.`,
                  )
                } else if (autoRunRef.current && failedAgent.runPurpose !== 'chat' && failedAgent.autoForward) {
                  await handoff(failedAgent)
                  await forwardNextQueuedSource(failedAgent.id)
                }
                return
              }

              terminalResultObservations.current.delete(agent.pendingTurnId)
              turnActivityObservations.current.delete(agent.id)
              const parsedUserConfirmation = parseUserInteractionRequest(data.text ?? '')
              const pendingUserConfirmation = parsedUserConfirmation
                ? {
                    ...parsedUserConfirmation,
                    forwardAfterConfirmation: agent.runPurpose !== 'chat',
                    resumeAutomation: autoRunRef.current,
                  }
                : agent.runPurpose === 'chat' && agent.pendingUserConfirmation?.dismissed
                  ? agent.pendingUserConfirmation
                  : null
              const completedAgent: Agent = {
                ...agent,
                status: pendingUserConfirmation || agent.runPurpose === 'chat'
                  ? pendingUserConfirmation ? 'rueckfrage' : 'wartet'
                  : autoRunRef.current ? 'fertig' : 'wartet',
                lastResult: data.text ?? '',
                pendingTurnId: '',
                pendingUserConfirmation,
                lastCompletedTurnId: data.turnId ?? agent.pendingTurnId,
                runStartedAt: '',
                lastDurationMs:
                  data.durationMs ??
                  (agent.runStartedAt
                    ? Math.max(0, Date.now() - new Date(agent.runStartedAt).getTime())
                    : agent.lastDurationMs),
                completedRuns: agent.completedRuns + 1,
                consecutiveFailedRuns: 0,
                updatedAt: new Date().toISOString(),
              }
              activeDeliveryTargetIds.current.delete(agent.id)
              updateAgent(agent.id, completedAgent)
              addEvent('Codex-Ergebnis empfangen', `${agent.name} ist fertig.`)
              updateWorkflowRuntime((current) => appendWorkflowRunEntry(
                current,
                completedAgent.projectPath,
                workflowRunEntry('agent-completed', {
                  agentId: completedAgent.id,
                  agentName: completedAgent.name,
                  detail: completedAgent.lastResult.slice(0, 6_000),
                }),
              ))
              if (pendingUserConfirmation) {
                if (pendingUserConfirmation.resumeAutomation) {
                  autoRunRef.current = false
                  setAutoRun(false)
                  releaseAutomationLease()
                }
                if (!pendingUserConfirmation.dismissed) {
                  addEvent(
                    pendingUserConfirmation.kind === 'question'
                      ? 'Benutzerantwort erforderlich'
                      : 'Benutzerbestätigung erforderlich',
                    `${completedAgent.name}: ${pendingUserConfirmation.reason}`,
                  )
                }
                return
              }
              if (!autoRunRef.current && completedAgent.runPurpose !== 'chat') {
                const continuationSaved = capturePendingContinuation(completedAgent)
                if (continuationSaved) {
                  addEvent(
                    'Wiederaufnahme vorgemerkt',
                    `${completedAgent.name}: Die vorbereitete Weitergabe wird beim nächsten Start fortgesetzt.`,
                  )
                }
              }
              const pendingTeamPlan = completedAgent.assignment === 'management'
                ? parseManagementTeamPlan(completedAgent.lastResult)
                : null
              const teamPlanNeedsFormatCorrection =
                completedAgent.assignment === 'management' &&
                completedAgent.teamProvisioningEnabled &&
                !pendingTeamPlan &&
                (/<orchestrator_team_plan>/i.test(completedAgent.lastResult) ||
                  looksLikeManagementTeamPlan(completedAgent.lastResult))
              if (
                !autoRunRef.current &&
                authorizedTeamPlanRequestAgentIds.current.has(completedAgent.id) &&
                teamPlanNeedsFormatCorrection &&
                !automaticTeamPlanFormatRequests.current.has(completedAgent.id) &&
                claimAutomaticTeamPlanFormatRequest(
                  completedAgent.id,
                  completedAgent.lastCompletedTurnId,
                )
              ) {
                automaticTeamPlanFormatRequests.current.add(completedAgent.id)
                addEvent(
                  'Team-Vorschlag wird korrigiert',
                  `${completedAgent.name}: Alternatives Teamformat erkannt; Orchestrator-Format wird einmalig automatisch angefordert.`,
                )
                await requestTeamPlanFormatCorrectionRef.current(completedAgent)
                return
              }
              if (autoRunRef.current && pendingTeamPlan) {
                sharedStateDirty.current = true
                autoRunRef.current = false
                setAutoRun(false)
                setTransmittingAgentIds([])
                updateDeliveryQueue(() => ({}))
                activeDeliveryTargetIds.current.clear()
                resetInactiveAgentStatuses()
                addEvent(
                  'Team-Vorschlag wartet auf Freigabe',
                  `${completedAgent.name} hat die Arbeitsaufteilung vorbereitet. Der Benutzer muss sie bei Auto Stop prüfen und übernehmen.`,
                )
                return
              }
              if (completedAgent.runPurpose === 'chat') {
                if (autoRunRef.current) {
                  await forwardNextQueuedSource(completedAgent.id)
                }
                return
              }
              const completedAgentStatuses = workflowStatusesForAgent(
                completedAgent,
                workflowStatuses,
              )
              const completedSignal = parseWorkflowSignal(
                completedAgent.lastResult,
                completedAgentStatuses,
              )
              const completedStatusIds = completedSignal.statusIds
              const managementReportedTechnicalFailure =
                completedAgent.assignment === 'management' &&
                completedAgentStatuses.some(
                  (status) =>
                    completedStatusIds.includes(status.id) &&
                    status.name.trim().toLocaleLowerCase('de-DE') ===
                      MANAGEMENT_ERROR_STATUS_NAME.toLocaleLowerCase('de-DE'),
                )
              if (autoRunRef.current && managementReportedTechnicalFailure) {
                sharedStateDirty.current = true
                autoRunRef.current = false
                setAutoRun(false)
                setTransmittingAgentIds([])
                updateDeliveryQueue(() => ({}))
                activeDeliveryTargetIds.current.clear()
                resetInactiveAgentStatuses()
                addEvent(
                  'Automatik gestoppt',
                  `${completedAgent.name} hat einen technischen Fehler gemeldet und benötigt eine Benutzerentscheidung.`,
                )
                return
              }
              if (autoRunRef.current && agent.autoForward) {
                await handoff(completedAgent)
              }
              if (autoRunRef.current) {
                await forwardNextQueuedSource(completedAgent.id)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Connector nicht erreichbar.'
              if (
                message.includes('lokalen Historie nicht gefunden') ||
                message.includes('thread not found')
              ) {
                watchdogInterventionTurnIds.current.delete(agent.pendingTurnId)
                releaseAgentDispatch(activeDeliveryTargetIds.current, agent.id)
                updateAgent(agent.id, {
                  status: autoRunRef.current ? 'rueckfrage' : 'wartet',
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
  }, [addEvent, agents, autoRun, capturePendingContinuation, handoff, persistWorkflowCheckpoint, releaseAutomationLease, resetInactiveAgentStatuses, updateAgent, updateDeliveryQueue, updateWorkflowRuntime, workflowStatuses])

  useEffect(() => {
    if (!autoRun || !automationLeader) return

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

        if (targetAgents.some((agent) =>
          agent.status === 'laeuft' ||
          agent.pendingTurnId ||
          activeDeliveryTargetIds.current.has(agent.id),
        )) return

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
            if (!reserveAgentDispatch(activeDeliveryTargetIds.current, target)) {
              throw new Error(`${target.name} verarbeitet bereits einen anderen Auftrag.`)
            }
            const message = [
              `Zeitgesteuerte Aufgabe: ${timer.name}`,
              '',
              timer.task,
              '',
              'Verbindliche Arbeitsanweisung des Ziel-Agenten:',
              agentPromptInstruction(target),
              '',
              internalProjectGoalInstruction(projectGoalForProject(projectGoals, target.projectPath)),
              '',
              knowledgeSourceInstruction(
                knowledgeSourcesForAgent(knowledgeSources, target.projectPath, target.usesProjectKnowledge),
              ),
              '',
              'Bearbeite diese Aufgabe selbst anhand deines Projektkontexts. Die weitere Übergabe übernimmt ausschließlich der Workflow-Orchestrator.',
              workflowStatusInstruction(workflowStatusesForAgent(target, workflowStatuses)),
            ].join('\n')
            try {
              const response = await fetch(`/api/threads/${encodeURIComponent(target.threadId)}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: message, cwd: target.projectPath, webAccess: target.webAccess }),
              })
              const data = await response.json()
              if (!response.ok) throw new Error(data.error || 'Zeitgesteuerte Aufgabe konnte nicht gesendet werden.')
              const turnId = requireStartedTurnId(data, 'die zeitgesteuerte Aufgabe')
              applyThreadReplacement(target, data.replacementThread)
              updateAgent(target.id, {
                status: 'laeuft',
                runStartedAt: firedAt,
                pendingTurnId: turnId,
                runPurpose: 'timer',
              })
            } catch (error) {
              releaseAgentDispatch(activeDeliveryTargetIds.current, target.id)
              throw error
            }
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
  }, [addEvent, agents, applyThreadReplacement, automationLeader, autoRun, knowledgeSources, projectGoals, routes, selectedProject?.path, updateAgent, workflowStatuses, workflowTimers])

  const startInitialWorkflows = useCallback(async (
    options: { repeatCycle?: number; targetCycles?: number } = {},
  ) => {
    const activeProjectPath = selectedProject?.path ?? ''
    const isRepeatCycle = Number.isFinite(options.repeatCycle) && (options.repeatCycle ?? 1) > 1
    const repeatCycle = Math.max(2, Math.trunc(options.repeatCycle ?? 2))
    const repeatTargetCycles = Math.max(repeatCycle, Math.trunc(options.targetCycles ?? repeatCycle))
    const starts = workflowInitials
      .filter((initial) => samePath(initial.projectPath, activeProjectPath))
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
          return target && owner && target.id === owner.id
            ? [{ initial, target }]
            : []
        }),
    )

    if (deliveries.length === 0) {
      addEvent(
        'Automatik nicht gestartet',
        'In diesem Projekt ist kein Initial-Baustein direkt mit seinem Dashboard-Agenten verbunden.',
      )
      return { sentCount: 0, busyCount: 0 }
    }

    let sentCount = 0
    let busyCount = 0
    await Promise.all(
      deliveries.map(async ({ initial, target }) => {
        if (!target.threadId) {
          addEvent(
            isRepeatCycle ? 'Folgelauf nicht gesendet' : 'Initial-Anfrage nicht gesendet',
            `${target.name} ist mit keinem Codex-Chat verknüpft.`,
          )
          return
        }
        if (!reserveAgentDispatch(activeDeliveryTargetIds.current, target)) {
          busyCount += 1
          addEvent(
            isRepeatCycle ? 'Folgelauf nicht gesendet' : 'Initial-Anfrage nicht gesendet',
            `${target.name} verarbeitet bereits einen anderen Auftrag.`,
          )
          return
        }

        const initialLeadInstructions = isRepeatCycle
          ? [
              'Folgelauf:',
              `Starte Lauf ${repeatCycle}/${repeatTargetCycles}.`,
              'Sende die Initialanweisung und den Starttext des Benutzers nicht erneut. Nutze den bestehenden Chat- und Projektstand als Kontext.',
            ]
          : [
              'Initial-Ablaufanweisung:',
              'Prüfe die jüngste Benutzeranweisung in diesem Chat und den bestehenden Projektstand.',
              'Der Initialbaustein darf ausschließlich Ablaufanweisungen enthalten. Fachliche Aufgaben, Projektziele oder Prompt-Inhalte im Initialbaustein sind ungültig und dürfen nicht als Auftrag ausgeführt werden.',
              ...(initial.instructionSource === 'user' && initial.instruction.trim()
                ? ['', 'Optionale Initialanweisung des Benutzers:', initial.instruction.trim()]
                : []),
            ]
        const internalInitialInstructions = [
          ...initialLeadInstructions,
          '',
          'Verbindliche Arbeitsanweisung des Ziel-Agenten:',
          agentPromptInstruction(target),
          target.assignment === 'management'
            ? managementRulebook('automation', target.managementInstructionRules)
            : '',
          '',
          projectGoalInstruction(projectGoalForProject(projectGoals, target.projectPath)),
          '',
          knowledgeSourceInstruction(
            knowledgeSourcesForAgent(knowledgeSources, target.projectPath, target.usesProjectKnowledge),
          ),
          '',
          target.assignment === 'management'
            ? isRepeatCycle
              ? 'Bearbeite dieses Folgelauf-Signal ausschließlich als Teamleiter. Formuliere die Delegationsentscheidung und den vollständigen Arbeitsauftrag für den gewählten Fachagenten.'
              : 'Bearbeite dieses Startsignal ausschließlich als Teamleiter. Formuliere die Delegationsentscheidung und den vollständigen Arbeitsauftrag für den gewählten Fachagenten.'
            : isRepeatCycle
              ? 'Bearbeite dieses Folgelauf-Signal gemäß deiner Rollen-Anweisung und dem bestehenden Projektstand.'
              : 'Bearbeite dieses Startsignal gemäß deiner Rollen-Anweisung und der jüngsten Benutzeranweisung in deinem Chat.',
          'Kontaktiere keine anderen Codex-Chats; die Weitergabe übernimmt ausschließlich der Workflow-Orchestrator.',
          workflowStatusInstruction(workflowStatusesForAgent(target, workflowStatuses)),
        ].join('\n')
        const message = withInternalInstructions(isRepeatCycle ? 'Folgelauf' : 'Start', internalInitialInstructions)

        try {
          const response = await fetch(
            `/api/threads/${encodeURIComponent(target.threadId)}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: message, cwd: target.projectPath, webAccess: target.webAccess }),
            },
          )
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || (isRepeatCycle
              ? 'Folgelauf konnte nicht gesendet werden.'
              : 'Initial-Anfrage konnte nicht gesendet werden.'))
          }
          const turnId = requireStartedTurnId(data, isRepeatCycle ? 'den Folgelauf' : 'die Initial-Anfrage')
          applyThreadReplacement(target, data.replacementThread)
          updateAgent(target.id, {
            status: 'laeuft',
            runStartedAt: new Date().toISOString(),
            pendingTurnId: turnId,
            runPurpose: 'initial',
          })
          sentCount += 1
          addEvent(
            isRepeatCycle ? 'Folgelauf gesendet' : 'Initial-Anfrage gesendet',
            `${initial.name} → ${target.name}`,
          )
        } catch (error) {
          releaseAgentDispatch(activeDeliveryTargetIds.current, target.id)
          addEvent(
            isRepeatCycle ? 'Folgelauf nicht gesendet' : 'Initial-Anfrage nicht gesendet',
            `${target.name}: ${error instanceof Error ? error.message : 'Connector nicht erreichbar.'}`,
          )
        }
      }),
    )
    return { sentCount, busyCount }
  }, [addEvent, agents, applyThreadReplacement, knowledgeSources, projectGoals, routes, selectedProject?.path, updateAgent, workflowInitials, workflowStatuses])
  startInitialWorkflowsRef.current = startInitialWorkflows

  const resetSelectedWorkflowRun = async () => {
    const activeProjectPath = selectedProject?.path ?? ''
    if (!activeProjectPath || workflowResetting) return
    const confirmed = window.confirm(tx(
      'Arbeitslauf wirklich zurücksetzen? Offene Agenten-Aufträge und vorgemerkte Fortsetzungen werden verworfen. Team, Dashboard, Statusmeldungen, Projektziel und Datenbank bleiben erhalten.',
      'Reset this workflow run? Open agent tasks and saved continuations will be discarded. The team, dashboard, statuses, project goal, and database remain unchanged.',
    ))
    if (!confirmed) return

    setWorkflowResetting(true)
    sharedStateDirty.current = true
    autoRunRef.current = false
    setAutoRun(false)
    releaseAutomationLease()

    const projectAgents = agentsRef.current.filter((agent) =>
      samePath(agent.projectPath, activeProjectPath),
    )
    const projectAgentIds = new Set(projectAgents.map((agent) => agent.id))

    try {
      await Promise.allSettled(projectAgents
        .filter((agent) => agent.threadId && agent.pendingTurnId)
        .map((agent) => fetch(
          `/api/threads/${encodeURIComponent(agent.threadId)}/interrupt`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnId: agent.pendingTurnId }),
          },
        )))

      setAgents((current) => current.map((agent) =>
        projectAgentIds.has(agent.id)
          ? {
              ...agent,
              status: 'wartet',
              pendingTurnId: '',
              pendingUserConfirmation: null,
              runStartedAt: '',
              runPurpose: '',
              lastInboundAgentId: '',
              consecutiveFailedRuns: 0,
              updatedAt: new Date().toISOString(),
            }
          : agent,
      ))
      setTransmittingAgentIds((current) => current.filter((id) => !projectAgentIds.has(id)))
      updateDeliveryQueue((current) => {
        let next = current
        projectAgentIds.forEach((agentId) => {
          next = removeDeliveryAgent(next, agentId)
        })
        return next
      })
      projectAgentIds.forEach((agentId) => {
        activeDeliveryTargetIds.current.delete(agentId)
        turnActivityObservations.current.delete(agentId)
      })
      setRoutes((current) => current.map((route) =>
        samePath(route.projectPath, activeProjectPath)
          ? { ...route, lastForwardedTask: undefined }
          : route,
      ))
      setWorkflowPrompts((current) => current.map((prompt) =>
        samePath(prompt.projectPath, activeProjectPath)
          ? { ...prompt, intervalCount: 0 }
          : prompt,
      ))
      setWorkflowStatusFilters((current) => current.map((filter) =>
        samePath(filter.projectPath, activeProjectPath)
          ? { ...filter, intervalCount: 0 }
          : filter,
      ))
      updateWorkflowRuntime((current) =>
        resetProjectWorkflowRuntime(current, activeProjectPath),
      )
      setStallNotice(null)
      addEvent(
        'Arbeitslauf zurückgesetzt',
        `${selectedProject?.label ?? activeProjectPath}: Offene Aufträge und Fortsetzungen wurden verworfen.`,
      )
    } finally {
      setWorkflowResetting(false)
    }
  }

  const toggleAutomation = () => {
    if (autoRun) {
      sharedStateDirty.current = true
      autoRunRef.current = false
      setAutoRun(false)
      setTransmittingAgentIds([])
      updateDeliveryQueue(() => ({}))
      resetInactiveAgentStatuses()
      releaseAutomationLease()
      addEvent('Automatik gestoppt', 'Weitere fertige Ergebnisse werden nicht automatisch weitergegeben.')
      return
    }
    const activeProjectPath = selectedProject?.path ?? ''
    const activeProjectAgents = agents.filter((agent) => samePath(agent.projectPath, activeProjectPath))
    const activeAgentIds = new Set(
      activeProjectAgents
        .filter((agent) =>
          agent.assignment === 'management' ||
          Boolean(workflowBoardAgentIds[agent.id]) ||
          routes.some((route) => route.ownerAgentId === agent.id),
        )
        .map((agent) => agent.id),
    )
    const topologyIssues = auditWorkflowTopology({
      agents: activeProjectAgents,
      activeAgentIds,
      statuses: [
        unconditionalForwardStatus(activeProjectPath),
        ...workflowStatuses.filter((status) =>
          status.id !== UNCONDITIONAL_FORWARD_STATUS_ID &&
          samePath(status.projectPath, activeProjectPath),
        ),
      ],
      filters: workflowStatusFilters.filter((filter) => samePath(filter.projectPath, activeProjectPath)),
      routes: routes.filter((route) => samePath(route.projectPath, activeProjectPath)),
      forwardingNodes: [
        ...workflowPrompts.filter((prompt) => samePath(prompt.projectPath, activeProjectPath)),
        ...workflowStatusFilters.filter((filter) => samePath(filter.projectPath, activeProjectPath)),
      ],
      loopNodes: workflowLoops.filter((loop) => samePath(loop.projectPath, activeProjectPath)),
      terminals: [
        ...workflowStops,
        ...workflowInitials,
        ...workflowPrompts,
        ...workflowTimers,
      ].filter((node) => samePath(node.projectPath, activeProjectPath)),
    })
    if (topologyIssues.length > 0) {
      addEvent(
        'Workflow-Konfiguration unvollständig',
        topologyIssues.map((issue) => issue.detail).join(' '),
      )
      return
    }
    if (!claimAutomationLease()) {
      addEvent('Automatik bereits aktiv', 'Ein anderes geöffnetes Fenster steuert diesen Workflow bereits.')
      return
    }
    const latestManualManager = agents
      .filter((agent) =>
        agent.assignment === 'management' &&
        samePath(agent.projectPath, activeProjectPath) &&
        (agent.runPurpose === 'chat' || agent.runPurpose === 'chat-forward') &&
        Boolean(agent.lastCompletedTurnId) &&
        manualInstructionSupersedesCheckpoints(agent.lastInstruction),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    const resumeRuntime = latestManualManager
      ? removeProjectCheckpointsSupersededAt(
          workflowRuntimeRef.current,
          activeProjectPath,
          latestManualManager.updatedAt,
        )
      : workflowRuntimeRef.current
    if (resumeRuntime !== workflowRuntimeRef.current) {
      const removedCount = workflowRuntimeRef.current.checkpoints.length - resumeRuntime.checkpoints.length
      updateWorkflowRuntime(() => resumeRuntime)
      addEvent(
        'Alte Wiederaufnahme verworfen',
        `${latestManualManager?.name ?? 'CEO'}: ${removedCount} ältere Kontrollpunkte wurden durch die neuere manuelle Entscheidung ersetzt.`,
      )
    }
    const pendingCheckpoint = resumableWorkflowCheckpoint(
      resumeRuntime,
      activeProjectPath,
    )
    const blockedCheckpoint = resumeRuntime.checkpoints.find(
      (checkpoint) =>
        samePath(checkpoint.projectPath, activeProjectPath) &&
        checkpoint.state === 'blocked',
    )
    if (!pendingCheckpoint && blockedCheckpoint) {
      releaseAutomationLease()
      addEvent(
        'Wiederaufnahme blockiert',
        `${blockedCheckpoint.sourceAgentName}: ${blockedCheckpoint.reason || 'Der letzte Schritt besitzt keinen gültigen Fortsetzungsweg.'}`,
      )
      return
    }
    sharedStateDirty.current = true
    setTransmittingAgentIds([])
    updateDeliveryQueue(() => ({}))
    activeDeliveryTargetIds.current.clear()
    resetInactiveAgentStatuses()
    autoRunRef.current = true
    setAutoRun(true)
    if (pendingCheckpoint) {
      const source = agents.find((agent) => agent.id === pendingCheckpoint.sourceAgentId)
      const targetsAvailable = pendingCheckpoint.targetAgentIds.every(
        (targetId) => agents.some((agent) => agent.id === targetId),
      )
      if (!source || !targetsAvailable) {
        autoRunRef.current = false
        setAutoRun(false)
        releaseAutomationLease()
        updateWorkflowRuntime((current) => saveWorkflowCheckpoint(current, {
          ...pendingCheckpoint,
          state: 'blocked',
          reason: 'Quell- oder Zielagent des gespeicherten Kontrollpunkts ist nicht mehr vorhanden.',
          updatedAt: new Date().toISOString(),
        }))
        addEvent(
          'Wiederaufnahme blockiert',
          'Quell- oder Zielagent des gespeicherten Kontrollpunkts ist nicht mehr vorhanden.',
        )
        return
      }
      updateWorkflowRuntime((current) => {
        const now = new Date().toISOString()
        const started = beginWorkflowRun(current, activeProjectPath, now, crypto.randomUUID(), {
          cycle: 1,
          targetCycles: selectedLoopCount,
        })
        return appendWorkflowRunEntry(
          started.runtime,
          activeProjectPath,
          workflowRunEntry('resumed', {
            agentId: source.id,
            agentName: source.name,
            targetAgentIds: pendingCheckpoint.targetAgentIds,
            targetAgentNames: pendingCheckpoint.targetAgentNames,
            statusIds: pendingCheckpoint.statusIds,
            statusNames: pendingCheckpoint.statusNames,
            detail: `Fortsetzung: ${source.name} -> ${pendingCheckpoint.targetAgentNames.join(', ')} · Lauf 1/${selectedLoopCount}`,
          }, now),
        )
      })
      addEvent(
        'Workflow wiederaufgenommen',
        `${source.name} -> ${pendingCheckpoint.targetAgentNames.join(', ')} (${pendingCheckpoint.statusNames.join(', ')})`,
      )
      void handoff({
        ...source,
        lastResult: pendingCheckpoint.result,
        lastCompletedTurnId: pendingCheckpoint.sourceTurnId,
      }, { replayCheckpoint: true })
      return
    }

    setRoutes((current) => current.map((route) =>
      samePath(route.projectPath, activeProjectPath)
        ? { ...route, lastForwardedTask: undefined }
        : route,
    ))
    updateWorkflowRuntime((current) => {
      const now = new Date().toISOString()
      const started = beginWorkflowRun(current, activeProjectPath, now, crypto.randomUUID(), {
        cycle: 1,
        targetCycles: selectedLoopCount,
      })
      return appendWorkflowRunEntry(
        started.runtime,
        activeProjectPath,
        workflowRunEntry('started', { detail: `Start -> CEO · Lauf 1/${selectedLoopCount}` }, now),
      )
    })
    addEvent(
      'Automatik gestartet',
      `${selectedLoopCount} ${selectedLoopCount === 1 ? 'Lauf wurde' : 'Läufe wurden'} geplant. Initial-Anfragen und automatische Weitergaben sind aktiviert.`,
    )
    void startInitialWorkflows()
      .then(({ sentCount, busyCount }) => {
        if (sentCount > 0 || busyCount > 0) {
          if (busyCount > 0 && sentCount === 0) {
            addEvent(
              'Automatik läuft bereits',
              'Der verbundene Agent arbeitet bereits. Neue Initialaufträge werden nicht doppelt gestartet; fertige Ergebnisse werden weiter verarbeitet.',
            )
          }
          return
        }
        autoRunRef.current = false
        setAutoRun(false)
        releaseAutomationLease()
        addEvent(
          'Automatik beendet',
          'Der Start wurde nicht ausgeführt, weil keine Initial-Anfrage angenommen wurde. Prüfe Initial-Baustein, Verbindung und Codex-Chat.',
        )
      })
      .catch((error) => {
        autoRunRef.current = false
        setAutoRun(false)
        releaseAutomationLease()
        addEvent(
          'Automatik beendet',
          `Die Initial-Anfrage konnte nicht gestartet werden: ${error instanceof Error ? error.message : 'Unbekannter Startfehler.'}`,
        )
      })
  }

  const applyThemePreset = (theme: ThemeMode) => {
    const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
    setProgramSettings((current) => ({
      ...current,
      theme,
      accentColor: resolved === 'light' ? '#475569' : defaultProgramSettings.accentColor,
      backgroundColor: resolved === 'light' ? '#f7f7f8' : defaultProgramSettings.backgroundColor,
      foregroundColor: resolved === 'light' ? '#18181b' : defaultProgramSettings.foregroundColor,
      buttonColor: resolved === 'light' ? '#e4e4e7' : defaultProgramSettings.buttonColor,
      buttonTextColor: resolved === 'light' ? '#18181b' : defaultProgramSettings.buttonTextColor,
      topbarColor: resolved === 'light' ? '#ffffff' : defaultProgramSettings.topbarColor,
      projectBarColor: resolved === 'light' ? '#ffffff' : defaultProgramSettings.projectBarColor,
      agentRailColor: resolved === 'light' ? '#ffffff' : defaultProgramSettings.agentRailColor,
      workspaceColor: resolved === 'light' ? '#ffffff' : defaultProgramSettings.workspaceColor,
      eventLogColor: resolved === 'light' ? '#ffffff' : defaultProgramSettings.eventLogColor,
    }))
  }

  const updateProgramColor = (
    key: 'accentColor' | 'backgroundColor' | 'foregroundColor' | 'buttonColor' | 'buttonTextColor' |
      'topbarColor' | 'projectBarColor' | 'agentRailColor' | 'workspaceColor' | 'eventLogColor',
    value: string,
  ) => {
    if (isHexColor(value)) {
      setProgramSettings((current) => ({ ...current, [key]: value.toLowerCase() }))
    }
  }

  const settingsNavigation = [
    { id: 'general' as const, label: tx('Allgemein', 'General'), symbol: 'E' },
    { id: 'profile' as const, label: tx('Profil', 'Profile'), symbol: '○' },
    { id: 'appearance' as const, label: tx('Aussehen', 'Appearance'), symbol: '◐' },
  ].filter((item) => item.label.toLocaleLowerCase().includes(settingsSearch.trim().toLocaleLowerCase()))

  if (settingsOpen) {
    return (
      <main className="shell settingsShell" data-theme={effectiveTheme} style={themeVariables}>
        <section className="settingsPage">
          <aside className="settingsNavigation" aria-label={tx('Einstellungsbereiche', 'Settings sections')}>
            <button className="settingsBack" onClick={() => setSettingsOpen(false)} type="button">
              <span aria-hidden="true">←</span>
              {tx('Zurück zur App', 'Back to app')}
            </button>
            <input
              aria-label={tx('Einstellungen durchsuchen', 'Search settings')}
              className="settingsSearch"
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder={tx('Einstellungen durchsuchen…', 'Search settings…')}
              value={settingsSearch}
            />
            <p className="settingsGroupLabel">{tx('Persönlich', 'Personal')}</p>
            <nav className="settingsNavList">
              {settingsNavigation.map((item) => (
                <button
                  className={settingsSection === item.id ? 'active' : ''}
                  key={item.id}
                  onClick={() => setSettingsSection(item.id)}
                  type="button"
                >
                  <span aria-hidden="true">{item.symbol}</span>
                  {item.label}
                </button>
              ))}
            </nav>
            <button
              className="settingsProfileSummary"
              onClick={() => setSettingsSection('profile')}
              type="button"
            >
              <span className="profileAvatar">{profileInitials}</span>
              <span>{profileName}</span>
            </button>
          </aside>

          <section className="settingsContent">
            {settingsSection === 'general' && (
              <div className="settingsPanel">
                <header className="settingsTitle">
                  <p className="eyebrow">{tx('Programmeinstellungen', 'Application settings')}</p>
                  <h1>{tx('Allgemein', 'General')}</h1>
                </header>
                <section className="settingsRows">
                  <div className="settingsRow">
                    <div>
                      <strong>{tx('Sprache', 'Language')}</strong>
                      <small>{tx('Sprache der gesamten Oberfläche.', 'Language used throughout the interface.')}</small>
                    </div>
                    <div className="settingsSegmented" aria-label={tx('Sprache auswählen', 'Select language')}>
                      <button className={language === 'de' ? 'active' : ''} onClick={() => setLanguage('de')} type="button">DE</button>
                      <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} type="button">EN</button>
                    </div>
                  </div>
                  <div className="settingsRow">
                    <div>
                      <strong>{tx('Codex-Konto', 'Codex account')}</strong>
                      <small>{tx('Der Profilname wird vom verbundenen Konto vorgeschlagen.', 'The profile name is suggested by the connected account.')}</small>
                    </div>
                    <span className={`settingsConnection ${connectorOnline ? 'online' : ''}`}>
                      <span className="stateDot" aria-hidden="true" />
                      {connectorOnline ? tx('Verbunden', 'Connected') : tx('Offline', 'Offline')}
                    </span>
                  </div>
                  <div className="settingsRow">
                    <div>
                      <strong>{tx('Workflow-Steuerzeilen', 'Workflow control lines')}</strong>
                      <small>{tx(
                        'Zeigt Statusbefehle in Chatnachrichten an. Die Workflow-Auswertung bleibt immer aktiv.',
                        'Shows status commands in chat messages. Workflow evaluation always remains active.',
                      )}</small>
                    </div>
                    <label className="checkbox settingsCheckbox">
                      <input
                        checked={programSettings.showWorkflowStatusLines}
                        onChange={(event) => setProgramSettings((current) => ({
                          ...current,
                          showWorkflowStatusLines: event.target.checked,
                        }))}
                        type="checkbox"
                      />
                      {programSettings.showWorkflowStatusLines
                        ? tx('Anzeigen', 'Show')
                        : tx('Ausblenden', 'Hide')}
                    </label>
                  </div>
                </section>
              </div>
            )}

            {settingsSection === 'profile' && (
              <div className="settingsPanel">
                <header className="settingsTitle">
                  <p className="eyebrow">{tx('Programmeinstellungen', 'Application settings')}</p>
                  <h1>{tx('Profil', 'Profile')}</h1>
                </header>
                <section className="profileSettingsCard">
                  <span className="profileAvatar large">{profileInitials}</span>
                  <label>
                    {tx('Anzeigename', 'Display name')}
                    <input
                      onChange={(event) => setProgramSettings((current) => ({ ...current, displayName: event.target.value }))}
                      placeholder={accountSuggestedName || 'Codex'}
                      value={programSettings.displayName}
                    />
                  </label>
                  <small>
                    {programSettings.displayName.trim()
                      ? tx('Global gespeicherter Name.', 'Globally stored name.')
                      : tx('Automatischer Vorschlag aus dem verbundenen Codex-Konto.', 'Automatic suggestion from the connected Codex account.')}
                  </small>
                </section>
              </div>
            )}

            {settingsSection === 'appearance' && (
              <div className="settingsPanel appearanceSettings">
                <header className="settingsTitle">
                  <p className="eyebrow">{tx('Programmeinstellungen', 'Application settings')}</p>
                  <h1>{tx('Aussehen', 'Appearance')}</h1>
                </header>
                <section>
                  <h2>{tx('Design', 'Design')}</h2>
                  <div className="themeChoices">
                    {(['system', 'light', 'dark'] as ThemeMode[]).map((theme) => (
                      <button
                        aria-pressed={programSettings.theme === theme}
                        className={programSettings.theme === theme ? 'active' : ''}
                        key={theme}
                        onClick={() => applyThemePreset(theme)}
                        type="button"
                      >
                        <span className={`themePreview ${theme}`} aria-hidden="true">
                          <span className="themePreviewSidebar" />
                          <span className="themePreviewMain"><i /><i /><i /></span>
                        </span>
                        <span>{theme === 'system' ? 'System' : theme === 'light' ? tx('Hell', 'Light') : tx('Dunkel', 'Dark')}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="appearanceControls">
                  <div className="appearanceControlHeader">
                    <h2>{effectiveTheme === 'dark' ? tx('Dunkles Design', 'Dark design') : tx('Helles Design', 'Light design')}</h2>
                    <button
                      className="compact"
                      onClick={() => setProgramSettings((current) => ({
                        ...defaultProgramSettings,
                        displayName: current.displayName,
                        theme: current.theme,
                        accentColor: effectiveTheme === 'light' ? '#475569' : defaultProgramSettings.accentColor,
                        backgroundColor: effectiveTheme === 'light' ? '#f7f7f8' : defaultProgramSettings.backgroundColor,
                        foregroundColor: effectiveTheme === 'light' ? '#18181b' : defaultProgramSettings.foregroundColor,
                        buttonColor: effectiveTheme === 'light' ? '#e4e4e7' : defaultProgramSettings.buttonColor,
                        buttonTextColor: effectiveTheme === 'light' ? '#18181b' : defaultProgramSettings.buttonTextColor,
                        topbarColor: effectiveTheme === 'light' ? '#ffffff' : defaultProgramSettings.topbarColor,
                        projectBarColor: effectiveTheme === 'light' ? '#ffffff' : defaultProgramSettings.projectBarColor,
                        agentRailColor: effectiveTheme === 'light' ? '#ffffff' : defaultProgramSettings.agentRailColor,
                        workspaceColor: effectiveTheme === 'light' ? '#ffffff' : defaultProgramSettings.workspaceColor,
                        eventLogColor: effectiveTheme === 'light' ? '#ffffff' : defaultProgramSettings.eventLogColor,
                      }))}
                      type="button"
                    >
                      {tx('Zurücksetzen', 'Reset')}
                    </button>
                  </div>
                  {([
                    ['topbarColor', tx('Kopfleiste', 'Top bar')],
                    ['projectBarColor', tx('Projekt und Tasks', 'Project and tasks')],
                    ['agentRailColor', tx('Agentenbereich', 'Agent area')],
                    ['workspaceColor', tx('Arbeitsbereich', 'Workspace')],
                    ['eventLogColor', tx('Ablaufprotokoll', 'Activity log')],
                    ['accentColor', tx('Akzent', 'Accent')],
                    ['backgroundColor', tx('Hintergrund', 'Background')],
                    ['foregroundColor', tx('Vordergrund', 'Foreground')],
                    ['buttonColor', tx('Schaltflächen', 'Buttons')],
                    ['buttonTextColor', tx('Schaltflächentext', 'Button text')],
                  ] as const).map(([key, label]) => (
                    <label className="colorSetting" key={key}>
                      <span>{label}</span>
                      <span className="colorValue">
                        <input
                          aria-label={label}
                          onChange={(event) => updateProgramColor(key, event.target.value)}
                          type="color"
                          value={programSettings[key]}
                        />
                        <code>{programSettings[key].toUpperCase()}</code>
                      </span>
                    </label>
                  ))}
                  <label className="appearanceSelect">
                    <span>{tx('UI-Schriftart', 'UI font')}</span>
                    <select
                      onChange={(event) => setProgramSettings((current) => ({ ...current, uiFont: event.target.value }))}
                      value={programSettings.uiFont}
                    >
                      <option value="Segoe UI Variable Text">Segoe UI</option>
                      <option value="Inter">Inter</option>
                      <option value="system-ui">System</option>
                    </select>
                  </label>
                  <label className="appearanceSelect">
                    <span>{tx('Code-Schriftart', 'Code font')}</span>
                    <select
                      onChange={(event) => setProgramSettings((current) => ({ ...current, codeFont: event.target.value }))}
                      value={programSettings.codeFont}
                    >
                      <option value="Cascadia Code">Cascadia Code</option>
                      <option value="Consolas">Consolas</option>
                      <option value="ui-monospace">System Mono</option>
                    </select>
                  </label>
                  <label className="contrastSetting">
                    <span>{tx('Kontrast', 'Contrast')}</span>
                    <input
                      max="100"
                      min="0"
                      onChange={(event) => setProgramSettings((current) => ({ ...current, contrast: Number(event.target.value) }))}
                      type="range"
                      value={programSettings.contrast}
                    />
                    <output>{programSettings.contrast}</output>
                  </label>
                </section>
              </div>
            )}
          </section>
        </section>
      </main>
    )
  }

  return (
    <main className="shell" data-theme={effectiveTheme} style={themeVariables}>
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
          <label
            className="workflowLoopControl"
            title={tx(
              'Anzahl vollständiger Workflow-Läufe pro Auto Start',
              'Number of complete workflow runs per Auto Start',
            )}
          >
            <span>{tx('Läufe', 'Runs')}</span>
            <input
              aria-label={tx('Anzahl der Workflow-Läufe', 'Number of workflow runs')}
              disabled={autoRun || !selectedProject}
              max={MAX_WORKFLOW_LOOPS}
              min={MIN_WORKFLOW_LOOPS}
              ref={workflowLoopInputRef}
              step="1"
              type="number"
              value={workflowLoopCountEditing ? workflowLoopCountDraft : String(selectedLoopCount)}
              onBlur={() => {
                const normalized = persistSelectedLoopCount(workflowLoopCountDraft)
                setWorkflowLoopCountDraft(String(normalized))
                setWorkflowLoopCountEditing(false)
              }}
              onChange={(event) => {
                handleSelectedLoopCountInput(event.currentTarget.value)
              }}
              onInput={(event) => {
                handleSelectedLoopCountInput(event.currentTarget.value)
              }}
              onKeyUp={(event) => {
                handleSelectedLoopCountInput(event.currentTarget.value)
              }}
              onMouseUp={(event) => {
                handleSelectedLoopCountInput(event.currentTarget.value)
              }}
              onFocus={() => {
                setWorkflowLoopCountDraft(String(selectedLoopCount))
                setWorkflowLoopCountEditing(true)
              }}
            />
            <small>
              {autoRun && selectedLoopProgress
                ? `${selectedLoopProgress.cycle}/${selectedLoopProgress.targetCycles}`
                : `1/${selectedLoopCount}`}
            </small>
          </label>
          <button className={autoRun ? 'danger' : ''} onClick={toggleAutomation}>
            {autoRun ? copy.stop : copy.start}
          </button>
        </div>
      </section>

      {pendingUserConfirmationAgent?.pendingUserConfirmation && (
        <div className="modalBackdrop" role="presentation">
          <section
            aria-labelledby="user-confirmation-title"
            aria-modal="true"
            className="promptModal userConfirmationModal"
            role="alertdialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">
                  {pendingUserConfirmationAgent.pendingUserConfirmation.kind === 'question'
                    ? tx('NACHRICHT AN DICH', 'MESSAGE FOR YOU')
                    : tx('BENUTZERBESTÄTIGUNG', 'USER CONFIRMATION')}
                </p>
                <h2 id="user-confirmation-title">
                  {pendingUserConfirmationAgent.pendingUserConfirmation.kind === 'question'
                    ? tx('Der Agent hat eine Frage', 'The agent has a question')
                    : tx('Bestätigung erforderlich', 'Confirmation required')}
                </h2>
              </div>
            </div>
            <p className="modalHint">{pendingUserConfirmationAgent.name}</p>
            <p className="userConfirmationReason">
              {pendingUserConfirmationAgent.pendingUserConfirmation.reason}
            </p>
            {pendingUserConfirmationAgent.pendingUserConfirmation.kind === 'question' ? (
              <label className="userQuestionEditor">
                <span>{tx('Deine Antwort', 'Your answer')}</span>
                <textarea
                  autoFocus
                  onChange={(event) => setUserQuestionAnswer(event.target.value)}
                  placeholder={tx('Antwort an den Agenten eingeben', 'Enter your answer to the agent')}
                  rows={4}
                  value={userQuestionAnswer}
                />
              </label>
            ) : (
              <pre>{pendingUserConfirmationAgent.pendingUserConfirmation.confirmationText}</pre>
            )}
            <p className="modalHint">
                {tx(
                'Die Automatik pausiert. Ohne deine Antwort wird dieser Workflow-Pfad nicht fortgesetzt.',
                'Automation is paused. This workflow path will not continue without your answer.',
              )}
            </p>
            {userConfirmationError && <p className="modalError" role="alert">{userConfirmationError}</p>}
            <div className="modalActions">
              <button
                disabled={Boolean(userConfirmationResolvingAgentId)}
                onClick={() => dismissUserConfirmation(pendingUserConfirmationAgent)}
                type="button"
              >
                {tx('Abbrechen', 'Cancel')}
              </button>
              <button
                className="primary"
                disabled={
                  Boolean(userConfirmationResolvingAgentId) ||
                  (pendingUserConfirmationAgent.pendingUserConfirmation.kind === 'question' && !userQuestionAnswer.trim())
                }
                onClick={() => void resolveUserConfirmation(pendingUserConfirmationAgent, userQuestionAnswer)}
                type="button"
              >
                {userConfirmationResolvingAgentId
                  ? tx('Wird übermittelt…', 'Submitting…')
                  : pendingUserConfirmationAgent.pendingUserConfirmation.kind === 'question'
                    ? tx('Antwort senden und fortsetzen', 'Send answer and continue')
                    : tx('Bestätigen und fortsetzen', 'Confirm and continue')}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingApprovals[0] && (
        <div className="modalBackdrop" role="presentation">
          <section
            aria-labelledby="web-approval-title"
            aria-modal="true"
            className="promptModal webApprovalModal"
            role="alertdialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('WEBZUGRIFF', 'WEB ACCESS')}</p>
                <h2 id="web-approval-title">{tx('Freigabe erforderlich', 'Approval required')}</h2>
              </div>
            </div>
            <p className="modalHint">
              {agents.find((agent) => agent.threadId === pendingApprovals[0].threadId)?.name
                ?? tx('Unbekannter Agent', 'Unknown agent')}
            </p>
            <p className="webApprovalReason">
              {pendingApprovals[0].reason || tx(
                'Der Agent benötigt eine einmalige Freigabe für diesen Arbeitsschritt.',
                'The agent needs one-time approval for this work step.',
              )}
            </p>
            {pendingApprovals[0].command && <pre>{pendingApprovals[0].command}</pre>}
            {approvalError && <p className="modalError" role="alert">{approvalError}</p>}
            <div className="modalActions">
              <button
                disabled={Boolean(approvalResolvingId)}
                onClick={() => void resolvePendingApproval(pendingApprovals[0], false)}
                type="button"
              >
                {tx('Ablehnen', 'Decline')}
              </button>
              <button
                className="primary"
                disabled={Boolean(approvalResolvingId)}
                onClick={() => void resolvePendingApproval(pendingApprovals[0], true)}
                type="button"
              >
                {approvalResolvingId
                  ? tx('Wird übermittelt…', 'Submitting…')
                  : tx('Einmal erlauben', 'Allow once')}
              </button>
            </div>
          </section>
        </div>
      )}

      {stallNotice && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setStallNotice(null)}>
          <section
            aria-labelledby="stall-notice-title"
            aria-modal="true"
            className="promptModal stallNoticeModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('SYSTEMÜBERWACHUNG', 'SYSTEM MONITORING')}</p>
                <h2 id="stall-notice-title">
                  {tx('Lauf dauert länger', 'Run is taking longer')}
                </h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                onClick={() => setStallNotice(null)}
              >×</button>
            </div>
            <p className="stallNoticeText">
              {tx(
                `Der Lauf von „${stallNotice.agentName}“ zeigt seit längerer Zeit keine neue Aktivität. Er läuft weiter und wurde nicht abgebrochen.`,
                `The run for “${stallNotice.agentName}” has not shown new activity for a while. It is still running and was not interrupted.`,
              )}
            </p>
            <p className="modalHint">
              {tx(
                'Wenn der Lauf wirklich festhängt, brich ihn manuell zurück. Sonst kannst du dieses Fenster schließen und weiterlaufen lassen.',
                'If the run is really stuck, reset it manually. Otherwise, close this window and let it continue.',
              )}
            </p>
            <div className="modalActions">
              <button onClick={() => setStallNotice(null)}>{tx('Schließen', 'Close')}</button>
            </div>
          </section>
        </div>
      )}

      {workflowStopNotice && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setWorkflowStopNotice(null)}>
          <section
            aria-labelledby="workflow-stop-title"
            aria-modal="true"
            className="promptModal workflowCompletionModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('WORKFLOW BEENDET', 'WORKFLOW COMPLETED')}</p>
                <h2 id="workflow-stop-title">{tx('Lauf am Stop beendet', 'Run ended at stop')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                onClick={() => setWorkflowStopNotice(null)}
              >×</button>
            </div>
            <p className="modalHint">{workflowStopNotice.projectName}</p>
            <div className="workflowCompletionStats">
              <div>
                <span>{tx('Läufe', 'Runs')}</span>
                <strong>{workflowStopNotice.cycle}/{workflowStopNotice.targetCycles}</strong>
              </div>
              <div>
                <span>{tx('Gesamtdauer', 'Total duration')}</span>
                <strong>{formatDuration(workflowStopNotice.durationMs, language)}</strong>
              </div>
              <div>
                <span>{tx('Agent', 'Agent')}</span>
                <strong>{workflowStopNotice.sourceAgentName}</strong>
              </div>
              <div>
                <span>{tx('Stop', 'Stop')}</span>
                <strong>{workflowStopNotice.stopNames.join(', ')}</strong>
              </div>
            </div>
            <div className="workflowCompletionDiagnosis">
              <strong>{tx('Diagnose', 'Diagnosis')}</strong>
              <p>{tx(
                'Der sichtbare Stop-Baustein wurde erreicht. Der Workflow wurde beendet und es werden keine weiteren Übergaben gestartet.',
                'The visible stop node was reached. The workflow was completed and no further handoffs will be started.',
              )}</p>
            </div>
            <div className="modalActions">
              <button className="primary" onClick={() => setWorkflowStopNotice(null)}>OK</button>
            </div>
          </section>
        </div>
      )}

      {teamReadyNotice && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setTeamReadyNotice(null)}>
          <section
            aria-labelledby="team-ready-title"
            aria-modal="true"
            className="promptModal teamReadyModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Team-Einrichtung', 'Team setup')}</p>
                <h2 id="team-ready-title">{tx('Projekt ist startbereit', 'Project is ready to start')}</h2>
              </div>
              <button aria-label={tx('Fenster schließen', 'Close window')} onClick={() => setTeamReadyNotice(null)}>×</button>
            </div>
            <p className="modalHint">
              {tx(
                `„${teamReadyNotice.project}“ wurde mit ${teamReadyNotice.agents} Agenten, ${teamReadyNotice.statuses} ${teamReadyNotice.statuses === 1 ? 'Statusbefehl' : 'Statusbefehlen'}, ${teamReadyNotice.connections} Arbeitsverbindungen und ${teamReadyNotice.stops} ${teamReadyNotice.stops === 1 ? 'Abschlussweg' : 'Abschlusswegen'} eingerichtet.`,
                `“${teamReadyNotice.project}” was configured with ${teamReadyNotice.agents} agents, ${teamReadyNotice.statuses} status ${teamReadyNotice.statuses === 1 ? 'command' : 'commands'}, ${teamReadyNotice.connections} workflow connections, and ${teamReadyNotice.stops} completion ${teamReadyNotice.stops === 1 ? 'path' : 'paths'}.`,
              )}
            </p>
            <p className="teamReadyNoticeText">
              {tx(
                'Prompts und Rollen sind vergeben. Ein neutraler Initial-Baustein signalisiert dem CEO den Start; der CEO leitet anschließend über einen Status-Filter weiter. Ein Abschlussstatus beendet die Automatik an einem Stopp-Baustein. Die Automatik ist weiterhin aus.',
                'Prompts and roles are assigned. A neutral initial node signals the start to the CEO, who then routes the work through a status filter. A completion status stops automation at a stop node. Automation remains off.',
              )}
            </p>
            <div className="modalActions">
              <button className="primary" onClick={() => setTeamReadyNotice(null)}>{tx('Verstanden', 'Got it')}</button>
            </div>
          </section>
        </div>
      )}

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
              {tx(
                'Verknüpft einen vorhandenen Codex-Chat über seine Chat-ID. Der Agent übernimmt automatisch den Chat-Namen.',
                'Links an existing Codex chat by chat ID. The agent automatically uses the chat name.',
              )}
            </p>
            <label>
              Chat-ID
              <input
                autoFocus
                disabled={agentCreationBusy}
                onChange={(event) => setNewAgentChatId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createAgent()
                  }
                }}
                placeholder="019f..."
                value={newAgentChatId}
              />
            </label>
            {agentCreationError && <p className="formError">{agentCreationError}</p>}
            {agentCreationBusy && (
              <div aria-live="polite" className="agentCreationProgress" role="status">
                <span aria-hidden="true" className="activitySpinner" />
                <span>
                  <strong>{tx('Agent wird erstellt', 'Creating agent')}</strong>
                  <small>{tx(
                    'Codex-Chat wird eingerichtet und bestätigt…',
                    'The Codex chat is being set up and confirmed…',
                  )}</small>
                </span>
              </div>
            )}
            <div className="modalActions">
              <button disabled={agentCreationBusy} onClick={() => setAgentCreationOpen(false)}>{tx('Abbrechen', 'Cancel')}</button>
              <button
                className="primary"
                disabled={!newAgentChatId.trim() || agentCreationBusy}
                onClick={() => void createAgent()}
              >
                {agentCreationBusy ? tx('Erstelle…', 'Creating…') : tx('Erstellen', 'Create')}
              </button>
            </div>
          </section>
        </div>
      )}

      {agentEditId && (() => {
        const editingAgent = agents.find((item) => item.id === agentEditId)
        if (!editingAgent) {
          return null
        }
        return (
          <div
            className="modalBackdrop"
            role="presentation"
            onMouseDown={() => !agentEditBusy && setAgentEditId('')}
          >
            <section
              className="promptModal agentCreationModal"
              role="dialog"
              aria-modal="true"
              aria-label={tx('Agent bearbeiten', 'Edit agent')}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="modalHeader">
                <div>
                  <p className="eyebrow">Codex Agent</p>
                  <h2>{tx('Agent bearbeiten', 'Edit agent')}</h2>
                </div>
                <button
                  aria-label={tx('Fenster schliessen', 'Close window')}
                  disabled={agentEditBusy}
                  title={tx('Fenster schliessen', 'Close window')}
                  onClick={() => setAgentEditId('')}
                >
                  x
                </button>
              </div>
              <p className="modalHint">
                {tx(
                  'Name und Chat-ID können nachträglich angepasst werden. Beim Speichern wird die Chat-ID erneut geprüft.',
                  'Name and chat ID can be changed afterwards. The chat ID is checked again when saving.',
                )}
              </p>
              <label>
                Name
                <input
                  autoFocus
                  disabled={agentEditBusy}
                  onChange={(event) => setAgentEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveAgentEdit()
                    }
                  }}
                  value={agentEditName}
                />
              </label>
              <label>
                Chat-ID
                <input
                  disabled={agentEditBusy}
                  onChange={(event) => setAgentEditChatId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveAgentEdit()
                    }
                  }}
                  placeholder="019f..."
                  value={agentEditChatId}
                />
              </label>
              {agentEditError && <p className="formError">{agentEditError}</p>}
              <div className="modalActions">
                <button disabled={agentEditBusy} onClick={() => setAgentEditId('')}>{tx('Abbrechen', 'Cancel')}</button>
                <button
                  className="primary"
                  disabled={!agentEditName.trim() || !agentEditChatId.trim() || agentEditBusy}
                  onClick={() => void saveAgentEdit()}
                >
                  {agentEditBusy ? tx('Speichere...', 'Saving...') : tx('Speichern', 'Save')}
                </button>
              </div>
            </section>
          </div>
        )
      })()}

      {agentPendingDeletionId && (() => {
        const agent = agents.find((item) => item.id === agentPendingDeletionId)
        if (!agent) {
          return null
        }
        const deleting = deletingAgentId === agent.id
        return (
          <div
            className="modalBackdrop"
            role="presentation"
            onMouseDown={() => {
              if (!deleting) {
                setAgentPendingDeletionId('')
                setAgentDeleteError('')
              }
            }}
          >
            <section
              className="promptModal agentDeleteModal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="agent-delete-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="modalHeader">
                <div>
                  <p className="eyebrow">Codex Agent</p>
                  <h2 id="agent-delete-title">{tx('Agent löschen', 'Delete agent')}</h2>
                </div>
                <button
                  aria-label={tx('Fenster schließen', 'Close window')}
                  disabled={deleting}
                  title={tx('Fenster schließen', 'Close window')}
                  onClick={() => {
                    setAgentPendingDeletionId('')
                    setAgentDeleteError('')
                  }}
                >
                  ×
                </button>
              </div>
              <p className="agentDeleteQuestion">
                {tx(
                  `Möchten Sie den Agenten „${agent.name}“ wirklich löschen?`,
                  `Do you really want to delete agent “${agent.name}”?`,
                )}
              </p>
              <p className="modalHint">
                {agent.threadId
                  ? tx(
                      'Der zugehörige Codex-Chat wird archiviert und aus der aktiven Projektansicht entfernt.',
                      'The linked Codex chat will be archived and removed from the active project view.',
                    )
                  : tx(
                      'Der Agent wird aus dem Orchestrator entfernt.',
                      'The agent will be removed from the orchestrator.',
                    )}
              </p>
              {agentDeleteError && (
                <p className="modalError" role="alert">{agentDeleteError}</p>
              )}
              <div className="modalActions">
                <button
                  disabled={deleting}
                  onClick={() => {
                    setAgentPendingDeletionId('')
                    setAgentDeleteError('')
                  }}
                >
                  {tx('Abbrechen', 'Cancel')}
                </button>
                <button
                  className="deleteButton"
                  disabled={deleting}
                  onClick={() => void deleteAgent(agent)}
                >
                  {deleting ? (
                    <>
                      <span className="activitySpinner" aria-hidden="true" />
                      {tx('Wird archiviert…', 'Archiving…')}
                    </>
                  ) : tx('Löschen', 'Delete')}
                </button>
              </div>
            </section>
          </div>
        )
      })()}

      <section className="codexBrowser">
        <div>
          <div className="codexPicker">
            <button
              className="projectStatusButton"
              onClick={() => {
                setProjectGoalDraft(selectedProjectGoal)
                setProjectGoalError('')
                setProjectGoalOpen(true)
              }}
              title={tx('Übergeordnetes Projektziel bearbeiten', 'Edit overarching project goal')}
              type="button"
            >
              {tx('Projektziel', 'Project goal')}
            </button>
            {LEGACY_STATUS_UI_ENABLED && (
              <button
                className="projectStatusButton"
                onClick={() => setStatusLibraryOpen(true)}
                title={tx('Projektweite Status konfigurieren', 'Configure project statuses')}
                type="button"
              >
                {tx('Statusbefehle', 'Status commands')}
              </button>
            )}
            <button
              className="projectStatusButton"
              onClick={() => setKnowledgeLibraryOpen(true)}
              title={tx('Projektweite Wissensdatenbank verwalten', 'Manage project knowledge database')}
              type="button"
            >
              {tx('Datenbank', 'Database')}
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
            {provisioningRecovery && (
              provisioningRecovery.archived > 0 ||
              provisioningRecovery.preserved > 0 ||
              provisioningRecovery.failures > 0 ||
              provisioningRecovery.status === 'failed'
            ) && (
              <span
                className={`recoveryNotice ${provisioningRecovery.failures > 0 || provisioningRecovery.status === 'failed' ? 'attention' : ''}`}
                title={tx(
                  `${provisioningRecovery.archived} unvollständige Chats bereinigt, ${provisioningRecovery.preserved} fertige Team-Erstellungen erhalten, ${provisioningRecovery.failures} Fehler.`,
                  `${provisioningRecovery.archived} incomplete chats cleaned up, ${provisioningRecovery.preserved} completed team setups preserved, ${provisioningRecovery.failures} errors.`,
                )}
              >
                {provisioningRecovery.failures > 0 || provisioningRecovery.status === 'failed'
                  ? tx('Wiederherstellung prüfen', 'Check recovery')
                  : tx('Wiederherstellung abgeschlossen', 'Recovery complete')}
              </span>
            )}
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
              <strong className="railProjectName">
                {selectedProject?.label ?? tx('Kein Projekt', 'No project')}
              </strong>
              <div className="railHeaderMeta">
                <small>{projectAgents.length} {tx('Agenten', 'agents')}</small>
                <button
                  className="railAddAgent"
                  disabled={autoRun}
                  title={autoRun
                    ? tx('Agenten können nur bei Auto Stop erstellt werden.', 'Agents can only be created while Auto Stop is active.')
                    : tx('Agent im aktuellen Projekt erstellen', 'Create agent in current project')}
                  onClick={() => {
                    setAgentCreationError('')
                    setNewAgentChatId('')
                    setAgentCreationOpen(true)
                  }}
                >
                  + {tx('Agent', 'Agent')}
                </button>
              </div>
            </div>
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
                onDoubleClick={() => openAgentEdit(agent)}
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
          <button
            className="profileLauncher"
            onClick={() => {
              setSettingsSection('general')
              setSettingsSearch('')
              setSettingsOpen(true)
            }}
            title={tx('Programmeinstellungen öffnen', 'Open application settings')}
            type="button"
          >
            <span className="profileAvatar">{profileInitials}</span>
            <span className="profileLauncherName">{profileName}</span>
            <span aria-hidden="true" className="profileLauncherArrow">›</span>
          </button>
        </aside>

        {selectedAgent ? (
          <section className={`workspace ${setupOpen ? 'setupWorkspace' : 'chatWorkspace'}`}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{setupOpen ? tx('Agentenprofil', 'Agent profile') : tx('Kommunikationsbrücke', 'Communication bridge')}</p>
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
                    <span aria-hidden="true">⚙</span>
                  </button>
                </span>
              </div>
            </div>

            {setupOpen ? (
              <>
            <div className="grid">
              <label>
                {tx('Rolle', 'Role')}
                <input value={selectedAgent.role} onChange={(event) => updateAgent(selectedAgent.id, { role: event.target.value })} />
              </label>
              {LEGACY_STATUS_UI_ENABLED && (
              <div className="agentStatusField">
                <span>{tx('Statuseinstellung', 'Status settings')}</span>
                <details className="promptStatusMenu agentStatusMenu">
                  <summary title={tx('Workflow-Status für diesen Agenten auswählen', 'Select workflow statuses for this agent')}>
                    <span>Workflow-Status</span>
                    <small>
                      {workflowStatusesForAgent(selectedAgent, workflowStatuses).length} {tx('ausgewählt', 'selected')}
                    </small>
                  </summary>
                  <div className="promptStatusOptions">
                    <p>{tx(
                      'Diese Status werden dem Agenten bei Workflow-Aufgaben erklärt und gelten für alle seine Prompt-Dateien.',
                      'These statuses are explained to the agent for workflow tasks and apply to all of its prompt files.',
                    )}</p>
                    <label className="promptStatusOption systemStatusOption">
                      <input checked disabled readOnly type="checkbox" />
                      <span>
                        <strong>{INTERNAL_WORKFLOW_ERROR_STATUS_NAME}</strong>
                        <small>{selectedAgent.assignment === 'management'
                          ? tx(
                              'Nicht abwählbarer Systemstatus: Eine interne Workflow-Lücke des CEO blockiert kontrolliert für eine Benutzerentscheidung.',
                              'Required system status: an internal CEO workflow gap blocks safely for a user decision.',
                            )
                          : tx(
                              'Nicht abwählbarer Systemstatus: Keine fachliche Statusmeldung passt eindeutig. Übergabe ausschließlich an den CEO.',
                              'Required system status: no functional status clearly matches. Delivered only to the CEO.',
                            )}</small>
                      </span>
                    </label>
                    {projectWorkflowStatuses.length === 0 ? (
                      <span className="empty">{tx('Im Projekt sind noch keine fachlichen Status angelegt.', 'No functional statuses have been created in this project.')}</span>
                    ) : (
                      projectWorkflowStatuses.map((status) => {
                        const enabled = selectedAgent.workflowStatusIds.includes(status.id)
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
              )}
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
                  <section className="managementInstructionSettings">
                    <div className="managementInstructionHeader">
                      <div>
                        <strong>{tx('Interne CEO-Anweisungen', 'Internal CEO instructions')}</strong>
                        <small>{tx(
                          `${selectedAgent.managementInstructionRules.length} Einträge · intern angewendet und im Chat ausgeblendet`,
                          `${selectedAgent.managementInstructionRules.length} entries · applied internally and hidden in chat`,
                        )}</small>
                      </div>
                      <button
                        onClick={() => {
                          setManagementInstructionDraft('')
                          setManagementInstructionsOpen(true)
                        }}
                        type="button"
                      >
                        {tx('Bearbeiten', 'Edit')}
                      </button>
                    </div>
                  </section>
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

                    {selectedAgent.teamProvisioningEnabled && selectedTeamPlan && !selectedTeamPlanComplete &&
                      selectedTeamPlan.signature !== dismissedTeamPlanSignature && (
                      <div className="managementTeamPlan">
                        <div className="managementTeamPlanTitle">
                          <div>
                            <span>{tx('Geprüfter Vorschlag', 'Validated proposal')}</span>
                            <strong>{tx('Team für das aktuelle Projekt', 'Team for the current project')}</strong>
                          </div>
                          <small>
                            {selectedTeamPlan.plan.agents.length} {tx('Agenten', 'agents')} ·{' '}
                            {selectedTeamPlan.plan.statusCommands.length} {tx('Statusbefehle', 'status commands')} ·{' '}
                            {selectedTeamPlan.plan.connections.length} {tx('Verbindungen', 'connections')}
                          </small>
                        </div>
                        <div className="managementTeamAgents">
                          {selectedTeamPlan.plan.agents.map((agent) => (
                            <article key={agent.name}>
                              <strong>{agent.name}</strong>
                              <span>{agent.role}</span>
                              <small className={agent.usesProjectKnowledge ? 'knowledgeEnabled' : 'knowledgeDisabled'}>{agent.usesProjectKnowledge
                                ? tx('Projektwissen aktiv', 'Project knowledge enabled')
                                : tx('Ohne Projektwissen', 'Without project knowledge')}</small>
                              <small>{tx('Webzugriff', 'Web access')}: {agent.webAccess === 'allowed'
                                ? tx('Erlaubt', 'Allowed')
                                : agent.webAccess === 'prompt'
                                  ? tx('Nach Freigabe', 'On approval')
                                  : tx('Aus', 'Off')}</small>
                            </article>
                          ))}
                        </div>
                        {teamPlanError && <p className="formError">{teamPlanError}</p>}
                        <div className="managementTeamActions">
                          <small>{tx(
                            'Erstellt fehlende Codex-Chats und Statusbefehle, speichert Prompt-Dateien und übernimmt Verbindungen. Die Automatik bleibt aus.',
                            'Creates missing Codex chats and status commands, saves prompt files, and applies connections. Automation remains off.',
                          )}</small>
                          <div className="teamPlanActions">
                            {teamPlanError && !teamPlanApplying && (
                              <button onClick={dismissManagementTeamPlan} type="button">
                                {tx('Abbrechen', 'Cancel')}
                              </button>
                            )}
                            <button
                              className="primary"
                              disabled={autoRun || teamPlanApplying}
                              onClick={() => void applyManagementTeamPlan(selectedAgent)}
                              type="button"
                            >
                              {teamPlanApplying
                                ? tx('Team wird erstellt…', 'Creating team…')
                                : teamPlanError
                                  ? tx('Erneut versuchen', 'Try again')
                                  : selectedTeamPlan.signature === selectedAgent.lastAppliedTeamPlanSignature
                                    ? tx('Einrichtung vervollständigen', 'Complete setup')
                                    : tx('Team übernehmen', 'Apply team')}
                            </button>
                          </div>
                        </div>
                        {teamPlanApplying && (
                          <div className="teamPlanProgress" role="status">
                            <span className="activitySpinner" aria-hidden="true" />
                            <span>{teamPlanProgress}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {selectedAgent.teamProvisioningEnabled && (selectedTeamPlanMalformed || selectedTeamPlanNeedsFormat) && (
                      <div className="managementTeamActions">
                        <p className="formError">{tx(
                          'Der Team-Vorschlag ist lesbar, aber noch nicht automatisch übernehmbar.',
                          'The team proposal is readable, but cannot be applied automatically yet.',
                        )}</p>
                        <button
                          disabled={autoRun || teamPlanFormatRequesting}
                          onClick={() => void requestTeamPlanFormatCorrection(selectedAgent)}
                          type="button"
                        >
                          {teamPlanFormatRequesting
                            ? tx('Format wird angefordert…', 'Requesting format…')
                            : tx('Format korrigieren', 'Correct format')}
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </section>

            <section className="autoForwardControl" aria-label={tx('Projektwissen verwenden', 'Use project knowledge')}>
              <div>
                <p className="eyebrow">{tx('Wissensdatenbank', 'Knowledge database')}</p>
                <strong>{tx('Projektwissen verwenden', 'Use project knowledge')}</strong>
              </div>
              <label className="checkbox">
                <input
                  checked={selectedAgent.usesProjectKnowledge}
                  type="checkbox"
                  onChange={(event) => updateAgent(selectedAgent.id, { usesProjectKnowledge: event.target.checked })}
                />
                {tx('Aktiv', 'Active')}
              </label>
            </section>

            <section className="autoForwardControl" aria-label={tx('Gemeinsamen Chat nutzen', 'Use shared chat')}>
              <div>
                <p className="eyebrow">{tx('Kommunikation', 'Communication')}</p>
                <strong>{tx('Gemeinsamen Chat nutzen', 'Use shared chat')}</strong>
              </div>
              <label className="checkbox">
                <input
                  checked={selectedAgent.usesTeamChat}
                  type="checkbox"
                  onChange={(event) => updateAgent(selectedAgent.id, { usesTeamChat: event.target.checked })}
                />
                {tx('Aktiv', 'Active')}
              </label>
            </section>

            <section className="autoForwardControl" aria-label={tx('Webzugriff', 'Web access')}>
              <div>
                <p className="eyebrow">{tx('Netzwerk', 'Network')}</p>
                <strong>{tx('Webzugriff', 'Web access')}</strong>
              </div>
              <select
                className="webAccessSelect"
                value={selectedAgent.webAccess}
                onChange={(event) => updateAgent(selectedAgent.id, { webAccess: event.target.value as AgentWebAccess })}
              >
                <option value="off">{tx('Aus', 'Off')}</option>
                <option value="prompt">{tx('Nach Freigabe', 'On approval')}</option>
                <option value="allowed">{tx('Erlaubt', 'Allowed')}</option>
              </select>
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
                onClick={() => {
                  setAgentDeleteError('')
                  setAgentPendingDeletionId(selectedAgent.id)
                }}
              >
                {deletingAgentId === selectedAgent.id ? tx('Wird archiviert…', 'Archiving…') : tx('Agent löschen', 'Delete agent')}
              </button>
            </div>
              </>
            ) : (
              <section className="agentChat communicationBridge" aria-label={`${tx('Kommunikationsbrücke von', 'Communication bridge for')} ${selectedAgent.name}`}>
                <div className="chatHeader">
                  <div>
                    <strong>{tx('Kommunikationsbrücke', 'Communication bridge')}</strong>
                    <small>{selectedAgent.threadTitle || selectedAgent.name}</small>
                  </div>
                  <div className="communicationHeaderActions">
                    <div className="communicationTabs" role="tablist" aria-label={tx('Ansicht', 'View')}>
                      <button
                        aria-selected={communicationView === 'overview'}
                        className={communicationView === 'overview' ? 'active' : ''}
                        onClick={() => setCommunicationView('overview')}
                        role="tab"
                        type="button"
                      >
                        {tx('Übersicht', 'Overview')}
                      </button>
                      <button
                        aria-selected={communicationView === 'chat'}
                        className={communicationView === 'chat' ? 'active' : ''}
                        onClick={() => {
                          setChatPinnedToBottom(true)
                          setCommunicationView('chat')
                        }}
                        role="tab"
                        type="button"
                      >
                        Chat
                      </button>
                    </div>
                    <span className={`liveIndicator ${isAgentBusy(selectedAgent) ? 'active' : ''}`}>
                      {isAgentBusy(selectedAgent) && <span className="activitySpinner" aria-hidden="true" />}
                      {isAgentBusy(selectedAgent) ? tx('Codex arbeitet', 'Codex is working') : tx('Verbunden', 'Connected')}
                    </span>
                  </div>
                </div>
                {selectedAgent.teamProvisioningEnabled && selectedTeamPlan && !selectedTeamPlanComplete &&
                  selectedTeamPlan.signature !== dismissedTeamPlanSignature && (
                  <section
                    aria-busy={teamPlanApplying}
                    aria-live="polite"
                    className={`chatTeamPlan ${teamPlanApplying ? 'processing' : teamPlanError ? 'blocked' : 'waiting'}`}
                  >
                    <div>
                      <span>{teamPlanApplying
                        ? tx('Team-Einrichtung läuft', 'Team setup in progress')
                        : teamPlanError
                          ? tx('Übernahme angehalten', 'Setup paused')
                          : tx('Team-Vorschlag bereit', 'Team proposal ready')}</span>
                      <strong>
                        {selectedTeamPlan.plan.agents.length} {tx('Agenten', 'agents')} ·{' '}
                        {selectedTeamPlan.plan.connections.length} {tx('Verbindungen', 'connections')}
                      </strong>
                      <small>{teamPlanApplying
                        ? tx('Agenten, Prompts, Statusbefehle und Verdrahtung werden gespeichert.', 'Saving agents, prompts, status commands, and workflow wiring.')
                        : teamPlanError
                          ? tx('Der Vorgang wurde nicht abgeschlossen. Details stehen unten.', 'The operation did not complete. See details below.')
                          : tx('Wartet auf Freigabe. Bei Auto Stop kontrolliert übernehmen.', 'Waiting for approval. Apply safely while Auto Stop is active.')}</small>
                    </div>
                    {teamPlanApplying ? (
                      <div className="teamPlanProgress" role="status">
                        <span className="activitySpinner" aria-hidden="true" />
                        <span>{teamPlanProgress}</span>
                      </div>
                    ) : (
                      <div className="teamPlanActions">
                        {teamPlanError && (
                          <button onClick={dismissManagementTeamPlan} type="button">
                            {tx('Abbrechen', 'Cancel')}
                          </button>
                        )}
                        <button
                          className="primary"
                          disabled={autoRun}
                          onClick={() => void applyManagementTeamPlan(selectedAgent)}
                          type="button"
                        >
                          {selectedTeamPlan.signature === selectedAgent.lastAppliedTeamPlanSignature
                            ? tx('Einrichtung vervollständigen', 'Complete setup')
                            : teamPlanError
                              ? tx('Erneut versuchen', 'Try again')
                            : autoRun
                              ? tx('Auto Stop erforderlich', 'Auto Stop required')
                              : tx('Team übernehmen', 'Apply team')}
                        </button>
                      </div>
                    )}
                    {teamPlanError && <p className="formError">{teamPlanError}</p>}
                  </section>
                )}
                {selectedAgent.teamProvisioningEnabled && (selectedTeamPlanMalformed || selectedTeamPlanNeedsFormat) && (
                  <section className="chatTeamPlan blocked" aria-live="polite">
                    <div>
                      <span>{tx('Team-Vorschlag erkannt', 'Team proposal detected')}</span>
                      <strong>{tx('Übernahmeformat fehlt', 'Application format missing')}</strong>
                      <small>{tx(
                        'Der Inhalt bleibt unverändert. Fordere nur das technische Format für die Übernahme an.',
                        'The content remains unchanged. Request only the technical format required to apply it.',
                      )}</small>
                    </div>
                    <button
                      className="primary"
                      disabled={autoRun || teamPlanFormatRequesting}
                      onClick={() => void requestTeamPlanFormatCorrection(selectedAgent)}
                      type="button"
                    >
                      {teamPlanFormatRequesting
                        ? tx('Wird angefordert…', 'Requesting…')
                        : tx('Format korrigieren', 'Correct format')}
                    </button>
                    {teamPlanError && <p className="formError">{teamPlanError}</p>}
                  </section>
                )}
                {communicationView === 'overview' ? (
                <div className="communicationBridgeBody" aria-live="polite">
                  <div className="bridgeStatusBlock">
                    <span className="eyebrow">{tx('Codex-Verbindung', 'Codex connection')}</span>
                    <strong>{selectedAgent.threadId
                      ? tx('Der Codex-Chat ist als Arbeitskanal verbunden.', 'The Codex chat is connected as the work channel.')
                      : tx('Kein Codex-Chat verknüpft.', 'No Codex chat is linked.')}</strong>
                    <small>{tx(
                      'Unterhaltungen und Facharbeit bleiben im Codex-Chat. Diese Oberfläche zeigt nur Übergaben, Status und Laufsteuerung.',
                      'Conversations and expert work remain in the Codex chat. This surface only shows handoffs, status, and run control.',
                    )}</small>
                  </div>
                  <div className="bridgeStatusGrid">
                    <div>
                      <span>{tx('Agentenstatus', 'Agent status')}</span>
                      <strong>{statusLabels[language][selectedAgent.status]}</strong>
                    </div>
                    <div>
                      <span>{tx('Automatische Weitergabe', 'Automatic forwarding')}</span>
                      <strong>{selectedAgent.autoForward ? tx('Aktiv', 'Active') : tx('Aus', 'Off')}</strong>
                    </div>
                    <div>
                      <span>{tx('Letzte Laufzeit', 'Last run')}</span>
                      <strong>{formatDuration(selectedAgent.lastDurationMs, language)}</strong>
                    </div>
                    <div>
                      <span>{tx('Verknüpfte Aufgabe', 'Linked task')}</span>
                      <strong>{selectedAgent.threadId || tx('Nicht verknüpft', 'Not linked')}</strong>
                    </div>
                  </div>
                  {(latestBridgeStatus || latestBridgeChanges.length > 0) && (
                    <section className="bridgeArtifacts" aria-label={`${tx('Letzte Codex-Übergabe', 'Latest Codex handoff')}${latestBridgeIdentity ? `: ${latestBridgeIdentity.label}` : ''}`}>
                      {latestBridgeStatus && (
                        <div className="bridgeLastStatus">
                          <span>{tx('Letzter Workflow-Status', 'Latest workflow status')}</span>
                          <strong>{latestBridgeStatus}</strong>
                        </div>
                      )}
                      {latestBridgeChanges.length > 0 && (
                        <div className="bridgeFileChanges">
                          <span>{tx('Geänderte Dateien', 'Changed files')}</span>
                          <ul>
                            {latestBridgeChanges.map((change) => (
                              <li key={`${change.kind}:${change.path}`}>
                                <span className={`fileChangeKind ${change.kind}`}>{change.kind === 'added' ? 'A' : change.kind === 'deleted' ? 'D' : change.kind === 'renamed' ? 'R' : 'M'}</span>
                                <code>{change.path}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                  {chatError && <p className="chatError">{chatError}</p>}
                  {selectedAgent.pendingUserConfirmation && !selectedAgent.pendingUserConfirmation.dismissed && (
                    <div className="bridgeAttention" role="status">
                      <strong>{tx('Benutzeraktion erforderlich', 'User action required')}</strong>
                      <span>{tx('Die Rückfrage wird im Codex-Chat beantwortet. Der Workflow wartet.', 'Answer the question in the Codex chat. The workflow is waiting.')}</span>
                    </div>
                  )}
                  <p className="bridgeHint">{tx(
                    'Öffne für Nachrichten, Rückfragen und Dateien den verknüpften Codex-Chat. Der Orchestrator leitet nur ausdrücklich freigegebene Workflow-Nachrichten weiter.',
                    'Open the linked Codex chat for messages, questions, and files. The orchestrator forwards only explicitly approved workflow messages.',
                  )}</p>
                </div>
                ) : (
                <div className="communicationChatView">
                  <div className="chatScopeTabs" role="tablist" aria-label={tx('Chatbereich', 'Chat scope')}>
                    <button
                      aria-selected={communicationChatScope === 'team'}
                      className={communicationChatScope === 'team' ? 'active' : ''}
                      onClick={() => {
                        setChatPinnedToBottom(true)
                        setCommunicationChatScope('team')
                      }}
                      role="tab"
                      type="button"
                    >
                      {tx('Teamchat', 'Team chat')}
                    </button>
                    <button
                      aria-selected={communicationChatScope === 'agent'}
                      className={communicationChatScope === 'agent' ? 'active' : ''}
                      onClick={() => {
                        setChatPinnedToBottom(true)
                        setCommunicationChatScope('agent')
                      }}
                      role="tab"
                      type="button"
                    >
                      {tx('Agentenchat', 'Agent chat')}
                    </button>
                  </div>
                  {chatError && <p className="chatError">{chatError}</p>}
                  <div
                    className="chatStream communicationChatStream"
                    ref={chatStreamRef}
                    onWheel={(event) => {
                      if (event.deltaY < 0) setChatPinnedToBottom(false)
                    }}
                    onScroll={(event) => {
                      const target = event.currentTarget
                      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
                      setChatPinnedToBottom(distanceFromBottom <= 8)
                    }}
                  >
                    {chatMessages.length === 0 && !chatError && (
                      <p className="empty chatEmpty">{tx('Keine Chat-Nachrichten geladen.', 'No chat messages loaded.')}</p>
                    )}
                    {chatMessages.map((message) => {
                      const identity = chatMessageIdentity(message, selectedAgent.name, language)
                      return (
                        <article className={`chatMessage ${message.role}`} key={message.id}>
                          <div className="chatMessageMeta">
                            <strong>{identity.name}</strong>
                            <small>{identity.label}</small>
                          </div>
                          <p>{message.text}</p>
                          {message.workspaceChanges && message.workspaceChanges.length > 0 && (
                            <div className="chatFileChanges">
                              <strong>{tx('Geaenderte Dateien', 'Changed files')}</strong>
                              <ul>
                                {message.workspaceChanges.map((change) => (
                                  <li key={`${message.id}:${change.kind}:${change.path}`}>
                                    <span className={`fileChangeKind ${change.kind}`}>{change.kind === 'added' ? 'A' : change.kind === 'deleted' ? 'D' : change.kind === 'renamed' ? 'R' : 'M'}</span>
                                    <code>{change.path}</code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                  {!chatPinnedToBottom && (
                    <button
                      aria-label={tx('Zu den neuesten Nachrichten springen', 'Jump to latest messages')}
                      className="jumpToLatest communicationJumpToLatest"
                      onClick={() => {
                        const stream = chatStreamRef.current
                        if (stream) stream.scrollTop = stream.scrollHeight
                        setChatPinnedToBottom(true)
                      }}
                      title={tx('Zu den neuesten Nachrichten springen', 'Jump to latest messages')}
                      type="button"
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  )}
                </div>
                )}
              </section>
            )}
          </section>
        ) : (
          <section className="workspace emptyWorkspace chatWorkspace" aria-label={tx('Leere Kommunikationsbrücke', 'Empty communication bridge')}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{tx('Kommunikationsbrücke', 'Communication bridge')}</p>
                <h2>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</h2>
              </div>
            </div>
            <section className="agentChat emptyAgentChat">
              <div className="chatHeader">
                <div>
                  <strong>{tx('Kommunikationsbrücke', 'Communication bridge')}</strong>
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
            <div className="workflowRunHeader">
              <p className="eyebrow">{tx('Arbeitslauf', 'Workflow run')}</p>
              <button
                className="workflowRunReset"
                disabled={!selectedProjectPath || workflowResetting}
                onClick={() => void resetSelectedWorkflowRun()}
                title={tx('Offene Arbeit verwerfen und den Laufzustand zurücksetzen', 'Discard open work and reset the workflow state')}
                type="button"
              >
                {workflowResetting ? tx('Setzt zurück …', 'Resetting…') : tx('Zurücksetzen', 'Reset')}
              </button>
            </div>
            {selectedWorkflowCheckpoint && (
              <article className={`workflowCheckpoint ${selectedWorkflowCheckpoint.state}`}>
                <strong>
                  {selectedWorkflowCheckpoint.state === 'pending'
                    ? tx('Fortsetzung vorgemerkt', 'Resume checkpoint ready')
                    : tx('Fortsetzung blockiert', 'Resume checkpoint blocked')}
                </strong>
                <p>
                  {selectedWorkflowCheckpoint.sourceAgentName}
                  {selectedWorkflowCheckpoint.targetAgentNames.length > 0
                    ? ` -> ${selectedWorkflowCheckpoint.targetAgentNames.join(', ')}`
                    : ''}
                </p>
                {selectedWorkflowCheckpoint.statusNames.length > 0 && (
                  <p>{selectedWorkflowCheckpoint.statusNames.join(', ')}</p>
                )}
                {selectedWorkflowCheckpoint.reason && <p>{selectedWorkflowCheckpoint.reason}</p>}
              </article>
            )}
            {!selectedWorkflowCheckpoint && !selectedWorkflowRun && (
              <p className="empty">{tx('Kein gespeicherter Arbeitslauf.', 'No saved workflow run.')}</p>
            )}
            {selectedWorkflowRun?.entries.slice(-6).reverse().map((entry) => (
              <article key={entry.id}>
                <time>{new Date(entry.at).toLocaleTimeString(language === 'de' ? 'de-DE' : 'en-US')}</time>
                <strong>{entry.agentName || tx('Orchestrator', 'Orchestrator')}</strong>
                <CollapsibleText text={entry.detail} limit={320} language={language} />
              </article>
            ))}
            <p className="eyebrow">{tx('Ablaufprotokoll', 'Activity log')}</p>
            {events.filter((event) => event.projectPath && samePath(event.projectPath, selectedProjectPath)).length === 0 && <p className="empty">{tx('Noch keine Orchestrator-Aktion.', 'No orchestrator activity yet.')}</p>}
            {events.filter((event) => event.projectPath && samePath(event.projectPath, selectedProjectPath)).map((event) => (
              <article key={event.id}>
                <time>{event.at}</time>
                <strong>{eventTitleText(event.title, language)}</strong>
                <CollapsibleText text={eventDetailText(event.detail, language)} limit={320} language={language} />
              </article>
            ))}
          </div>
        </aside>
      </section>

      {projectGoalOpen && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setProjectGoalOpen(false)}
        >
          <section
            aria-label={tx('Projektziel bearbeiten', 'Edit project goal')}
            aria-modal="true"
            className="promptModal projectGoalModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Projektorientierung', 'Project orientation')}</p>
                <h2>{tx('Projektziel', 'Project goal')}</h2>
              </div>
              <button
                aria-label={tx('Projektziel-Fenster schließen', 'Close project goal window')}
                onClick={() => setProjectGoalOpen(false)}
                title={tx('Projektziel-Fenster schließen', 'Close project goal window')}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="projectGoalEditor">
              {tx('Übergeordnetes Projektziel', 'Overarching project goal')}
              <textarea
                autoFocus
                maxLength={4000}
                onChange={(event) => setProjectGoalDraft(event.target.value)}
                onPaste={(event) => {
                  const pastedText = event.clipboardData.getData('text/plain')
                  if (!pastedText) return
                  event.preventDefault()
                  const textarea = event.currentTarget
                  const inserted = insertProjectGoalText(
                    projectGoalDraft,
                    pastedText,
                    textarea.selectionStart,
                    textarea.selectionEnd,
                  )
                  setProjectGoalDraft(inserted.value)
                  window.requestAnimationFrame(() => {
                    textarea.setSelectionRange(inserted.cursor, inserted.cursor)
                  })
                }}
                rows={9}
                value={projectGoalDraft}
              />
            </label>
            <div className="projectGoalMeta">
              <small>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</small>
              <small>{projectGoalDraft.length}/4000</small>
            </div>
            {projectGoalError && <p className="formError">{projectGoalError}</p>}
            <div className="modalActions splitActions">
              <div>
                {selectedProjectGoal && (
                  <button
                    className="deleteButton"
                    disabled={projectGoalSaving}
                    onClick={() => void saveProjectGoal('')}
                    type="button"
                  >
                    {tx('Löschen', 'Delete')}
                  </button>
                )}
              </div>
              <div className="modalActionGroup">
                <button disabled={projectGoalSaving} onClick={() => setProjectGoalOpen(false)} type="button">
                  {tx('Abbrechen', 'Cancel')}
                </button>
                <button
                  className="primary"
                  disabled={projectGoalSaving || !projectGoalDraft.trim()}
                  onClick={() => void saveProjectGoal()}
                  type="button"
                >
                  {projectGoalSaving ? tx('Speichert…', 'Saving…') : tx('Übernehmen', 'Apply')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {knowledgeLibraryOpen && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setKnowledgeLibraryOpen(false)}
        >
          <section
            aria-label={tx('Wissensdatenbank konfigurieren', 'Configure knowledge database')}
            aria-modal="true"
            className="promptModal statusLibraryModal knowledgeLibraryModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Projektwissen', 'Project knowledge')}</p>
                <h2>{tx('Datenbank', 'Database')}</h2>
              </div>
              <button
                aria-label={tx('Datenbank-Fenster schließen', 'Close database window')}
                onClick={() => setKnowledgeLibraryOpen(false)}
                title={tx('Datenbank-Fenster schließen', 'Close database window')}
                type="button"
              >
                ×
              </button>
            </div>
            <section className="workflowStatusLibrary knowledgeLibrary" aria-label={tx('Projektweite Wissensquellen', 'Project knowledge sources')}>
              <div className="workflowStatusHeader">
                <div>
                  <strong>{selectedProject?.label ?? tx('Kein Projekt', 'No project')}</strong>
                  <small>{tx('Aktive Einträge stehen allen Agenten ausschließlich lesend zur Verfügung.', 'Active entries are available to every agent as read-only sources.')}</small>
                </div>
                <small>
                  {visibleProjectKnowledgeSources.filter((source) => source.enabled).length}/{visibleProjectKnowledgeSources.length} {tx('aktiv', 'active')}
                  {' · '}{projectKnowledgeSources.length} {tx('insgesamt', 'total')}
                </small>
              </div>
              <div className="knowledgeSourceCreate">
                <input
                  aria-label={tx('Name der Wissensquelle', 'Knowledge source name')}
                  className="knowledgeSourceName"
                  onChange={(event) => setKnowledgeSourceName(event.target.value)}
                  placeholder={tx('Name', 'Name')}
                  value={knowledgeSourceName}
                />
                <select
                  aria-label={tx('Typ der Wissensquelle', 'Knowledge source type')}
                  className="knowledgeSourceType"
                  onChange={(event) => setKnowledgeSourceType(event.target.value as KnowledgeSourceType)}
                  value={knowledgeSourceType}
                >
                  <option value="repository">Repository</option>
                  <option value="folder">{tx('Ordner', 'Folder')}</option>
                  <option value="file">{tx('Datei', 'File')}</option>
                  <option value="url">Weblink</option>
                </select>
                <input
                  aria-label={tx('Pfad oder URL der Wissensquelle', 'Knowledge source path or URL')}
                  className="knowledgeSourceLocation"
                  onChange={(event) => setKnowledgeSourceLocation(event.target.value)}
                  placeholder={tx('Pfad oder URL', 'Path or URL')}
                  value={knowledgeSourceLocation}
                />
                <input
                  aria-label={tx('Beschreibung der Wissensquelle', 'Knowledge source description')}
                  className="knowledgeSourceDescription"
                  onChange={(event) => setKnowledgeSourceDescription(event.target.value)}
                  placeholder={tx('Beschreibung (optional)', 'Description (optional)')}
                  value={knowledgeSourceDescription}
                />
                <button
                  className="knowledgeSourceAdd"
                  disabled={knowledgeSourceSaving || !knowledgeSourceName.trim() || !knowledgeSourceLocation.trim()}
                  onClick={() => void addKnowledgeSource()}
                  type="button"
                >
                  {knowledgeSourceSaving ? tx('Speichert…', 'Saving…') : tx('Hinzufügen', 'Add')}
                </button>
              </div>
              {knowledgeSourceError && <p className="formError">{knowledgeSourceError}</p>}
              {visibleProjectKnowledgeSources.length === 0 ? (
                <p className="empty">{tx('In dieser Kategorie wurden noch keine Wissensquellen angelegt.', 'No knowledge sources have been created in this category.')}</p>
              ) : (
                <div className="knowledgeSourceList">
                  {visibleProjectKnowledgeSources.map((source) => (
                    <div className={`knowledgeSourceItem${source.enabled ? '' : ' disabled'}`} key={source.id}>
                      <label className="knowledgeSourceToggle">
                        <input
                          checked={source.enabled}
                          disabled={knowledgeSourceSaving}
                          onChange={(event) => void setKnowledgeSourceEnabled(source.id, event.target.checked)}
                          type="checkbox"
                        />
                        <span>{tx('Aktiv', 'Active')}</span>
                      </label>
                      <div className="knowledgeSourceCopy">
                        <strong>{source.name}</strong>
                        <span>{source.type} · {source.location}</span>
                        {source.description && <small>{source.description}</small>}
                      </div>
                      <button
                        aria-label={`${tx('Wissensquelle löschen', 'Delete knowledge source')}: ${source.name}`}
                        className="deleteStatus"
                        disabled={knowledgeSourceSaving}
                        onClick={() => void deleteKnowledgeSource(source.id)}
                        title={tx('Wissensquelle löschen', 'Delete knowledge source')}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      )}

      {statusLibraryOpen && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setStatusLibraryOpen(false)}
        >
          <section
            aria-label={tx('Statusbefehle konfigurieren', 'Configure status commands')}
            aria-modal="true"
            className="promptModal statusLibraryModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Workflow-Status</p>
                <h2>{tx('Statusbefehle', 'Status commands')}</h2>
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
                  <strong>{tx('Befehlsliste', 'Command list')}</strong>
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
                  {projectWorkflowStatuses.map((status) => {
                    const isFixedSystemStatus = status.id === UNCONDITIONAL_FORWARD_STATUS_ID
                    return (
                    <div className={`workflowStatusItem${isFixedSystemStatus ? ' fixedSystemStatus' : ''}`} key={status.id}>
                      <strong>{status.name}</strong>
                      <span>{status.description || tx('Keine Beschreibung', 'No description')}</span>
                      {isFixedSystemStatus ? (
                        <small className="fixedStatusLabel">{tx('Fester Systemstatus', 'Fixed system status')}</small>
                      ) : (
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
                      )}
                    </div>
                    )
                  })}
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
        <div className="modalBackdrop workflowNodeEditorBackdrop" role="presentation" onMouseDown={() => setSelectedPromptId('')}>
          <section
            className="promptModal workflowToolModal forwardingModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Weiterleiten-Baustein bearbeiten', 'Edit forwarding node')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Weiterleiten', 'Forward')}</p>
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
            <details className="forwardingNodeSection">
              <summary>{tx('Weiterleiten-Text', 'Forwarding text')}</summary>
              <label>
                {tx('Zusatzprompt für den nächsten Agenten', 'Additional prompt for the next agent')}
                <textarea
                  rows={6}
                  value={selectedPrompt.prompt}
                  onChange={(event) => updateWorkflowPrompt(selectedPrompt.id, { prompt: event.target.value, condition: '' })}
                />
              </label>
            </details>
            <details className="forwardingNodeSection intervalBlock">
              <summary>{tx('Intervall-Ausgang', 'Interval output')}</summary>
              <label>
                {tx('Intervall-Quelle', 'Interval source')}
                <select
                  value={selectedPrompt.intervalSource}
                  onChange={(event) =>
                    updateWorkflowPromptIntervalSource(
                      selectedPrompt.id,
                      event.target.value as WorkflowPrompt['intervalSource'],
                    )
                  }
                >
                  <option value="none">{tx('Kein Intervall', 'No interval')}</option>
                  <option value="custom">{tx('Eigener Intervall', 'Custom interval')}</option>
                  <option value="project">{tx('Projekt-Läufe verwenden', 'Use project runs')}</option>
                </select>
              </label>
              {selectedPrompt.intervalSource !== 'none' && selectedPrompt.interval > 0 && (
                <>
                  <label>
                    {tx('Intervall', 'Interval')}
                    <input
                      disabled={selectedPrompt.intervalSource === 'project'}
                      max={MAX_FORWARD_INTERVAL}
                      min={1}
                      onChange={(event) => updateWorkflowPromptInterval(selectedPrompt.id, event.target.value)}
                      type={selectedPrompt.intervalSource === 'project' ? 'text' : 'number'}
                      value={selectedPrompt.intervalSource === 'project'
                        ? `${selectedLoopCount} ${tx('Projekt-Läufe', 'project runs')}`
                        : selectedPrompt.interval}
                    />
                  </label>
                  <label>
                    {tx('Intervalltext', 'Interval text')}
                    <textarea
                      rows={4}
                      value={selectedPrompt.intervalPrompt}
                      onChange={(event) =>
                        updateWorkflowPromptIntervalPrompt(selectedPrompt.id, event.target.value)
                      }
                      placeholder={tx('Optional: eigener Text für den Intervall-Ausgang.', 'Optional: separate text for the interval output.')}
                    />
                  </label>
                  <label>
                    {tx('Intervall-Verhalten', 'Interval behavior')}
                    <select
                      value={selectedPrompt.intervalMode}
                      onChange={(event) => updateWorkflowPromptIntervalMode(selectedPrompt.id, event.target.value)}
                    >
                      <option value="replace">{tx('Nur Intervall-Ausgang', 'Interval output only')}</option>
                      <option value="both">{tx('Normal + Intervall', 'Normal + interval')}</option>
                    </select>
                  </label>
                </>
              )}
            </details>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowPrompt(selectedPrompt.id)}>
                {tx('Löschen', 'Delete')}
              </button>
              <button className="primary" onClick={() => setSelectedPromptId('')}>{tx('Übernehmen', 'Apply')}</button>
            </div>
          </section>
        </div>
      )}
      {selectedLoop && (
        <div className="modalBackdrop workflowNodeEditorBackdrop" role="presentation" onMouseDown={() => setSelectedLoopId('')}>
          <section
            className="promptModal workflowToolModal loopModal"
            role="dialog"
            aria-modal="true"
            aria-label={tx('Rücksprung bearbeiten', 'Edit return jump')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Workflow-Rücksprung', 'Workflow return')}</p>
                <h2>{selectedLoop.name}</h2>
              </div>
              <button title={tx('Fenster schließen', 'Close window')} onClick={() => setSelectedLoopId('')}>×</button>
            </div>
            <label>
              {tx('Name', 'Name')}
              <input
                value={selectedLoop.name}
                onChange={(event) => updateWorkflowLoop(selectedLoop.id, { name: event.target.value })}
              />
            </label>
            <details className="loopTargetMenu forwardingNodeSection">
              <summary>
                <span>{tx('Zielagenten', 'Target agents')}</span>
              </summary>
              <p className="modalHint loopTargetHint">
                {tx('Ausgewählte Agenten lesen die Nachricht.', 'Selected agents read the message.')}
              </p>
              <div className="loopTargetOptions">
                {projectAgents.map((agent) => {
                  const selectedTargetIds = selectedLoop.targetAgentIds?.length
                    ? selectedLoop.targetAgentIds
                    : selectedLoop.targetAgentId
                      ? [selectedLoop.targetAgentId]
                      : []
                  const checked = selectedTargetIds.includes(agent.id)
                  return (
                    <label className="loopTargetOption" key={agent.id}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...new Set([...selectedTargetIds, agent.id])]
                            : selectedTargetIds.filter((id) => id !== agent.id)
                          updateWorkflowLoop(selectedLoop.id, {
                            targetAgentId: nextIds[0] ?? '',
                            targetAgentIds: nextIds,
                          })
                        }}
                        type="checkbox"
                      />
                      <span>{agent.name}</span>
                    </label>
                  )
                })}
              </div>
            </details>
            <p className="modalHint">
              {tx(
                'Der Baustein zeigt nur die kurze Verbindung bis zum Rücksprung. Die Nachricht wird von den ausgewählten Agenten gelesen, ohne zusätzliche sichtbare Rückkanten anzulegen.',
                'The node shows only the short connection to the return jump. The selected agents read the message without additional visible return edges.',
              )}
            </p>
            <div className="modalActions">
              <button className="deleteButton" onClick={() => deleteWorkflowLoop(selectedLoop.id)}>
                {tx('Löschen', 'Delete')}
              </button>
              <button className="primary" onClick={() => setSelectedLoopId('')}>
                {tx('Übernehmen', 'Apply')}
              </button>
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
                  <details className="dashboardAgentMenu">
                    <summary
                      aria-label={tx('Agentenauswahl öffnen', 'Open agent selection')}
                      role="button"
                      title={tx('Agenten', 'Agents')}
                    >
                      +
                    </summary>
                    <div className="promptStatusOptions dashboardAgentOptions">
                      <p>{tx(
                        'Agenten in diesem Dashboard',
                        'Agents in this dashboard',
                      )}</p>
                      {projectAgents.map((agent) => {
                        const enabled = activeBoardAgentIds.includes(agent.id)
                        const isOwner = agent.id === selectedAgent?.id
                        return (
                          <label className="promptStatusOption" key={agent.id}>
                            <input
                              checked={enabled}
                              disabled={isOwner}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  addAgentToDashboard(agent.id)
                                } else {
                                  removeAgentFromDashboard(agent.id)
                                }
                                event.currentTarget.closest('details')?.removeAttribute('open')
                              }}
                              type="checkbox"
                            />
                            <span>
                              <strong>{agent.name}</strong>
                              <small>{isOwner
                                ? tx('Eigentümer dieses Dashboards', 'Owner of this dashboard')
                                : enabled
                                  ? tx('Im Dashboard enthalten', 'Included in dashboard')
                                  : tx('Zum Dashboard hinzufügen', 'Add to dashboard')}</small>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </details>
                  <button
                    aria-label={tx('Workflow anordnen', 'Arrange workflow')}
                    className="compactAction iconAction"
                    onClick={autoArrangeWorkflow}
                    title={tx('Anordnen', 'Arrange')}
                    type="button"
                  >
                    A
                  </button>
                  <button
                    aria-label={tx('Layout-Muster speichern', 'Save layout pattern')}
                    className="compactAction iconAction"
                    onClick={saveWorkflowLayoutPattern}
                    title={activeLayoutPattern
                      ? tx('Layout-Muster überschreiben', 'Overwrite layout pattern')
                      : tx('Layout-Muster speichern', 'Save layout pattern')}
                    type="button"
                  >
                    M
                  </button>
                  {LEGACY_STATUS_UI_ENABLED && (
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
                    <label className="promptStatusOption systemStatusOption">
                      <input checked disabled readOnly type="checkbox" />
                      <span>
                        <strong>{INTERNAL_WORKFLOW_ERROR_STATUS_NAME}</strong>
                        <small>{selectedAgent.assignment === 'management'
                          ? tx(
                              'Nicht abwählbarer Systemstatus: blockiert kontrolliert für eine Benutzerentscheidung.',
                              'Required system status: blocks safely for a user decision.',
                            )
                          : tx(
                              'Nicht abwählbarer Systemstatus: Übergabe ausschließlich an den CEO.',
                              'Required system status: delivered only to the CEO.',
                            )}</small>
                      </span>
                    </label>
                    {projectWorkflowStatuses.length === 0 ? (
                      <span className="empty">{tx('Im Projekt sind noch keine fachlichen Status angelegt.', 'No functional statuses have been created in this project.')}</span>
                    ) : (
                      projectWorkflowStatuses.map((status) => {
                        const enabled = selectedAgent.workflowStatusIds.includes(status.id)
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
                  )}
                  <details className="dashboardTools">
                  <summary
                    aria-label={tx('Tools öffnen', 'Open tools')}
                    title="Tools"
                  >
                    T
                  </summary>
                  <div className="dashboardToolMenu">
                    <button
                      aria-disabled={Boolean(initialToolUnavailableReason)}
                      disabled={Boolean(initialToolUnavailableReason)}
                      onClick={(event) => {
                        addWorkflowInitial()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      title={initialToolUnavailableReason || tx('Initial-Baustein hinzufügen', 'Add initial node')}
                      type="button"
                    >
                      <span className="toolSymbol">+</span>
                      <span>
                        <strong>Initial</strong>
                        <small>{initialToolUnavailableReason || tx('Neutrales Startsignal an diesen Agenten', 'Neutral start signal to this agent')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowPrompt()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">+</span>
                      <span>
                        <strong>{tx('Weiterleiten', 'Forward')}</strong>
                        <small>{tx('Antwort mit optionalem Zusatzprompt weitergeben', 'Forward response with an optional prompt')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowLoop()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol loopToolSymbol">R</span>
                      <span>
                        <strong>{tx('Rücksprung', 'Return')}</strong>
                        <small>{tx('Kurzer Rücksprung zu ausgewählten Agenten', 'Short return jump to selected agents')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowStop()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">S</span>
                      <span>
                        <strong>Stop</strong>
                        <small>{tx('Workflow-Pfad an dieser Stelle beenden', 'End the workflow path here')}</small>
                      </span>
                    </button>
                    <button
                      onClick={(event) => {
                        addWorkflowTimer()
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      type="button"
                    >
                      <span className="toolSymbol">Z</span>
                      <span>
                        <strong>{tx('Zeitplan', 'Schedule')}</strong>
                        <small>{tx('Zeitgesteuerten Startpunkt anlegen', 'Create a scheduled start point')}</small>
                      </span>
                    </button>
                  </div>
                  </details>
                </div>
                <div className="dashboardCloseGroup">
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
            </div>
            <ReactFlowProvider>
              <WorkflowDashboard
                agents={dashboardAgents}
                prompts={dashboardPrompts}
                initials={projectInitials}
                statusFilters={projectStatusFilters}
                stops={projectStops}
                timers={projectTimers}
                loops={projectLoops}
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
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectPrompt={(promptId) => {
                  setSelectedPromptId(promptId)
                  setSelectedWorkflowAgentId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectAgent={(agentId) => {
                  setSelectedWorkflowAgentId(agentId)
                  setSelectedPromptId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectInitial={(initialId) => {
                  setSelectedInitialId(initialId)
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectStatusFilter={(filterId) => {
                  setSelectedStatusFilterId(filterId)
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectStop={(stopId) => {
                  setSelectedStopId(stopId)
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedTimerId('')
                  setSelectedLoopId('')
                }}
                onSelectTimer={(timerId) => {
                  setSelectedTimerId(timerId)
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedLoopId('')
                }}
                onSelectLoop={(loopId) => {
                  setSelectedLoopId(loopId)
                  setSelectedPromptId('')
                  setSelectedWorkflowAgentId('')
                  setSelectedRouteId('')
                  setSelectedInitialId('')
                  setSelectedStatusFilterId('')
                  setSelectedStopId('')
                  setSelectedTimerId('')
                }}
                onNodePositionChange={(nodeId, position) => {
                  sharedStateDirty.current = true
                  setWorkflowPositions((current) => ({
                    ...current,
                    [`${activeDashboardOwnerId}:${nodeId}`]: position,
                  }))
                }}
                onAgentDrop={dropAgentIntoDashboard}
                draggedAgentId={draggedAgentId}
                selectedAgentNodeId={selectedWorkflowAgentId}
                language={language}
              />
            </ReactFlowProvider>
            {layoutPatternFeedback && (
              <span className="layoutPatternToast">{layoutPatternFeedback}</span>
            )}
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
      {managementInstructionsOpen && selectedAgent?.assignment === 'management' && (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={() => setManagementInstructionsOpen(false)}
        >
          <section
            aria-label={tx('CEO-Anweisungen bearbeiten', 'Edit CEO instructions')}
            aria-modal="true"
            className="promptModal managementInstructionsModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">CEO</p>
                <h2>{tx('Interne Anweisungen', 'Internal instructions')}</h2>
              </div>
              <button
                onClick={() => setManagementInstructionsOpen(false)}
                title={tx('Fenster schließen', 'Close window')}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="managementInstructionList">
              {selectedAgent.managementInstructionRules.length === 0 ? (
                <p className="empty">{tx('Keine CEO-Anweisungen eingetragen.', 'No CEO instructions configured.')}</p>
              ) : selectedAgent.managementInstructionRules.map((instruction, index) => (
                <div className="managementInstructionItem" key={index}>
                  <textarea
                    aria-label={`${tx('CEO-Anweisung', 'CEO instruction')} ${index + 1}`}
                    value={instruction}
                    onChange={(event) => updateAgent(selectedAgent.id, {
                      managementInstructionRules: selectedAgent.managementInstructionRules.map(
                        (item, itemIndex) => itemIndex === index ? event.target.value : item,
                      ),
                    })}
                  />
                  <button
                    className="deleteButton"
                    onClick={() => updateAgent(selectedAgent.id, {
                      managementInstructionRules: selectedAgent.managementInstructionRules.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })}
                    title={tx('Anweisung löschen', 'Delete instruction')}
                    type="button"
                  >
                    {tx('Löschen', 'Delete')}
                  </button>
                </div>
              ))}
            </div>
            <div className="managementInstructionAdd">
              <label>
                {tx('Neue Anweisung', 'New instruction')}
                <textarea
                  placeholder={tx('Organisatorische CEO-Anweisung eintragen', 'Enter an organizational CEO instruction')}
                  value={managementInstructionDraft}
                  onChange={(event) => setManagementInstructionDraft(event.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!managementInstructionDraft.trim()}
                onClick={() => {
                  const instruction = managementInstructionDraft.trim()
                  if (!instruction) return
                  updateAgent(selectedAgent.id, {
                    managementInstructionRules: [...selectedAgent.managementInstructionRules, instruction],
                  })
                  setManagementInstructionDraft('')
                }}
                type="button"
              >
                {tx('Hinzufügen', 'Add')}
              </button>
            </div>
            <div className="modalActions">
              <button className="primary" onClick={() => setManagementInstructionsOpen(false)} type="button">
                {tx('Fertig', 'Done')}
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
              {tx('Optionale Initialanweisung', 'Optional initial instruction')}
              <textarea
                value={selectedInitial.instructionSource === 'user' ? selectedInitial.instruction : ''}
                placeholder={tx(
                  'Nur Ablaufanweisungen, keine fachliche Aufgabe oder Prompt-Angabe',
                  'Process instructions only, no domain task or prompt content',
                )}
                onChange={(event) => updateWorkflowInitial(selectedInitial.id, {
                  instruction: event.target.value,
                  instructionSource: event.target.value ? 'user' : undefined,
                })}
              />
            </label>
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
            {selectedRouteSourceForwarding && (selectedRouteSourceForwarding.interval ?? 0) > 0 && (
              <p className="modalHint routeBranchHint">
                {tx('Ausgang', 'Output')}: <strong>
                  {(selectedRoute.sourceHandle ?? 'output') === 'interval'
                    ? tx('Intervall', 'Interval')
                    : tx('Normal', 'Normal')}
                </strong>
              </p>
            )}
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
              <button className="primary" onClick={() => setSelectedRouteId('')}>{tx('Übernehmen', 'Apply')}</button>
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
                {tx('Entfernen', 'Remove')}
              </button>
              <button className="primary" onClick={() => setSelectedWorkflowAgentId('')}>{tx('Übernehmen', 'Apply')}</button>
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
            aria-label={tx('Weiterleiten konfigurieren', 'Configure forwarding')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{tx('Weiterleiten', 'Forward')}</p>
                <h2>{tx('Weiterleiten', 'Forward')}</h2>
              </div>
              <button
                aria-label={tx('Fenster schließen', 'Close window')}
                title={tx('Fenster schließen', 'Close window')}
                onClick={() => setSelectedStatusFilterId('')}
              >
                ×
              </button>
            </div>
            <section className="statusFilterSummary" aria-label={tx('Feste Weiterleitung', 'Fixed forwarding')}>
              <details className="statusFilterBlock">
                <summary>{tx('Normaler Ausgang', 'Normal output')}</summary>
                <label>
                  Status
                  <input value={tx('Weiterleiten', 'Forward')} readOnly />
                </label>
                <label>
                  {tx('Zusatztext für den nächsten Agenten', 'Additional text for the next agent')}
                  <textarea
                    rows={5}
                    value={routes.find((route) =>
                      route.sourceId === selectedStatusFilter.id && (route.sourceHandle ?? 'output') === 'output'
                    )?.prompt ?? ''}
                    onChange={(event) =>
                      updateWorkflowStatusFilterPrompt(selectedStatusFilter.id, event.target.value)
                    }
                    placeholder={tx('Optional: Anweisung oder Kontext anhängen.', 'Optional: append instruction or context.')}
                  />
                </label>
              </details>
              <details className="statusFilterBlock intervalBlock">
                <summary>{tx('Intervall-Ausgang', 'Interval output')}</summary>
                <label>
                  {tx('Intervall', 'Interval')}
                  <input
                    max={MAX_FORWARD_INTERVAL}
                    min={1}
                    onChange={(event) => updateWorkflowStatusFilterInterval(selectedStatusFilter.id, event.target.value)}
                    placeholder={tx('Kein Intervall', 'No interval')}
                    type="number"
                    value={selectedStatusFilter.interval || ''}
                  />
                </label>
                <label>
                  {tx('Intervalltext', 'Interval text')}
                  <textarea
                    rows={4}
                    value={selectedStatusFilter.intervalPrompt ?? ''}
                    onChange={(event) =>
                      updateWorkflowStatusFilterIntervalPrompt(selectedStatusFilter.id, event.target.value)
                    }
                    placeholder={tx('Optional: eigener Text für den Intervall-Ausgang.', 'Optional: separate text for the interval output.')}
                  />
                </label>
                {(selectedStatusFilter.interval ?? 0) > 0 && (
                  <label>
                    {tx('Intervall-Verhalten', 'Interval behavior')}
                    <select
                      value={selectedStatusFilter.intervalMode ?? 'replace'}
                      onChange={(event) =>
                        updateWorkflowStatusFilterIntervalMode(selectedStatusFilter.id, event.target.value)
                      }
                    >
                      <option value="replace">{tx('Nur Intervall-Ausgang', 'Interval output only')}</option>
                      <option value="both">{tx('Normal + Intervall', 'Normal + interval')}</option>
                    </select>
                  </label>
                )}
                <p className="modalHint forwardIntervalHint">
                  {(selectedStatusFilter.interval ?? 0) > 0
                    ? tx(
                        (selectedStatusFilter.intervalMode ?? 'replace') === 'both'
                          ? `Stand ${selectedStatusFilter.intervalCount ?? 0}/${selectedStatusFilter.interval}. Beim ${selectedStatusFilter.interval}. Treffer werden Normal und Intervall verwendet; der Zähler wird auf 0 gesetzt.`
                          : `Stand ${selectedStatusFilter.intervalCount ?? 0}/${selectedStatusFilter.interval}. Beim ${selectedStatusFilter.interval}. Treffer wird der Intervall-Ausgang verwendet und der Zähler auf 0 gesetzt.`,
                        (selectedStatusFilter.intervalMode ?? 'replace') === 'both'
                          ? `Count ${selectedStatusFilter.intervalCount ?? 0}/${selectedStatusFilter.interval}. On hit ${selectedStatusFilter.interval}, normal and interval outputs are used, then the count resets to 0.`
                          : `Count ${selectedStatusFilter.intervalCount ?? 0}/${selectedStatusFilter.interval}. The interval output is used on hit ${selectedStatusFilter.interval}, then the count resets to 0.`,
                      )
                    : tx(
                        'Ohne Intervall besitzt der Baustein nur den normalen Ausgang.',
                        'Without an interval, the node has only its normal output.',
                      )}
                </p>
              </details>
            </section>
            <p className="modalHint statusFilterInfo">
              {tx('Dieser Baustein gibt die letzte Antwort des vorherigen Agenten direkt an den nächsten verbundenen Agenten weiter. Der Zusatztext wird an diese Übergabe angehängt.', 'This node forwards the previous agent answer directly to the next connected agent. The additional text is appended to that handoff.')}
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
