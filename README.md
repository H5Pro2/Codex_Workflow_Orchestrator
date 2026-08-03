# Codex Workflow Orchestrator

Lokale Weboberfläche zur Organisation von Codex-Chats als projektbezogene Agenten. Der Orchestrator verbindet vorhandene Codex-Tasks, verwaltet Rollen und Prompt-Dateien, zeigt die Agentenkommunikation und führt sichtbare Workflow-Dashboards aus.

Die Anwendung läuft lokal im Browser und spricht über eine lokale Bridge mit der Codex-App. Fachliche Arbeit bleibt in den Codex-Chats; der Orchestrator steuert Sichtbarkeit, Status, Übergaben, Laufzustand und Persistenz.

## Aktueller Schwerpunkt

Das Projekt ist ein Arbeitswerkzeug für manuell verdrahtete Agenten-Workflows. Automatisch erzeugte Topologien wurden bewusst zurückgefahren: Agenten, Bausteine und Verbindungen sollen sichtbar im Dashboard angelegt und kontrolliert werden.

Wichtige Prinzipien:

- Der Benutzer baut die Workflow-Logik im Dashboard.
- Textantworten von Agenten erzeugen keine neuen Verbindungen.
- Automatische Übergaben folgen nur gespeicherten Dashboard-Verbindungen.
- Stopp-Pfade sollen sichtbar über den `Stop`-Baustein modelliert werden.
- Status wie `Fertig` bleiben fachliche Agentensignale und sind getrennt vom technischen `Stop`-Baustein.
- Projektzustand, Layouts und offene Workflow-Kontrollpunkte werden lokal gespeichert.

## Hauptfunktionen

- Codex-Projekte und zugehörige Codex-Tasks über den lokalen Connector einlesen
- vorhandene Codex-Chats als Agenten übernehmen
- Agenten erstellen, umbenennen, archivieren und aus Dashboards entfernen
- Rollen, Arbeitsanweisungen, Webzugriff und Workflow-Status pro Agent verwalten
- mehrere Prompt-Dateien pro Agent speichern und gezielt an den Codex-Chat übergeben
- projektweite Wissensquellen und ein Projektziel verwalten
- direkte Benutzernachrichten an einzelne Agenten senden
- visuelle Workflows mit React Flow aufbauen
- Agenten, Start, Weiterleiten, Rücksprung, Stop und Zeitplan als Bausteine verbinden
- Workflow-Positionen und Layout-Muster speichern
- laufende Agenten im Dashboard farblich markieren
- Ereignisprotokoll, Arbeitslauf und offene Fortsetzungen anzeigen
- Deutsch/Englisch sowie Darstellungseinstellungen umschalten

## Bedienoberfläche

Die Oberfläche besteht aus drei Hauptbereichen:

- links: Projekt- und Agentenauswahl
- mitte: Kommunikationsbrücke zum ausgewählten Agenten
- rechts: Rollenfluss, Arbeitslauf und Ablaufprotokoll

Jeder Agent kann über `D` sein Workflow-Dashboard öffnen. Dort werden die für diesen Agenten oder das Projekt sichtbaren Bausteine angeordnet und verbunden.

Kompakte Dashboard-Aktionen:

- `+`: Agenten im Dashboard ein- oder ausblenden
- `A`: gespeichertes Layout-Muster anwenden, sonst automatisch anordnen
- `M`: aktuelles Layout-Muster speichern
- `T`: Werkzeugpalette öffnen
- `x`: Dashboard schließen

Beim Speichern eines Layout-Musters erscheint kurz `Gespeichert` im Dashboard-Feld. Es gibt keine dauerhafte Textanzeige im Header.

## Workflow-Bausteine

### Agent

Ein Agent entspricht einem Codex-Chat. Der Baustein besitzt `IN` und `OUT`.

Wenn ein Agent arbeitet, wird er im Dashboard als aktiver Schritt hervorgehoben. Das passiert auf Basis des echten Laufzustands: Ein Agent gilt als aktiv, wenn er läuft und ein offener Codex-Turn überwacht wird.

### Start

Der Start-Baustein sendet ein neutrales Startsignal an den Agenten des Dashboards. Pro Dashboard ist nur ein Start-Baustein vorgesehen.

