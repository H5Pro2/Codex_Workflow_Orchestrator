# Codex Workflow Orchestrator

Lokale Weboberfläche zur Einrichtung und Steuerung von Codex-Agenten als Workflow. Ein Agent entspricht dabei einem Codex-Chat innerhalb eines Projekts. Der Orchestrator speichert Rollen, Prompt-Dateien, Statusregeln und die Verdrahtung zwischen Agenten.

Das Projekt unterstützt die MCM-Feldforschung und -entwicklung von Mini_DIO. Arbeitsabläufe sollen sich aus Forschungsfortschritt, Ergebnissen und nachvollziehbaren Statussignalen organisch weiterentwickeln.

## Funktionsstand

- Liest lokale Codex-Projekte und Codex-Chats über den lokalen Codex-App-Server ein.
- Zeigt nur die Chats des aktuell gewählten Projekts als Agenten an.
- Erstellt, benennt und archiviert verknüpfte Codex-Chats über den lokalen Connector.
- Bietet für jeden Agenten einen Betriebs-Chat sowie ein separates Setup.
- Speichert mehrere Prompt-Dateien pro Agent unter `.codex-orchestrator/prompts/` im jeweiligen Projekt.
- Übergibt nur veränderte Prompt-Dateien an Codex und verlangt vor der Übergabe eine Bestätigung.
- Bietet eine individuelle Workflow-Verdrahtung pro Agent mit In- und Out-Anschlüssen.
- Startet Workflows über einen Initial-Baustein.
- Leitet Ergebnisse anhand projektweiter Workflow-Status weiter.
- Unterstützt frei definierbare Status mit Name und Bedeutung, einschließlich der Grundstatus `Fertig` und `Weiterleitung`.
- Erzwingt bei Initial, Prompt-Übergabe, direkter Chat-Anweisung und automatischer Weitergabe ein JSON-Abschlussformat mit `workflow_status`.
- Erfasst Laufstatus, Dauer, Ereignisprotokoll und Codex-Ausführungen.
- Speichert die lokale Orchestrator-Konfiguration in `server/orchestrator-state.json`.

## Workflow-Prinzip

Ein typischer Ablauf besteht aus folgenden Bausteinen:

```text
Initial -> CEO -> Statusfilter "Weiterleitung" -> Entwicklung
```

1. Der Initial-Baustein sendet seine Startanweisung an den direkt am `Out` verbundenen Agenten.
2. Der Agent bearbeitet die Aufgabe in seinem Codex-Chat.
3. Die Antwort enthält am Ende ein maschinenlesbares Ergebnis, beispielsweise:

```json
{
  "status": "fertig",
  "kurzfassung": "Aufgabe abgeschlossen.",
  "naechste_aufgabe": "Ergebnis prüfen.",
  "weitergabe_an": "Entwicklung",
  "workflow_status": ["Weiterleitung"]
}
```

4. Ein Statusfilter leitet nur Ergebnisse weiter, deren `workflow_status` dem ausgewählten Status entspricht.
5. Die nächste Verbindung bestimmt den Empfänger der Übergabe.

Der Statusname muss exakt einem Eintrag der projektweiten Statusliste entsprechen. Bei keinem passenden Status antwortet ein Agent mit `"workflow_status": []`.

## Status und Weiterleitung

Ein Status ist kein zusätzlicher Chat und keine eigene Aufgabe. Er beschreibt, **wie** der nächste Schritt behandelt werden soll. Die Bedeutung wird einmal projektweit hinterlegt und kann im Agenten-Setup gezielt für jeden Agenten ein- oder ausgeschaltet werden.

Beispiel für zwei unterschiedliche Wege vom Programmierer zum Entwickler:

```text
Programmierer -> Statusfilter "Weiterleitung" -> Entwickler
Programmierer -> Statusfilter "Überarbeiten" -> Entwickler
```

