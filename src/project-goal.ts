export type ProjectGoal = {
  projectPath: string
  goal: string
}

export const PROJECT_GOAL_MAX_LENGTH = 4000

export function insertProjectGoalText(
  value: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const available = Math.max(0, PROJECT_GOAL_MAX_LENGTH - (value.length - (end - start)))
  const insertedText = pastedText.slice(0, available)
  return {
    value: `${value.slice(0, start)}${insertedText}${value.slice(end)}`,
    cursor: start + insertedText.length,
  }
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
