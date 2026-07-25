export type ProjectGoal = {
  projectPath: string
  goal: string
}

function normalizedPath(path: string) {
  return path.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function projectGoalForProject(goals: readonly ProjectGoal[], projectPath: string) {
  const path = normalizedPath(projectPath)
  return goals.find((entry) => normalizedPath(entry.projectPath) === path)?.goal ?? ''
}

export function projectGoalInstruction(goal: string) {
  const normalizedGoal = goal.trim()
  if (!normalizedGoal) return ''

  return [
    'Übergeordnetes Projektziel (nur Orientierung und Qualitätskontrolle):',
    normalizedGoal,
    '',
    'Dieses Projektziel ist keine eigenständig auszuführende Aufgabe und kein Initialauftrag.',
    'Bearbeite ausschließlich den konkret übergebenen Auftrag. Prüfe vor dem Abschluss, ob dein Ergebnis dem Projektziel entspricht, und melde eine erkennbare Zielabweichung in deinem Ergebnis.',
  ].join('\n')
}
