const BROWSER_ONLY_CONSTRAINT = /(?:kein(?:en)?\s+download|ohne\s+download|keine\s+lokale\s+kopie|nichts\s+herunterladen)/iu
const LOCAL_MEDIA_REQUIREMENT = /(?:originaldatei|videodatei|mediendatei)[\s\S]{0,180}(?:lokal|bereitstell|speicher|sources[\\/]media)|(?:lokal(?:e|en|er)?\s+(?:original|video|media)?datei)[\s\S]{0,180}(?:bereitstell|benötig|erforder|verlang)|(?:download|herunterlad)[\s\S]{0,120}(?:freigab|erlaub|notwendig|erforder)|(?:install|paket|abhängig)[\s\S]{0,160}(?:numpy|opencv|pytest|requirements-video)|(?:numpy|opencv|pytest|requirements-video)[\s\S]{0,160}(?:install|paket|abhängig)/iu
const NEGATED_LOCAL_REQUIREMENT = /(?:\bkein(?:e|en|er|es)?\b|\bohne\b|\bnicht\b[\s\S]{0,80}(?:notwendig|erforder|benötig)|\b(?:darf|dürfen|soll|sollen|wird|werden)\s+nicht\b|\bnicht\s+(?:erlaubt|freigegeben|genehmigt)\b|\bausgeschlossen\b|\bunzulässig\b|\bverboten\b|\bharte\s+ausschlüsse\b)/iu
const EXPLICIT_OVERRIDE = /(?:benutzer|nutzer)[\s\S]{0,100}(?:hat|erteilte|erteilt)[\s\S]{0,100}(?:download|lokale\s+(?:kopie|datei))[\s\S]{0,80}(?:erlaubt|freigegeben|genehmigt)/iu

function containsAffirmativeLocalMediaRequirement(result: string) {
  return result
    .split(/(?:[.!?;]\s+|[\r\n]+|,\s*)/u)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => (
      LOCAL_MEDIA_REQUIREMENT.test(clause) &&
      !NEGATED_LOCAL_REQUIREMENT.test(clause)
    ))
}

export function workflowConstraintViolation(result: string) {
  if (!BROWSER_ONLY_CONSTRAINT.test(result)) return ''
  if (!containsAffirmativeLocalMediaRequirement(result)) return ''
  if (EXPLICIT_OVERRIDE.test(result)) return ''
  return 'Der Ergebnistext widerspricht einer verbindlichen Browsergrenze: Browserwiedergabe ohne Download oder lokale Kopie darf nicht in eine lokale Datei-, Download- oder Installationsvoraussetzung umgedeutet werden.'
}