Optional kann eine reine Ablaufanweisung hinterlegt werden. Fachliche Projektziele und Rollen-Prompts gehören nicht in den Start-Baustein.

### Weiterleiten

Der Weiterleiten-Baustein gibt ein Ergebnis sichtbar an den nächsten verbundenen Baustein oder Agenten weiter.

Der Baustein besitzt:

- `IN`
- normalen `OUT`
- optionalen Intervall-Ausgang
- Zusatzprompt für die nächste Übergabe
- Übergabeart
- Intervall-Quelle: kein Intervall, eigener Intervall oder Projekt-Läufe verwenden

Es gibt nur einen Weiterleiten-Baustein mit erweiterten Funktionen. Doppelte Varianten sollen nicht mehr existieren.

### Rücksprung

Der Rücksprung-Baustein bildet eine kurze sichtbare Verbindung für Schleifen ab, ohne lange Rückkanten über das ganze Dashboard ziehen zu müssen.

Der Baustein besitzt:

- `IN`
- `OUT`
- eine Zielagenten-Auswahl

Die ausgewählten Zielagenten lesen die Rücksprung-Nachricht. Zusätzlich kann der `OUT`-Ausgang sichtbar weiter verbunden werden, zum Beispiel zu `Stop` oder zu einem weiteren `Weiterleiten`-Baustein.

Damit sind beide Modelle möglich:

- Rücksprung nur zu Zielagenten
- Rücksprung plus expliziter weiterer Pfad

### Stop

Der Stop-Baustein beendet einen verbundenen Workflow-Pfad explizit. Er ist der sichtbare technische Stopp im Dashboard.

Fachliche Agentensignale wie `Fertig` bleiben davon getrennt. `Fertig` beschreibt das Ergebnis eines Agenten; `Stop` beschreibt das Ende eines verdrahteten Workflow-Pfads.

### Zeitplan

Ein Zeitplan startet eine Aufgabe zeitgesteuert, wenn die Automatik aktiv ist. Ziel, Aufgabe und Intervall werden im Zeitplan-Baustein konfiguriert.

Unterstützt werden:

- einmalige Ausführung
- wiederkehrende Intervalle
- wiederkehrende Ausführung zu einer festen Uhrzeit
- einmalige Termine mit Datum und Uhrzeit

## Workflow-Ausführung

`Auto Start` startet die Ausführung des sichtbaren Workflows. `Auto Stop` verhindert neue automatische Aktionen.

Bei aktivem Workflow:

- Start-Bausteine senden ihr Startsignal.
- Agentenergebnisse werden vom Connector überwacht.
- passende Ergebnisse werden über sichtbare Dashboard-Verbindungen weitergegeben.
- offene Übergaben werden als Kontrollpunkte gespeichert.
- parallele Übergaben an denselben Zielagenten werden serialisiert.
- Stop-Bausteine schließen den verbundenen Pfad eindeutig ab.

Bei ausgeschalteter Automatik:

- keine neuen Initial-Anfragen
- keine automatische Agenten-zu-Agenten-Übergabe
- keine faelligen Zeitplaene
- keine neue automatische Fortsetzung
- direkte Chat-Nachrichten bleiben möglich

Ein bereits laufender Codex-Turn darf nach `Auto Stop` noch fertig werden. Danach startet der Orchestrator keine neue automatische Route.

## Projekt-Läufe

Das Feld `Läufe` legt projektbezogen fest, wie viele komplette Workflow-Läufe ausgeführt werden sollen. Der Fortschritt wird als aktueller Lauf von Gesamtzahl angezeigt.

Layout, Laufjournal und Kontrollpunkte werden projektbezogen gespeichert. Dadurch sollen Browser-Neuladen und Connector-Neustarts nicht bei Lauf eins oder an falschen Positionen starten.

## Layout und Positionen

Bausteine können frei positioniert werden.

Positionen werden pro Dashboard und Node gespeichert. Das gilt auch für Rücksprung-Bausteine. Ein Cleanup entfernt nur noch Positionen wirklich nicht mehr vorhandener Bausteine.

`M` speichert das aktuelle Muster. `A` wendet ein vorhandenes Muster an; falls kein Muster vorhanden ist, wird automatisch angeordnet.

## Prompt-Dateien

