# Codex Workflow Orchestrator

![Hauptansicht des Codex Workflow Orchestrators](bilder/Gui_Overlay.PNG)

Der Codex Workflow Orchestrator ist eine lokale Weboberfläche, mit der Codex-Chats als spezialisierte Agenten organisiert, verbunden und automatisiert ausgeführt werden können. Projekte, Chats, Rollen, Arbeitsanweisungen, Statusregeln und Workflow-Verbindungen werden an einer Stelle verwaltet.

## Funktionsumfang

- die in Codex gespeicherten Projekte und ihre zugehörigen Chats über den lokalen Connector einlesen
- Chats als Agenten übernehmen, erstellen, umbenennen, ausblenden und archivieren
- Rollen, Modelle und erlaubte Statusbefehle pro Agent konfigurieren
- Agenten als Fach- oder Verwaltungsagenten einteilen
- ausgewählte Agenten während der Automatik intervallgesteuert überwachen
- kontrollierte Team-Vorschläge eines Verwaltungsagenten prüfen und übernehmen
- mehrere Prompt-Dateien pro Agent verwalten
- direkte Nachrichten an einzelne Codex-Chats senden
- individuelle Workflows visuell aus Agenten und Werkzeugen aufbauen
- Ergebnisse anhand frei definierbarer Statusbefehle weiterleiten
- zeitgesteuerte Aufgaben einmalig oder wiederkehrend auslösen
- Laufstatus, Dauer, Chatverlauf und Ereignisprotokoll verfolgen
- die Bedienoberfläche zwischen Deutsch und Englisch umschalten

## Oberfläche

### Agenten-Chat

Die Hauptansicht kombiniert Projektauswahl, Agentenliste, laufenden Codex-Chat und Ablaufprotokoll. Eingaben können direkt an den ausgewählten Agenten gesendet werden. Aktivität, Laufzeit und letzter Zustand bleiben dabei sichtbar. Bei neuen Projekten ohne Agenten bleibt die Aufteilung mit einem neutralen leeren Chat-Bereich stabil.

### Agenten-Setup

Neue und aus Codex übernommene Agenten erhalten automatisch die Rolle `du bist <Name>`. Solange diese Vorgabe nicht individuell bearbeitet wurde, folgt sie einer Umbenennung des Agenten.

Im Setup werden Name, Rolle, Modell und die für den Agenten erlaubten Statusbefehle festgelegt. Die automatische Weitergabe kann pro Agent aktiviert oder deaktiviert werden. Über die Agenten-Zuweisung wird zusätzlich festgelegt, ob ein Agent normale Fachaufgaben übernimmt oder eine Verwaltungs-Erweiterung erhält.

![Agenten-Setup](bilder/Agenten_Setup.PNG)

### Verwaltungs-Erweiterung

Ein Verwaltungsagent kann andere Agenten desselben Projekts überwachen. Im Setup wird festgelegt, ob das ganze Team oder nur ausgewählte Agenten geprüft werden; zusätzlich lässt sich das Prüfintervall in Minuten einstellen. Bei der Team-Auswahl werden später hinzukommende Agenten automatisch einbezogen. Solange die Automatik läuft, erhält der Verwaltungsagent regelmäßig eine kompakte Übersicht aus Laufstatus, Anzahl abgeschlossener Läufe und letztem Ergebnis. Er bewertet daraus Blockaden, Widersprüche, Wiederholungen und sinnvolle nächste Schritte.

Die Überwachung startet keine eigenmächtigen Änderungen an Agenten, Prompt-Dateien oder Dashboard-Verbindungen. Der Verwaltungsagent liefert eine fachliche Bewertung und konkrete Empfehlungen; technische Änderungen bleiben beim Orchestrator und benötigen eine Benutzerfreigabe.

#### Kontrollierter Team-Aufbau

Ist der Team-Aufbau im Verwaltungs-Setup erlaubt, kann der Benutzer den Verwaltungsagenten im Chat ausdrücklich mit der Zusammenstellung eines Teams beauftragen. Der Agent liefert Namen, Rollen, vollständige Arbeitsanweisungen, benötigte Statusbefehle samt Bedeutung, deren Zuweisung zu den Agenten und gewünschte Verbindungen in einem validierbaren Team-Vorschlag. Die Oberfläche zeigt einen erkannten Vorschlag direkt im Agenten-Chat zur Prüfung und kontrollierten Übernahme an.

`Team übernehmen` führt ausschließlich bei `Auto Stop` folgende Schritte im aktuell ausgewählten Projekt aus:

