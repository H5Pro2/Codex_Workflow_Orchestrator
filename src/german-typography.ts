const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ausschliess/gi, 'ausschließ'],
  [/eigenstaend/gi, 'eigenständ'],
  [/vollstaend/gi, 'vollständ'],
  [/hinzufueg/gi, 'hinzufüg'],
  [/ausfuehr/gi, 'ausführ'],
  [/zusaetz/gi, 'zusätz'],
  [/verfueg/gi, 'verfüg'],
  [/zurueck/gi, 'zurück'],
  [/schliess/gi, 'schließ'],
  [/ueber/gi, 'über'],
  [/pruef/gi, 'prüf'],
  [/frueh/gi, 'früh'],
  [/fuer/gi, 'für'],
  [/unguelt/gi, 'ungült'],
  [/benoet/gi, 'benöt'],
  [/naechst/gi, 'nächst'],
  [/aender/gi, 'änder'],
  [/waehl/gi, 'wähl'],
  [/koenn/gi, 'könn'],
  [/duerf/gi, 'dürf'],
  [/waehr/gi, 'währ'],
  [/spaet/gi, 'spät'],
  [/aeusser/gi, 'äußer'],
  [/oeffn/gi, 'öffn'],
  [/hoechst/gi, 'höchst'],
  [/moeglich/gi, 'möglich'],
  [/loesch/gi, 'lösch'],
]

function matchCase(source: string, replacement: string) {
  if (source === source.toLocaleUpperCase('de-DE')) return replacement.toLocaleUpperCase('de-DE')
  if (source[0] === source[0]?.toLocaleUpperCase('de-DE')) {
    return replacement[0].toLocaleUpperCase('de-DE') + replacement.slice(1)
  }
  return replacement
}

export function normalizeGermanTypography(value: string) {
  return REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, (match) => matchCase(match, replacement)),
    value,
  )
}
