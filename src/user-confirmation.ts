export type UserConfirmationRequest = {
  kind: 'confirmation' | 'question'
  reason: string
  confirmationText: string
  requestedAt: string
  forwardAfterConfirmation: boolean
  resumeAutomation: boolean
  dismissed: boolean
}

export function normalizeUserConfirmationRequest(value: unknown): UserConfirmationRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<UserConfirmationRequest>
  const kind = candidate.kind === 'question' ? 'question' : 'confirmation'
  if (
    typeof candidate.reason !== 'string' ||
    typeof candidate.confirmationText !== 'string' ||
    typeof candidate.requestedAt !== 'string' ||
    (kind === 'confirmation' && !candidate.confirmationText.trim())
  ) return null

  return {
    kind,
    reason: candidate.reason.trim(),
    confirmationText: candidate.confirmationText.trim().slice(0, 1_000),
    requestedAt: candidate.requestedAt,
    forwardAfterConfirmation: candidate.forwardAfterConfirmation === true,
    resumeAutomation: candidate.resumeAutomation === true,
    dismissed: candidate.dismissed === true,
  }
}

export function userInteractionInstruction() {
  return [
    'Benutzer-Rückfragen (verbindlich):',
    'Wenn du für den nächsten Arbeitsschritt eine Information, Entscheidung oder Handlung des Benutzers brauchst, stelle genau eine konkrete Frage.',
    'Setze eine Bestätigung immer in diesen eigenen Block:',
    '<orchestrator_user_confirmation>\nFrage: Deine konkrete Frage an den Benutzer?\nAntwort: Der exakte Bestätigungstext\n</orchestrator_user_confirmation>',
    'Setze eine reine Frage in diesen eigenen Block:',
    '<orchestrator_user_question>Deine konkrete Frage an den Benutzer?</orchestrator_user_question>',
    'Nutze diese Blöcke nur, wenn du ohne die Antwort tatsächlich nicht weiterarbeiten kannst. Nutze sie nicht für rhetorische Fragen, Vorschläge oder Zusammenfassungen.',
    'Gib in diesem Fall keinen Workflow-Status aus. Der Orchestrator pausiert den Pfad, zeigt die Frage als Pop-up und sendet die Benutzerantwort an dich zurück.',
  ].join('\n')
}

const REQUEST_PATTERNS = [
  /(?:benötig|benoetig|brauche|erforderlich|warte(?:t)?\s+auf|bitte\s+bestätige|bitte\s+bestaetige)[^\r\n]{0,180}(?:menschliche|benutzer(?:seitige)?|user)[ -]?(?:bestätigung|bestaetigung|freigabe|entscheidung)/iu,
  /(?:menschliche|benutzer(?:seitige)?|user)[ -]?(?:bestätigung|bestaetigung|freigabe|entscheidung)[^\r\n]{0,100}(?:benötig|benoetig|brauche|erforderlich|ausstehend)/iu,
  /(?:requires?|required|needed|waiting\s+for|please\s+confirm)[^\r\n]{0,180}(?:human|user)[ -]?(?:confirmation|approval|decision)/iu,
  /(?:human|user)[ -]?(?:confirmation|approval|decision)[^\r\n]{0,100}(?:requires?|required|needed|pending)/iu,
]

