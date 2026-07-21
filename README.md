# Codex Workflow Orchestrator

Der Codex Workflow Orchestrator ist eine lokale Weboberfläche, mit der sich Codex-Chats als Agenten zu einem kontrollierten Workflow verbinden lassen.

Ein Agent entspricht einem Codex-Chat innerhalb eines Projekts. Für jeden Agenten können Rolle, Modell, Prompt-Dateien, Statusregeln und Verbindungen getrennt verwaltet werden. Ergebnisse werden über den lokalen Codex-Connector gelesen und abhängig vom Workflow an den nächsten Agenten übergeben.

Das Projekt unterstützt die MCM-Feldforschung und -entwicklung von Mini_DIO. Ziel ist eine nachvollziehbare, organische Weiterentwicklung aus Forschungsergebnissen, Erfahrung und klaren Signalen: eine praktische Form von „Feldintelligenz“.

## Was das Programm kann

### Projekte und Codex-Chats

- Liest lokale Codex-Projekte und deren Chats über den Codex-App-Server ein.
- Zeigt in der Agentenübersicht nur die Chats des aktuell ausgewählten Projekts.
- Übernimmt Umbenennungen von Codex-Chats in die Agentenübersicht.
- Erstellt neue Agenten beziehungsweise Codex-Chats über den lokalen Connector.
- Archiviert gelöschte Agenten und hält die Orchestrator-Daten mit dem Codex-Projekt synchron.
- Speichert das zuletzt ausgewählte Projekt.

### Agenten

Für jeden Agenten gibt es:

- einen eigenen Codex-Chat für direkte Nachrichten,
- ein separates Setup für Name, Rolle und Modell,
- eine eigene Workflow-Verdrahtung,
- einen eigenen Status- und Prompt-Kontext,
- Laufstatus, Dauer und Aktivitätsanzeige.

Die Verdrahtung eines Agenten ist nicht global. Jeder Agent besitzt sein eigenes Dashboard und seine eigenen gespeicherten Positionen und Verbindungen.

### Prompt-Dateien

Ein Agent kann mehrere Prompt-Dateien verwalten. Jede Datei besitzt einen Namen, einen Inhalt und einen Pfad im Projekt, zum Beispiel:

```text
.codex-orchestrator/prompts/<agent-id>/Anweisung.md
.codex-orchestrator/prompts/<agent-id>/Projektliste.md
```

Über `P` wird das Prompt-Fenster geöffnet. Dort kann eine Datei ausgewählt, bearbeitet, erstellt und umbenannt werden. Beim Speichern wird die Datei nur dann an den Codex-Chat übergeben, wenn sich ihr Inhalt tatsächlich geändert hat. Vor der Übergabe erscheint eine Bestätigung.

### Workflow-Dashboard

Über `D` wird das Workflow-Dashboard als separates Fenster geöffnet. Dort können Agenten und Workflow-Bausteine miteinander verbunden werden:

```text
Initial -> CEO -> Statusfilter -> Entwickler
```

Die Anschlüsse sind eindeutig:

- `In` ist der Eingang eines Bausteins.
- `Out` ist der Ausgang eines Bausteins.
- Eine Verbindung verläuft immer von `Out` zu `In`.

Das Dashboard unterstützt:

- Agenten per Drag-and-drop hinzufügen,
- Agenten individuell verdrahten,
- Initial-Bausteine für den Workflow-Start,
- Statusfilter für bedingte Weiterleitungen,
- Stopp-Bausteine zum kontrollierten Beenden eines Pfades,
- automatische Anordnung der Bausteine,
- Auswahl, Verschieben und Löschen von Verbindungen.

Bausteine werden per Doppelklick konfiguriert. Ein einfacher Klick wählt einen Baustein oder eine Verbindung aus. Agenten in der linken Übersicht werden dagegen nur per einfachem Klick ausgewählt.

### Initial-Baustein

Der Initial-Baustein startet einen Ablauf. Er wird mit seinem `Out`-Anschluss an den `In`-Anschluss des ersten Agenten verbunden. Beim Start der Automatik wird die hinterlegte Startanweisung an diesen Agenten gesendet.

Beispiel:

```text
Initial -> CEO
```

Der CEO erhält dann die Startanweisung, verarbeitet sie in seinem Codex-Chat und gibt sein Ergebnis gemäß der weiteren Verdrahtung weiter.

### Workflow-Status

Statussignale steuern die Weiterleitung. Die projektweite Statusliste enthält einen Statusnamen und seine Bedeutung, zum Beispiel:

| Status | Bedeutung |
| --- | --- |
| `Fertig` | Der aktuelle Lauf ist abgeschlossen. |
| `Weiterleitung` | Das Ergebnis soll an den nächsten Agenten übergeben werden. |
| `Überarbeiten` | Das Ergebnis muss erneut geprüft oder korrigiert werden. |

Eigene Status können im Setup ergänzt, bearbeitet und gelöscht werden. Die Bedeutung wird den Agenten als Kontext erklärt. Im Prompt muss daher nicht jedes Mal die vollständige Beschreibung wiederholt werden.

Ein Statusfilter prüft ein Ergebnis auf einen ausgewählten Status. Nur passende Ergebnisse passieren diesen Baustein:

```text
Programmierer -> Statusfilter „Weiterleitung“ -> Entwickler
Programmierer -> Statusfilter „Überarbeiten“ -> Entwickler
```

Beide Wege können zum selben Agenten führen, obwohl sie unterschiedliche Arbeitsschritte auslösen.

### Abschlussformat und Weitergabe

Damit die Automatik zuverlässig arbeiten kann, muss der Agent am Ende seiner Antwort ein maschinenlesbares Ergebnis liefern. Das Signal steht am Ende der Antwort, nicht am Anfang. Ein Beispiel:

```json
{
  "status": "fertig",
  "kurzfassung": "Die Aufgabe wurde abgeschlossen.",
  "naechste_aufgabe": "Das Ergebnis prüfen.",
  "weitergabe_an": "Entwickler",
  "workflow_status": ["Weiterleitung"]
}
```

Wichtig:

- `status` beschreibt den Abschluss des aktuellen Codex-Laufs.
- `workflow_status` beschreibt die gewünschte Workflow-Route.
- Ein Statusfilter verwendet den Wert aus `workflow_status`.
- Die Weitergabe erfolgt nur, wenn Automatik aktiv ist, ein passender Statusfilter verbunden ist und ein gültiges Signal erkannt wurde.
- Ohne passenden Status bleibt das Ergebnis im aktuellen Agenten.

Die Oberfläche trennt deshalb die Rückmeldung `Fertig` von der Workflow-Entscheidung `Weiterleitung` oder `Überarbeiten`. Ein Agent kann fertig mit seiner aktuellen Aufgabe sein und trotzdem über einen Workflow-Status den nächsten Schritt auslösen.

## Automatik und Offline-Modus

`Automatik starten` aktiviert Initial-Anfragen, Ergebnisüberwachung und automatische Weitergaben. Während die Automatik läuft, werden aktive Agenten und laufende Verbindungen visuell angezeigt.

Nach `Automatik stoppen` gilt:

- keine Initial-Anfragen,
- keine automatische Weitergabe,
- keine weitere Workflow-Kommunikation zwischen Agenten,
- keine animierten Verbindungen,
- direkte Chat-Nachrichten und manuelle Prompt-Übergaben bleiben möglich.

Die Automatik wird im lokalen Zustand gespeichert und bleibt beim Neuladen erhalten.

## Bedienung

1. Oben ein Codex-Projekt auswählen.
2. Einen vorhandenen Agenten auswählen oder über `+ Agent` einen neuen Codex-Chat anlegen.
3. Mit `P` die Prompt-Dateien verwalten.
4. Mit dem Zahnrad das Agenten-Setup öffnen.
5. Mit `D` das individuelle Workflow-Dashboard öffnen.
6. Agenten und Bausteine verbinden: immer `Out` zu `In`.
7. Einen Initial-Baustein mit dem ersten Agenten verbinden.
8. Statusfilter für die gewünschten Weiterleitungswege konfigurieren.
9. `Automatik starten` drücken und den Ablauf im Chat und Ereignisprotokoll verfolgen.

Das Ereignisprotokoll zeigt unter anderem Chat-Nachrichten, Übergaben, empfangene Ergebnisse, Statusfilter, Fehler und gestoppte Pfade. Der Bereich kann eingeklappt werden, damit der Chat mehr Platz erhält.

## Voraussetzungen

- Windows
- Node.js mit `npm`
- eine lokal angemeldete Codex-Installation
- Zugriff des lokalen Connectors auf den Codex-App-Server

Der Connector verwendet das mitgelieferte Paket `@openai/codex`. Es ist keine zusätzliche OpenAI-API-Abrechnung für die lokale Connector-Kommunikation erforderlich; die Nutzung richtet sich nach der vorhandenen Codex-Installation und deren Konto.

## Start

Am einfachsten ist ein Doppelklick auf:

```text
start.bat
```

Das Startskript:

1. installiert fehlende Abhängigkeiten,
2. startet den lokalen Connector auf Port `4317`,
3. startet die Weboberfläche auf Port `5173`,
4. öffnet anschließend:

```text
http://127.0.0.1:5173/
```

Alternativ kann die Anwendung manuell gestartet werden:

```powershell
npm install
npm run bridge
npm run dev -- --host 127.0.0.1
```

## Entwicklung und Prüfung

```powershell
npm run lint
npm run build
```

Die Produktionsausgabe liegt in `dist/`. Lokale Zustände, Token und Chatdaten werden nicht versioniert.

## Architektur

```text
React/Vite-Weboberfläche
        |
        v
Lokaler Connector auf Port 4317
        |
        v
Codex-App-Server
        |
        v
Codex-Projekte und Codex-Chats
```

Wichtige Bereiche:

```text
src/                 React-Oberfläche und Workflow-Logik
server/bridge.mjs    Lokaler Connector zum Codex-App-Server
start.bat            Windows-Startskript
```

Die Konfiguration wird lokal im Orchestrator-Zustand gespeichert. Prompt-Dateien werden projektbezogen unter `.codex-orchestrator/prompts/` geführt.

## Grenzen

- Der Orchestrator arbeitet über den lokalen Codex-App-Server und ist keine Cloud-Synchronisation zwischen mehreren Rechnern.
- Bereits geöffnete Codex-Ansichten können ihre eigene Aktualisierung benötigen, obwohl der Connector die Änderung bereits übernommen hat.
- Automatische Weitergabe funktioniert nur mit einem gültigen Abschlussformat, einem passenden Workflow-Status und einer verbundenen Zielroute.
- Der Orchestrator entscheidet nicht selbst über den fachlichen Inhalt. Die Agenten müssen weiterhin mit sinnvollen Rollen und Arbeitsanweisungen eingerichtet werden.

## Nächster Schwerpunkt für Mini_DIO

Als nächster reproduzierbarer Test sollte ein vollständiger Mini_DIO-Forschungsworkflow eingerichtet werden:

```text
Initial -> Analyse -> Entwicklung -> Fertig
                    \-> Überarbeiten -> Analyse
```

Dabei sollte geprüft werden, ob jedes Ergebnis den richtigen Workflow-Status am Ende ausgibt und ob die Rückroute zur weiteren Feldforschung nachvollziehbar dokumentiert wird.