- fehlende Codex-Chats mit einem neutralen Setup-Turn dauerhaft registrieren
- noch nicht vorhandene Statusbefehle projektweit anlegen
- Rollen und Statusbefehle zuweisen
- Arbeitsanweisungen als `Anweisung.md` speichern, ohne sie als Aufgabe zu starten
- vorgeschlagene Agenten im Dashboard des Verwaltungsagenten anordnen und verbinden

Während der Übernahme zeigt der Vorschlagsbereich den aktuell eingerichteten Agenten und einen rotierenden Fortschrittsindikator. Der Vorschlag verschwindet erst, wenn Agenten, Statusbefehle, Statuszuweisungen und Dashboard-Verbindungen vollständig vorhanden sind. Eine zuvor unterbrochene Übernahme kann ohne doppelte Agenten über `Einrichtung vervollständigen` repariert werden.

Der neutrale Setup-Turn bestätigt ausschließlich die dauerhafte Registrierung eines neuen Codex-Chats und löst keine Workflow-Weitergabe aus. Der Orchestrator startet danach weder die Automatik noch eine fachliche Aufgabe. `Auto Start` bleibt eine bewusste Benutzeraktion. Ein neues Projektverzeichnis wird nicht automatisch erzeugt, weil dessen Speicherort vom Benutzer beziehungsweise von Codex festgelegt werden muss.

Während ein Agent erstellt wird, bleibt der Dialog geöffnet und zeigt einen deutlich sichtbaren, rotierenden Einrichtungsstatus. Eingabe und Schaltflächen sind bis zur Bestätigung des neuen Codex-Chats gesperrt, damit keine doppelten Erstellungsaufträge entstehen.

Beim Löschen bestätigt der Benutzer den Vorgang in einem anwendungseigenen Dialog. Ein verknüpfter Codex-Chat wird anschließend archiviert und aus der aktiven Projektansicht entfernt.

### Prompt-Dateien

Jeder Agent kann mehrere Arbeitsanweisungen als Markdown-Dateien besitzen. Dateien lassen sich erstellen, auswählen, umbenennen und bearbeiten. `Speichern und übergeben` schreibt die Datei und sendet geänderte Inhalte nach Bestätigung an den zugeordneten Codex-Chat.

![Editor für Prompt-Dateien](bilder/Prompt_Overlay.PNG)

Die Dateien liegen projektbezogen unter:

```text
.codex-orchestrator/prompts/<agent-id>/<dateiname>.md
```

Unveränderte Inhalte werden nicht erneut versendet.

### Workflow-Dashboard

Jeder Agent besitzt eine eigene gespeicherte Verdrahtung. Verbindungen verlaufen immer vom Ausgang `Out` zum Eingang `In`. Agenten können aus der Seitenleiste in das Dashboard gezogen und dort mit Werkzeugen verbunden werden. Bausteine lassen sich frei und ohne Raster positionieren; nur die Aktion `A` ordnet sie automatisch an.

![Workflow-Dashboard mit mehreren Statusrouten](bilder/Workflow_Dashboard.PNG)

Die kompakten Aktionen im Dashboard sind:

- `A`: Bausteine automatisch anordnen
- `S`: Statusbefehle des Agenten bearbeiten
- `T`: Werkzeugpalette öffnen

### Statusauswahl

Über `S` werden die Statusbefehle festgelegt, die der jeweilige Agent verwenden darf. Name und Bedeutung stammen aus den projektweiten Statusbefehlen.

![Statusauswahl eines Agenten](bilder/Statusliste.PNG)

### Workflow-Werkzeuge

![Werkzeugpalette des Workflow-Dashboards](bilder/Tools.PNG)

| Werkzeug | Aufgabe |
| --- | --- |
| Initial | Sendet beim Start eine Anfangsanweisung an den verbundenen Agenten. |
| Status | Lässt nur Ergebnisse mit dem ausgewählten Statusbefehl passieren. |
| Stop | Beendet den Workflow-Pfad an dieser Stelle. |
| Zeitplan | Sendet eine Aufgabe einmalig, in einem Intervall oder zu einer festen Uhrzeit. |

Bausteine werden per Doppelklick konfiguriert. Ein einfacher Klick wählt einen Baustein oder eine Verbindung aus. Konfigurationsdialoge enthalten auch die jeweilige Löschfunktion.

## Statusbefehle

Statusbefehle werden projektweit unter `Statusbefehle` angelegt. Jeder Eintrag besteht aus einem Namen und einer eindeutigen Bedeutung. Im Agenten-Setup wird ausgewählt, welche Statusbefehle der Agent verwenden darf. Dadurch erhält der Agent die erlaubten Statusbefehle samt Beschreibung automatisch als Arbeitskontext.

