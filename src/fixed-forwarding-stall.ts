const AUTHORIZATION_STALL_PATTERNS = [
  /keine(?:\s+eigenst(?:a|ae)ndige|\s+ausdr(?:u|ue)ckliche)?\s+(?:ausf(?:u|ue)hrungs)?freigabe/i,
  /keine(?:\s+eigenst(?:a|ae)ndige|\s+ausdr(?:u|ue)ckliche)?\s+beauftragung/i,
  /nicht\s+als\s+ausf(?:u|ue)hrungsfreigabe/i,
  /ausf(?:u|ue)hrungsfreigabe\s+liegt\s+nicht\s+vor/i,
  /(?:ist|bleibt|war)\s+(?:nur\s+)?(?:eine\s+)?empfehlung/i,
  /darf\s+erst\s+nach[\s\S]{0,160}(?:freigabe|beauftragung)/i,
  /kein(?:en|e)?\s+ausfuehrbar(?:en|er|es)?\s+(?:forschungs-|entwicklungs-)?auftrag/i,
]

const INCOMPLETE_TASK_PATTERNS = [
  /kein(?:e|en)?\s+konkretes?\s+arbeitsobjekt/i,
  /kein(?:e|en)?\s+arbeitsobjekt/i,
  /keine\s+ausf(?:u|ue)hrbare\s+(?:anforderung|aufgabe)/i,
  /unvollst(?:a|ae)ndig(?:er|e|en)?\s+workflow[- ]auftrag/i,
  /keine\s+technische\s+arbeit\s+(?:beginnen|m(?:o|oe)glich)/i,
  /(?:fehlt|fehlen)\s+(?:ein|eine)\s+konkrete(?:r|s|n)?\s+(?:aufgabe|arbeitsobjekt|erfolgskriterium)/i,
  /n(?:a|ae)chste(?:r|n)?\s+auftrag\s*:\s*(?:keiner|keine|nichts)/i,
  /(?:diese|die)\s+(?:workflow-?)?kette\s+ist\s+beendet/i,
  /weitere\s+arbeit\s+ist\s+erst\s+durch\s+einen\s+neuen/i,
]

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss')
}

export function isFixedForwardingAuthorizationStall(result: string) {
  const value = normalized(result)
  return AUTHORIZATION_STALL_PATTERNS.some((pattern) => pattern.test(value))
}

export function isFixedForwardingIncompleteTask(result: string) {
  const value = normalized(result)
  return INCOMPLETE_TASK_PATTERNS.some((pattern) => pattern.test(value))
}

export function isFixedForwardingNoNextTask(result: string) {
  const value = normalized(result)
  return [
    /n(?:a|ae)chste(?:r|n)?\s+auftrag\s*:\s*(?:keiner|keine|nichts)/i,
    /(?:diese|die)\s+(?:workflow-?)?kette\s+ist\s+beendet/i,
    /weitere\s+arbeit\s+ist\s+erst\s+durch\s+einen\s+neuen/i,
  ].some((pattern) => pattern.test(value))
}

export function fixedForwardingAuthorizationRepairInstruction() {
  return [
    'Korrektur der festen Weiterleitung (verbindlich):',
    'Deine letzte Antwort hat den konkreten Folgeschritt erneut wegen einer angeblich fehlenden Freigabe nicht bearbeitet.',
    'Der Eingang kam über den festen Status "Weiterleiten" und ist damit bereits als Agent-zu-Agent-Auftrag autorisiert.',
    'Bearbeite den im vorherigen Eingang konkret benannten nächsten Schritt jetzt gemäß deiner Rolle.',
    'Bist du der Prüfer, gib den Schritt eindeutig als ausführbaren Auftrag frei oder formuliere nach begründeter Ablehnung einen korrigierten ausführbaren Auftrag.',
    'Bist du der ausführende Agent, führe den freigegebenen Auftrag direkt aus.',
    'Fordere keine zweite Benutzerfreigabe an. Nur eine echte physische Handlung, Zugangsinformation, Sicherheitsentscheidung oder irreversible Freigabe darf eine Benutzerbestätigung erfordern.',
  ].join('\n')
}

export function fixedForwardingNextTaskRepairInstruction() {
  return [
    'Korrektur des fachlichen Folgeauftrags (verbindlich):',
    'Deine letzte Antwort hat nur den aktuellen Teilauftrag beendet. Das übergeordnete Projekt ist dadurch nicht abgeschlossen.',
    'Leite aus deiner Rollen-Anweisung, dem Projektziel und dem aktuellen Ergebnis genau einen kleinen, ausführbaren nächsten Forschungs- oder Prüfschritt ab.',
    'Benenne Arbeitsobjekt, Aufgabe, Erfolgskriterium und Verifikation und bearbeite den Schritt direkt, sofern du dafür zuständig bist.',
    'Beende die feste Weiterleitung nur bei einem ausdrücklich konfigurierten Projektabschluss oder einer echten Benutzerentscheidung. Erfinde keine Projektfertigstellung.',
  ].join('\n')
}
