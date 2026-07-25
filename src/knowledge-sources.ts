export type KnowledgeSourceType = 'folder' | 'repository' | 'file' | 'url'

export type KnowledgeSource = {
  id: string
  projectPath: string
  name: string
  type: KnowledgeSourceType
  location: string
  description: string
  enabled: boolean
}

export function knowledgeSourcesForProject(
  sources: readonly KnowledgeSource[],
  projectPath: string,
) {
  const normalizedProjectPath = projectPath.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
  return sources.filter((source) => (
    source.projectPath.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') === normalizedProjectPath
  ))
}

export function knowledgeSourcesForAgent(
  sources: readonly KnowledgeSource[],
  projectPath: string,
  usesProjectKnowledge: boolean,
) {
  return usesProjectKnowledge ? knowledgeSourcesForProject(sources, projectPath) : []
}

export function knowledgeSourceInstruction(sources: readonly KnowledgeSource[]) {
  const enabled = sources.filter((source) => source.enabled)
  if (enabled.length === 0) return ''

  return [
    'Projektweite Wissensquellen:',
    'Diese Quellen sind nur zur Recherche und Orientierung freigegeben. Verändere sie nicht. Schreibe Arbeitsergebnisse ausschließlich in den freigegebenen Projekt-Workspace.',
    ...enabled.map((source) => [
      `- ${source.name} [${source.type}]: ${source.location}`,
      source.description ? `  Zweck: ${source.description}` : '',
    ].filter(Boolean).join('\n')),
    'Nutze nur relevante Quellen. Nenne im Ergebnis, welche Quelle du tatsächlich verwendet hast.',
  ].join('\n')
}