![Projektweite Statusbefehle](bilder/Status_Setup.PNG)

Beispiel:

| Status | Bedeutung |
| --- | --- |
| `Weiterleitung` | Das Ergebnis soll an den nächsten Agenten übergeben werden. |
| `Überarbeiten` | Das Ergebnis muss erneut geprüft oder korrigiert werden. |

Der Agent gibt am Ende seiner Antwort einen passenden `workflow_status` aus. Ein Statusfilter vergleicht dieses Signal mit seiner Konfiguration und aktiviert nur den passenden Ausgangspfad.

```text
Agent -> Statusfilter "Weiterleitung" -> nächster Agent
      -> Statusfilter "Überarbeiten"  -> Prüfung oder Rückgabe
```

Statusbefehle beschreiben die Route des Ergebnisses. Der technische Abschluss eines einzelnen Codex-Laufs wird davon getrennt behandelt.

## Automatik

`Auto Start` aktiviert die Ausführung des verbundenen Workflows. Initial-Bausteine senden ihre Startanweisung, der Connector überwacht laufende Agenten und passende Ergebnisse werden entlang der Verdrahtung weitergegeben.

`Auto Stop` blockiert neue automatische Aktionen:

- keine neuen Initial-Anfragen
- keine neue Kommunikation zwischen Agenten
- keine Ausführung fälliger Zeitpläne
- keine neue automatische Weitergabe
- ruhende Verbindungsanimationen
- keine manuelle oder verwaltete Erstellung neuer Agenten

Ein Agent, der beim Stoppen bereits arbeitet, darf seinen laufenden Codex-Turn noch abschließen. Danach wird keine weitere Route gestartet. Direkte Chat-Nachrichten und manuelle Prompt-Übergaben bleiben auch bei ausgeschalteter Automatik verfügbar.

## Zeitpläne

Ein Zeitplan enthält eine Aufgabe und wird mit dem Zielagenten verbunden.

```text
Zeitplan -> Agent
```

Unterstützt werden:

- einmalige Ausführung
- wiederkehrende Intervalle in Minuten, Stunden, Tagen oder Wochen
- wiederkehrende Ausführung zu einer festen Uhrzeit
- einmalige Kalendertermine mit Datum und Uhrzeit

Zeitpläne werden nur ausgeführt, wenn der Baustein aktiviert ist und die Automatik läuft. Ist der Zielagent beschäftigt, wartet die Ausführung auf einen freien Zustand.

## Typischer Ablauf

1. Ein Codex-Projekt auswählen.
2. Vorhandene Chats in der Agenten-Übersicht aktivieren oder einen Agenten erstellen.
3. Rolle, Modell und erlaubte Statusbefehle im Agenten-Setup festlegen.
4. Über `P` eine oder mehrere Prompt-Dateien einrichten und übergeben.
5. Über `D` das Dashboard öffnen.
6. Agenten und Werkzeuge von `Out` nach `In` verbinden.
7. Bausteine konfigurieren und den Ablauf mit `Auto Start` auslösen.
8. Ergebnisse im Agenten-Chat und im einklappbaren Ereignisprotokoll verfolgen.

## Installation und Start

### Voraussetzungen

- Windows
- Node.js mit `npm`
- lokal angemeldete Codex-Installation
- Zugriff des Connectors auf den lokalen Codex-App-Server

Am einfachsten startet die Anwendung per Doppelklick auf:

```text
start.bat
```

Das Skript installiert fehlende Abhängigkeiten, startet den Connector auf Port `4317`, startet die Weboberfläche auf Port `5173` und öffnet anschließend:

```text
http://127.0.0.1:5173/
```

Alternativ:

```powershell
npm install
npm run bridge
npm run dev -- --host 127.0.0.1
```

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

Der Orchestrator-Zustand wird lokal gespeichert. Prompt-Dateien werden im jeweiligen Projekt unter `.codex-orchestrator/prompts/` verwaltet. Lokale Zustände, Zugangsdaten und Chatdaten werden nicht versioniert.

## Entwicklung und Prüfung

```powershell
npm run lint
npm run build
```

Die Produktionsausgabe wird unter `dist/` erzeugt.

## Bekannte Grenzen

- Bereits geöffnete Codex-Ansichten können eine eigene Aktualisierung benötigen, obwohl der Connector eine Änderung bereits verarbeitet hat.
- Automatische Routen benötigen ein auswertbares Ergebnis, einen passenden Statusbefehl und eine gültige Verbindung.
- Rollen, Arbeitsanweisungen und Statusbedeutungen müssen für den jeweiligen Ablauf eindeutig formuliert sein.
