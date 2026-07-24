import { resolve } from 'node:path'

export function projectThreadExecutionParams(cwd) {
  return {
    cwd: resolve(cwd),
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
  }
}

export function projectTurnExecutionParams(cwd) {
  const projectRoot = resolve(cwd)
  return {
    cwd: projectRoot,
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [projectRoot],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  }
}
