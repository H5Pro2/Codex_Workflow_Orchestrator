type VerifiedPromptInstruction = {
  path: string
  sha256: string
  content: string
}

export function verifiedPromptInstruction({ path, sha256, content }: VerifiedPromptInstruction) {
  return [
    `Serverseitig verifizierte Prompt-Kopie: \`${path}\``,
    `SHA-256: \`${sha256}\``,
    'Die folgende eingebettete Rollen-Anweisung ist die Ausführungsgrundlage dieses Auftrags.',
    'Die Datei ist ihre persistente, inhaltsgleiche Prüffassung. Kannst du die Datei nicht lesen, arbeite mit dem eingebetteten Inhalt weiter und melde den Dateizugriff lediglich als technischen Diagnosehinweis.',
    '<orchestrator_role_instruction>',
    content,
    '</orchestrator_role_instruction>',
  ].join('\n')
}