const DIRECT_CONFIRMATION_PATTERNS = [
  /(?:bitte|erforderliche\s+benutzerhandlung\s*:)[\s\S]{0,600}?\b(?:danach|anschließend|anschliessend)?\s*(?:exakt|genau)\s+(?:mit\s+)?(?:antworten|antworte)\s*:?\s*\r?\n+\s*`([^`\r\n]{1,1000})`\s*$/iu,
  /(?:bitte|erforderliche\s+benutzerhandlung\s*:)[\s\S]{0,600}?\b(?:antworten|antworte)\s+(?:(?:danach|anschließend|anschliessend)\s+)?(?:exakt|genau)(?:\s+mit)?\s*:?\s*\r?\n+\s*`([^`\r\n]{1,1000})`\s*$/iu,
  /(?:please|required\s+user\s+action\s*:)[\s\S]{0,600}?\b(?:then\s+)?(?:reply|respond)\s+(?:exactly|with\s+exactly)\s*:?\s*\r?\n+\s*`([^`\r\n]{1,1000})`\s*$/iu,
]

export function parseUserConfirmationRequest(result: string, requestedAt = new Date().toISOString()) {
  const taggedConfirmation = result.match(
    /<orchestrator_user_confirmation>\s*\r?\n?\s*(?:Frage|Question)\s*:\s*([\s\S]*?)\r?\n\s*(?:Antwort|Answer)\s*:\s*([\s\S]*?)\r?\n?\s*<\/orchestrator_user_confirmation>/iu,
  )
  if (taggedConfirmation) {
    const reason = taggedConfirmation[1].trim()
    const confirmationText = taggedConfirmation[2].trim().replace(/^`|`$/gu, '').trim()
    if (reason && confirmationText) {
      return {
        kind: 'confirmation' as const,
        reason,
        confirmationText: confirmationText.slice(0, 1_000),
        requestedAt,
        forwardAfterConfirmation: false,
        resumeAutomation: false,
        dismissed: false,
      }
    }
  }

  const directConfirmationText = DIRECT_CONFIRMATION_PATTERNS
    .map((pattern) => result.match(pattern)?.[1]?.trim() ?? '')
    .find(Boolean)
  if (directConfirmationText) {
    return {
      kind: 'confirmation' as const,
      reason: `Direkte Benutzerhandlung erforderlich: ${directConfirmationText}`,
      confirmationText: directConfirmationText,
      requestedAt,
      forwardAfterConfirmation: false,
      resumeAutomation: false,
      dismissed: false,
    }
  }

  const request = REQUEST_PATTERNS
    .map((pattern) => result.match(pattern))
    .filter((match): match is RegExpMatchArray => Boolean(match && match.index !== undefined))
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))[0]
  if (!request || request.index === undefined) return null

  const sentence = request[0]
  const lineStart = result.lastIndexOf('\n', request.index - 1) + 1
  const lineEnd = result.indexOf('\n', request.index + request[0].length)
  const requestLine = result.slice(lineStart, lineEnd < 0 ? result.length : lineEnd)
  if (/\b(?:keine|keinerlei|nicht|no|not)\b[^\r\n]{0,100}(?:bestätigung|bestaetigung|freigabe|entscheidung|confirmation|approval|decision)/iu.test(requestLine)) return null

  const remainder = result.slice(request.index + request[0].length)
  const fencedText = remainder.match(/```(?:text)?\s*\r?\n([\s\S]*?)```/iu)?.[1]?.trim() ?? ''
  if (!fencedText || fencedText.length > 1_000) return null

  return {
    kind: 'confirmation' as const,
    reason: sentence.replace(/\s+/gu, ' ').trim().replace(/:\s*$/u, ''),
    confirmationText: fencedText,
    requestedAt,
    forwardAfterConfirmation: false,
    resumeAutomation: false,
    dismissed: false,
  }
}

function cleanQuestion(value: string) {
  return value.replace(/^\s*(?:[-*#>]\s*)+/gu, '').replace(/^\*\*|\*\*$/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 1_000)
}

export function parseUserQuestionRequest(result: string, requestedAt = new Date().toISOString()) {
  const tagged = result.match(/<orchestrator_user_question>\s*([\s\S]{1,1000}?)\s*<\/orchestrator_user_question>/iu)?.[1]
  const directQuestion = tagged || result.split(/\r?\n/gu).map(cleanQuestion).find((line) =>
    /^(?:(?:kannst|könntest|koenntest|würdest|wuerdest|möchtest|moechtest|willst|hast|bist)\s+du\b|(?:soll|darf)\s+ich\b|could\s+you\b|would\s+you\b|do\s+you\b|may\s+i\b)[^?]{2,999}\?$/iu.test(line),
  )
  if (!directQuestion) return null
  const question = cleanQuestion(directQuestion)
  if (!question.endsWith('?')) return null
  return {
    kind: 'question' as const,
    reason: question,
    confirmationText: '',
    requestedAt,
    forwardAfterConfirmation: false,
    resumeAutomation: false,
    dismissed: false,
  }
}

export function parseUserInteractionRequest(result: string, requestedAt = new Date().toISOString()) {
  return parseUserConfirmationRequest(result, requestedAt) || parseUserQuestionRequest(result, requestedAt)
}

export function isAffirmativeUserConfirmation(text: string) {
  const normalized = text.trim().toLocaleLowerCase('de-DE').replace(/[.!]+$/gu, '').replace(/\s+/gu, ' ')
  return [
    'ok', 'okay', 'ja', 'bestätigt', 'bestaetigt', 'freigabe erteilt',
    'machen wir so', 'so machen wir weiter', 'okay, so machen wir weiter',
    'ok, so machen wir weiter', 'weiter', 'fortfahren',
  ].includes(normalized)
}
