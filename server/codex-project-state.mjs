function cleanPath(value) {
  return typeof value === 'string' ? value.replace(/^\\\\\?\\/, '') : ''
}

export function savedProjectsFromState(state) {
  const localProjects = state?.['local-projects'] ?? {}
  const projectOrder = Array.isArray(state?.['project-order']) ? state['project-order'] : []
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
        path: cleanPath(project.rootPaths[0]),
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

export function applyThreadProjectAssignments(threads, state, projects) {
  const assignments = state?.['thread-project-assignments'] ?? {}
  const projectsById = new Map(projects.map((project) => [project.id, project]))

  return threads.map((thread) => {
    const assignment = assignments[thread.id]
    const project = assignment && typeof assignment.projectId === 'string'
      ? projectsById.get(assignment.projectId)
      : null
    if (!project) return thread

    return {
      ...thread,
      projectId: project.id,
      projectPath: project.path,
      assignedCwd: cleanPath(assignment.cwd || assignment.path || project.path),
      projectAssignmentPending: assignment.pendingCoreUpdate === true,
    }
  })
}
