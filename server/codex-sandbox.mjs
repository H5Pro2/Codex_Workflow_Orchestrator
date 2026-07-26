import { resolve } from 'node:path'

export const PROJECT_WORKSPACE_DIRECTORY = 'workspace'
export const AGENT_WEB_ACCESS_MODES = ['off', 'prompt', 'allowed']

export function normalizeAgentWebAccess(value) {
  return AGENT_WEB_ACCESS_MODES.includes(value) ? value : 'off'
}

export function projectWorkspacePath(cwd) {
  return resolve(cwd, PROJECT_WORKSPACE_DIRECTORY)
}

export function projectThreadExecutionParams(cwd) {
  return {
    cwd: resolve(cwd),
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
  }
}

export function projectTurnExecutionParams(cwd, webAccess = 'off') {
  const workspaceRoot = projectWorkspacePath(cwd)
  const normalizedWebAccess = normalizeAgentWebAccess(webAccess)
  return {
    cwd: workspaceRoot,
    approvalPolicy: normalizedWebAccess === 'prompt' ? 'on-request' : 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [workspaceRoot],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: normalizedWebAccess === 'allowed',
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  }
}
