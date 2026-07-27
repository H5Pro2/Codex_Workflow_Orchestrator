export function currentHandoffContextInstruction() {
  return [
    'Aktualitätsregel für diese Übergabe (verbindlich):',
    'Der nachfolgende Abschnitt "Ergebnis / Auftrag" ist der aktuelle und maßgebliche Eingang.',
    'Frühere Nachrichten im Codex-Chat dienen nur als Hintergrund und dürfen diesen Eingang nicht ersetzen.',
    'Greife keinen früheren Fehler, Status oder Themenbereich wieder auf, wenn der aktuelle Eingang ihn nicht ausdrücklich nennt.',
    'Behandle insbesondere einen technischen Laufabbruch ausschließlich als den dort beschriebenen Laufabbruch.',
  ].join('\n')
}
