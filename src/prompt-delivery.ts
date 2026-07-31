type VerifiedPromptInstruction = {
  path: string
  projectPath?: string
  sha256: string
  content: string
}

export function absolutePromptReference(projectPath: string, path: string) {
  const trimmedPath = path.trim()
  if (!projectPath.trim() || /^(?:[a-z]:[\\/]|\\\\|\/)/iu.test(trimmedPath)) return trimmedPath
  const windowsPath = projectPath.includes('\\')
  const separator = windowsPath ? '\\' : '/'
  const root = projectPath.replace(/[\\/]+$/gu, '')
  const relativePath = trimmedPath
    .replace(/^[\\/]+/gu, '')
    .replace(/[\\/]+/gu, separator)
  return `${root}${separator}${relativePath}`
}

export function verifiedPromptInstruction({ path, projectPath = '', sha256, content }: VerifiedPromptInstruction) {
  const fileReference = absolutePromptReference(projectPath, path)
  return [
    `Serverseitig verifizierte Prompt-Kopie: \`${fileReference}\``,
    `SHA-256: \`${sha256}\``,
    'Die folgende eingebettete Rollen-Anweisung ist die Ausführungsgrundlage dieses Auftrags.',
    'Die Datei ist ihre persistente, inhaltsgleiche Prüffassung. Kannst du die Datei nicht lesen, arbeite mit dem eingebetteten Inhalt weiter und melde den Dateizugriff lediglich als technischen Diagnosehinweis.',
    'Erzeuge, verschiebe oder repariere keine Ersatzkopie der Prompt-Datei. Ein fehlgeschlagener Zugriff ist kein fachlicher Workflow-Fehler.',
    '<orchestrator_role_instruction>',
    content,
    '</orchestrator_role_instruction>',
  ].join('\n')
}
