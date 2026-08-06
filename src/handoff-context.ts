export function currentHandoffContextInstruction() {
  return [
    'Leseregel fuer diese Workflow-Weitergabe (verbindlich):',
    'Der Orchestrator kopiert keinen Ergebnistext in diese Nachricht.',
    'Lies die letzte abgeschlossene Antwort des genannten Quell-Agenten als aktuellen Eingang.',
    'Fruehere Nachrichten im eigenen Codex-Chat dienen nur als Hintergrund und duerfen die Quellantwort nicht ersetzen.',
    'Starte keine direkte Kommunikation mit anderen Codex-Chats; die naechste Weitergabe uebernimmt ausschliesslich die Workflow-Verdrahtung.',
  ].join('\n')
}
