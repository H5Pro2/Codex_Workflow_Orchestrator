export function fixedForwardingHandoffInstruction() {
  return [
    'Verbindliche Regel für diese feste Weiterleitung:',
    'Diese Agent-zu-Agent-Übergabe ist ein autorisierter Workflow-Auftrag und keine unverbindliche Empfehlung.',
    'Ein im Ergebnis konkret benannter nächster Schritt gilt für den Zielagenten als beauftragt, sofern er zu dessen Rolle und den bestehenden Benutzergrenzen passt.',
    'Verlange dafür keine zweite Freigabe durch den Benutzer und wiederhole nicht lediglich den erhaltenen Stillstandstext.',
    'Ist deine Rolle prüfend, entscheide eindeutig: Gib den nächsten Schritt als ausführbaren Auftrag frei oder lehne ihn mit Begründung ab und formuliere einen korrigierten ausführbaren Auftrag.',
    'Ist deine Rolle ausführend, bearbeite den vom vorherigen Agenten freigegebenen konkreten Auftrag direkt.',
    'Warte nur dann auf den Benutzer, wenn wirklich eine Handlung oder Information benötigt wird, die kein Agent leisten darf oder kann, zum Beispiel eine physische Handlung, Zugangsdaten, eine Sicherheitsentscheidung oder eine irreversible Freigabe.',
    'Wenn eine Benutzerentscheidung erforderlich ist, benenne genau eine konkrete Frage oder einen exakten Bestätigungsbefehl. Andernfalls muss die fachliche Arbeit fortgesetzt werden.',
  ].join('\n')
}
