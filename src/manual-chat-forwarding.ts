const NEGATED_FORWARDING = [
  /\bbitte\s+nicht\b[^\r\n]{0,80}\bweiterleiten\b/iu,
  /\b(?:keinesfalls|auf\s+keinen\s+fall)\b[^\r\n]{0,80}\bweiterleiten\b/iu,
  /^\s*nicht\s+weiterleiten[.!]?\s*$/iu,
  /\bweiterleiten\b[^\r\n]{0,80}\bbitte\s+nicht\b/iu,
  /\b(?:do\s+not|don't|never)\b[^\r\n]{0,80}\bforward\b/iu,
]

const EXPLICIT_FORWARDING = [
  /\bweiterleiten\b/iu,
  /(?:^|[\s,.;:!?])(?:leite|leitest|leiten|übermittle|uebermittle|sende|schicke|übergib|uebergib|gib)(?=\s)[^\r\n]{0,120}\b(?:weiter|an\s+(?:den\s+)?(?:nächsten|naechsten|folgenden|zuständigen|zustaendigen)?\s*(?:agent(?:en)?|prüfer|pruefer|entwickler|forschungsleiter))\b/iu,
  /\b(?:du\s+)?(?:sollst|musst)\b[^\r\n]{0,100}\bweiterleit(?:en|est)?\b/iu,
  /\b(?:bitte|kannst\s+du)\b[^\r\n]{0,100}\bweiterleit(?:en|est)?\b/iu,
  /\b(?:antwort|ergebnis|nachricht|auftrag)\b[^\r\n]{0,80}\bweiterleit(?:en|ung)?\b/iu,
  /\b(?:forward|send|pass)\b[^\r\n]{0,120}\b(?:response|answer|result|message|task|to\s+the\s+(?:next\s+)?agent)\b/iu,
]

export function requestsManualChatForwarding(text: string) {
  if (NEGATED_FORWARDING.some((pattern) => pattern.test(text))) return false
  return EXPLICIT_FORWARDING.some((pattern) => pattern.test(text))
}