Jeder Agent kann mehrere Markdown-Prompt-Dateien besitzen. Die Dateien liegen im Projekt unter:

```text
.codex-orchestrator/prompts/<agent-id>/<dateiname>.md
```

Beim Speichern und Übergeben wird die Datei serverseitig geschrieben, wieder gelesen und per SHA-256 geprüft. Der Codex-Chat erhält den vollständigen Prompt, den absoluten Pfad und den Prüfwert.

Beim Löschen eines Agenten können zugehörige Prompt-Verzeichnisse entfernt werden.

## Connector

Die Bridge läuft lokal auf Port `4317`. Sie verbindet die Weboberfläche mit dem Codex-App-Server.

Aufgaben der Bridge:

- Projekte und Tasks lesen
- Nachrichten an Codex-Chats senden
- laufende Turns überwachen
- Ergebnisse abrufen
- Prompt-Dateien schreiben und pruefen
- gemeinsamen Orchestrator-Zustand speichern
- lokale Programm- und Projektinformationen bereitstellen

Der gemeinsame Zustand schuetzt vor veralteten Browser-Tabs, die neuere Dashboard- oder Workflow-Daten überschreiben koennten.

## Installation und Start

Voraussetzungen:

- Windows
- Node.js mit `npm`
- lokal angemeldete Codex-App
- Zugriff auf den lokalen Codex-App-Server

Einfacher Start:

```text
start.bat
```

Manueller Start:

```powershell
npm install
npm run bridge
npm run dev -- --host 127.0.0.1
```

Danach im Browser öffnen:

```text
http://127.0.0.1:5173/
```

Direkter Bridge-Start ohne Supervisor:

```powershell
npm run bridge:direct
```

## Entwicklung

Wichtige Befehle:

```powershell
npm run build
npm run lint
npm test
```

Fokussierte Tests können direkt über Node gestartet werden, zum Beispiel:

```powershell
node --test src/workflow-routing.test.ts src/workflow-topology-audit.test.ts src/workflow-state.test.ts
```

Die Produktionsausgabe wird unter `dist/` erzeugt.

## Architektur

```text
React/Vite-Weboberfläche
        |
        v
Lokale Bridge auf Port 4317
        |
        v
Codex-App-Server
        |
        v
Codex-Projekte und Codex-Chats
```

Wichtige Dateien:

```text
src/App.tsx                   zentrale UI, Zustand und Workflow-Steuerung
src/App.css                   Layout und visuelle Darstellung
src/workflow-canvas.tsx       React-Flow-Knoten, Kanten und Verbindungslogik
src/workflow-routing.ts       technische Aufloesung von Zielpfaden
src/workflow-runtime.ts       Laufjournal und Kontrollpunkte
src/workflow-state.ts         Bereinigung gespeicherter Dashboard-Positionen
src/workflow-topology-audit.ts Validierung der sichtbaren Workflow-Topologie
src/pending-turn.ts           Erkennung laufender Agenten-Turns
server/bridge.mjs             lokaler Connector zur Codex-App
server/shared-state.mjs       persistenter gemeinsamer Orchestrator-Zustand
server/prompt-files.mjs       Schreiben und Prüfen von Prompt-Dateien
start.bat                     Windows-Startskript
```

## Testabdeckung

Die Tests pruefen unter anderem:

- Routing direkter Agentenverbindungen
- Weiterleiten mit und ohne Intervall
- Rücksprung zu einem oder mehreren Zielagenten
- Rücksprung mit explizitem `OUT` zu `Stop` oder `Weiterleiten`
- Stop-Pfade
- Topologiefehler und fehlende Ziele
- gespeicherte Dashboard-Positionen, inklusive Rücksprung-Bausteinen
- Workflow-Laufjournal und Kontrollpunkte
- Prompt-Dateien und Connector-Verhalten

## Bekannte Grenzen

- Die Oberfläche ist ein lokales Arbeitswerkzeug und kein Mehrbenutzer-System.
- Bereits geöffnete Codex-Ansichten können eine eigene Aktualisierung benoetigen.
- Agentenantworten müssen für automatische Weitergabe weiterhin zur sichtbaren Topologie passen.
- Alte Screenshots sind entfernt und müssen nach dem nächsten stabilen UI-Stand neu erstellt werden.
