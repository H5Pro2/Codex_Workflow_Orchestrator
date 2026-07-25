export type CodexProjectLike = {
  id: string
  path: string
}

export type CodexThreadProjectLike = {
  projectId?: string
  cwd: string
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => value.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
  return Boolean(left && right) && normalize(left) === normalize(right)
}

export function threadBelongsToProject(
  thread: CodexThreadProjectLike,
  project: CodexProjectLike,
) {
  return thread.projectId
    ? thread.projectId === project.id
    : samePath(thread.cwd, project.path)
}

export function projectForThread<T extends CodexProjectLike>(
  thread: CodexThreadProjectLike,
  projects: readonly T[],
) {
  return projects.find((project) => threadBelongsToProject(thread, project))
}
