export type WorkflowStatusLike = {
  id: string
  name: string
  description?: string
}

export type WorkflowSignalKind =
  | 'valid'
  | 'none'
  | 'missing'
  | 'unknown'
  | 'ambiguous'
  | 'misplaced'

export type WorkflowSignal = {
  kind: WorkflowSignalKind
  statusIds: string[]
  names: string[]
  unknownNames: string[]
  source: 'marker' | 'legacy-json' | 'none'
}

export const WORKFLOW_DECISION_AUTHORITY = [
  'Die technische Workflow-Topologie entscheidet, welche Übergänge existieren.',
  'Ein Agententext liefert ausschließlich ein zu validierendes Statussignal.',
  'Nur genau ein erlaubter Status kann einen Statusfilter aktivieren.',
  'Sprachliche Rollen- und Ablaufregeln dürfen keine technische Verbindung erzeugen oder umgehen.',
] as const

function normalizeStatusName(value: string) {
  return value.trim().toLocaleLowerCase('de-DE')
}

function readLegacyStatusNames(result: string) {
  const candidates = [result.trim()]
  const fencedJson = Array.from(
    result.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
    (match) => match[1].trim(),
  )
  candidates.push(...fencedJson)
  const firstBrace = result.indexOf('{')
  const lastBrace = result.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(result.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const names = [parsed.workflow_status, parsed.workflow_statuses, parsed.signale]
        .flatMap((value) =>
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : typeof value === 'string'
              ? [value]
              : [],
        )
        .map((name) => name.trim())
        .filter(Boolean)
      if (names.length > 0) return names
    } catch {
      // Legacy JSON is optional; malformed candidates are ignored.
    }
  }
  return []
}

export function parseWorkflowSignal(
  result: string,
  definitions: readonly WorkflowStatusLike[],
): WorkflowSignal {
  const markerMatches = Array.from(
    result.matchAll(/\[Workflow-Status:\s*([^\]\r\n]+)\]/gi),
  )
  const markerNames = markerMatches.map((match) => match[1].trim()).filter(Boolean)
  const names = markerNames.length > 0 ? markerNames : readLegacyStatusNames(result)
  const source = markerNames.length > 0
    ? 'marker' as const
    : names.length > 0
      ? 'legacy-json' as const
      : 'none' as const

  if (names.length === 0) {
    return { kind: 'missing', statusIds: [], names: [], unknownNames: [], source }
  }
  if (names.length !== 1) {
    return { kind: 'ambiguous', statusIds: [], names, unknownNames: [], source }
  }

  if (source === 'marker') {
    const marker = markerMatches[0]
    const leadingText = result.slice(0, marker.index ?? 0)
    const trailingText = result.slice((marker.index ?? 0) + marker[0].length).trim()
    const startsOnOwnLine = (marker.index ?? 0) === 0 || /(?:\r?\n)[\t ]*$/.test(leadingText)
    if (!startsOnOwnLine || trailingText) {
      return { kind: 'misplaced', statusIds: [], names, unknownNames: [], source }
    }
  }

  if (normalizeStatusName(names[0]) === normalizeStatusName('Kein Status')) {
    return { kind: 'none', statusIds: [], names, unknownNames: [], source }
  }

  const definition = definitions.find(
    (item) => normalizeStatusName(item.name) === normalizeStatusName(names[0]),
  )
  if (!definition) {
    return {
      kind: 'unknown',
      statusIds: [],
      names,
      unknownNames: names,
      source,
    }
  }

  return {
    kind: 'valid',
    statusIds: [definition.id],
    names: [definition.name],
    unknownNames: [],
    source,
  }
}

export function workflowSignalIssue(signal: WorkflowSignal) {
  switch (signal.kind) {
    case 'missing':
      return 'Die Antwort enthält keinen Workflow-Status.'
    case 'unknown':
      return `Die Antwort verwendet einen unbekannten Workflow-Status: ${signal.unknownNames.join(', ')}.`
    case 'ambiguous':
      return `Die Antwort enthält mehrere Workflow-Statusangaben: ${signal.names.join(', ')}.`
    case 'misplaced':
      return 'Der Workflow-Status steht nicht als letzte Zeile der Antwort.'
    case 'none':
      return 'Die Antwort meldet ausdrücklich keinen passenden Workflow-Status.'
    case 'valid':
      return ''
  }
}

export function workflowStatusInstruction(statuses: readonly WorkflowStatusLike[]) {
  return [
    'Workflow-Abschlussformat (verbindlich):',
    'Antworte zuerst normal und verständlich mit Zusammenfassung und nächstem Schritt. Verwende kein JSON.',
    '',
    'Setze als allerletzte Zeile genau einen Workflow-Status im Format [Workflow-Status: STATUSNAME].',
    'Der Status ist das einzige Textsignal für die Workflow-Weiterleitung. Die technische Topologie entscheidet über den tatsächlichen Zielpfad.',
    'Verwende ausschließlich einen exakten Statusnamen aus dieser Projektliste:',
    ...(statuses.length > 0
      ? statuses.map((status) => `- ${status.name}: ${status.description || 'Keine Beschreibung'}`)
      : ['- Keine Status definiert: verwende [Workflow-Status: Kein Status].']),
    '',
    'Wenn kein Status zutrifft, verwende [Workflow-Status: Kein Status]. Erfinde keine Statusnamen.',
    'Mehrere Statusangaben, unbekannte Statusnamen und Text nach der Statuszeile werden vom Orchestrator als ungültige Antwort behandelt.',
  ].join('\n')
}