- **Weiterleitung:** Das Ergebnis ist regulär und der Entwickler übernimmt die nächste fachliche Aufgabe.
- **Überarbeiten:** Das Ergebnis braucht eine gezielte Prüfung oder Korrektur. Der Entwickler erhält dieselbe Übergabe, aber zusätzlich die Bedeutung des Status `Überarbeiten` und arbeitet deshalb als Nachbearbeitung weiter.

Beide Pfade dürfen zum selben Agenten führen. Entscheidend ist der `workflow_status` am **Ende** der Antwort. Der Agent gibt genau den Status aus, der zu seinem Ergebnis passt, zum Beispiel `Weiterleitung` für einen normalen Abschluss oder `Überarbeiten`, wenn etwas erneut geprüft werden muss.

Statusfilter routen ausschließlich passende Ergebnisse. Ein Ergebnis mit `Weiterleitung` läuft nicht über einen Filter für `Überarbeiten` und umgekehrt. Dadurch können auch später mehrere Spezialwege ergänzt werden, etwa zur Analyse, Qualitätssicherung oder zurück zu einem Entscheidungsagenten.

## Bedienung

- **Projekt wählen:** Oben ein Codex-Projekt auswählen. Die Agentenübersicht zeigt nur dessen Chats.
- **Agenten-Chat:** Direkte Anweisungen im Chat eingeben und an den verknüpften Codex-Chat senden.
- **Setup:** Über das Zahnradsymbol Rollen, Modell, Prompt-Dateien, Statusliste und die Workflow-Verdrahtung bearbeiten.
- **Workflow-Dashboard:** Agenten aus der linken Übersicht hineinziehen und `Out` mit `In` verbinden.
- **Initial:** Im Tools-Menü einen Startbaustein hinzufügen und mit dem ersten Agenten verbinden.
- **Status:** Einen Statusfilter hinzufügen, Status auswählen und zwischen Agenten verbinden.
- **Konfiguration:** Bausteine und Linien mit Doppelklick öffnen. Einfache Klicks dienen nur der Auswahl oder dem Verschieben.
- **Anordnen:** Ordnet die Verdrahtung nach der Flussrichtung an, damit Statuspfade möglichst ohne Kreuzungen verlaufen.

## Voraussetzungen

- Windows
- Node.js mit `npm`
- Eine lokale, angemeldete Codex-Installation. Der Connector verwendet das mitgelieferte Paket `@openai/codex` und dessen App-Server.

## Start

Die einfachste Variante ist ein Doppelklick auf:

```text
start.bat
```

Die Datei startet den Connector auf Port `4317` sowie die Weboberfläche auf Port `5173` und öffnet anschließend:

```text
http://127.0.0.1:5173/
```

Alternativ:

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

Die Build-Ausgabe liegt in `dist/`. Lokale Laufzeitdaten und Token- bzw. Chat-Zustände werden nicht versioniert.

## Wichtige Grenzen

- Der Orchestrator kommuniziert über den lokalen Codex-App-Server. Er ist keine Cloud-Synchronisation zwischen mehreren Rechnern.
- Änderungen werden im Orchestrator und über den Connector gespeichert; die Darstellung in einer bereits geöffneten Codex-Desktopansicht kann von deren eigener Aktualisierung abhängen.
- Ein Agent wird nur automatisch weitergeleitet, wenn sein Ergebnis ein passendes, gültiges `workflow_status`-Signal enthält und der entsprechende Statusfilter verbunden ist.

## Projektstruktur

```text
src/                 React-Oberfläche und Workflow-Logik
server/bridge.mjs    Lokaler Connector zum Codex-App-Server
start.bat            Windows-Startskript
```

## Nächster Schwerpunkt

Für Mini_DIO sollte als Nächstes ein reproduzierbarer Forschungsworkflow mit klaren Statuspfaden eingerichtet werden, zum Beispiel `Weiterleitung` zur Entwicklung und `überarbeiten` zurück zur Analyse.
