import { resolve } from 'node:path'

export const PROJECT_WORKSPACE_DIRECTORY = 'workspace'

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

export function projectTurnExecutionParams(cwd) {
  const workspaceRoot = projectWorkspacePath(cwd)
  return {
    cwd: workspaceRoot,
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [workspaceRoot],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  }
}
