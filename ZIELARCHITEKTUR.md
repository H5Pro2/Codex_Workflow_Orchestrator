# Zielarchitektur: Kommunikationsbrücke für Codex-Chats

**Status:** Verbindliche Zielarchitektur

**Geltungsbereich:** Codex Workflow Orchestrator innerhalb eines ausgewählten Codex-Projekts

## 1. Ziel

Der Orchestrator ist eine lokale Kommunikationsbrücke zwischen bestehenden Codex-Chats eines Projekts.

Die fachliche Arbeit, die Unterhaltung mit dem Benutzer und der vollständige Kontext bleiben im jeweiligen Codex-Chat. Der Orchestrator verwaltet ausschließlich Zuordnung, Verbindung, Übergabe und Laufzustand.

## 2. Verantwortungsgrenzen

### Codex-Chat

Der Codex-Chat ist die fachliche Arbeitsfläche des Agenten. Dort finden statt:

- fachliche Analyse und Forschung
- Programmierung und Dateiarbeit
- Tests und Auswertung
- Rückfragen und Antworten des Benutzers
- vollständiger Gesprächskontext

### Orchestrator

Der Orchestrator ist die Schaltzentrale. Er verwaltet:

- Codex-Projekte und zugehörige Chats
- Agenten-Zuordnung und Rollenmetadaten
- Prompt-Dateien und Agentenoptionen
- Wissensquellen mit ausschließlich lesendem Zugriff
- Dashboards, Statusfilter und Verbindungen
- Übergabe von Nachrichten zwischen Chats
- Start, Stopp und Wiederaufnahme von Abläufen
- Kontrollpunkte, Fehlerzustände und Ereignisprotokoll
- Benutzer-Popups für echte Rückfragen oder Bestätigungen

## 3. Was ausdrücklich entfällt

Der Orchestrator soll keinen zweiten fachlichen Chat bilden. Daher werden Chat-Funktionen schrittweise entfernt oder auf die Bridge reduziert:

- kein eigener vollständiger Chatverlauf als zweite Quelle
- kein paralleler fachlicher Gesprächskontext
- keine normale manuelle Chat-Unterhaltung im Orchestrator
- keine fachliche Antworterzeugung im Orchestrator
- keine automatische Übertragung gewöhnlicher Benutzerunterhaltungen
- keine doppelte Anzeige derselben Codex-Nachrichten, sofern der Codex-Chat geöffnet werden kann

Eine kompakte technische Aktivitäts- und Übergabeanzeige bleibt zulässig. Sie zeigt nur Zustand, Ziel, Fehler und Zeitpunkt, nicht den vollständigen Chat als Ersatzoberfläche.

## 4. Projekt- und Chat-Synchronisierung

Der ausgewählte Codex-Projektordner ist die führende Projektgrenze.

Beim Laden eines Projekts muss der Orchestrator:

1. die im Codex-Projekt vorhandenen Chats einlesen,
2. bereits zugewiesene Chats wiedererkennen,
3. neue oder nachträglich verschobene Chats anzeigen,
4. Chats nur nach ausdrücklicher Benutzerzuordnung als Agenten übernehmen,
5. keine fremden Projekt-Chats in das ausgewählte Projekt mischen.

Ein Chat darf nicht automatisch überschrieben, archiviert, umbenannt oder neu erstellt werden. Neue Chats werden nur auf ausdrückliche Benutzeraktion erzeugt.

## 5. Agenten-Setup

Die folgenden Einstellungen bleiben erhalten:

- Name und Rolle
- Prompt-Dateien und Versionen
- Modell
- Projektpfad und Codex-Projektzuordnung
- erlaubter Webzugriff
- lesender Zugriff auf das Projektwissen
- zugewiesene Workflow-Status
- automatische Weitergabe
- Agenten-Typ Fachagent oder Verwaltungsagent

Diese Einstellungen beschreiben den Agenten. Sie ersetzen nicht die fachliche Unterhaltung im Codex-Chat.

## 6. Kommunikationsmodell

Der Orchestrator sendet nur klar definierte technische Übergaben an Codex-Chats.

Eine Übergabe enthält mindestens:

- Quellagent und Zielagent
- Projektpfad
- Anlass oder Status
- konkretes Ergebnis oder Arbeitsauftrag
- bekannte Grenzen
- erwartetes Ergebnis
- Verifikationskriterien

Eine gewöhnliche Benutzerunterhaltung bleibt im aktuellen Codex-Chat. Sie wird nur weitergegeben, wenn der Benutzer oder der Workflow dies ausdrücklich verlangt.

## 7. Workflow-Regeln

- Ein Initialbaustein startet ausschließlich den Agenten seines Dashboards.
- Der Initialbaustein enthält Ablaufanweisungen, keine fachliche Projektaufgabe.
- Die nächste Weitergabe erfolgt erst nach der abgeschlossenen Antwort des Dashboard-Agenten.
- Statusweiterleitungen verwenden nur vorhandene und verbundene Statuswege.
- Die feste Weiterleitung darf keine Diagnose ohne ausführbaren Auftrag weiterreichen.
- Bei fehlendem Arbeitsobjekt, fehlender Aufgabe oder fehlendem Erfolgskriterium pausiert der Ablauf.
- Ein pausierter Ablauf speichert das letzte Ergebnis als Kontrollpunkt.
- Ein Neustart nimmt zuerst einen passenden Kontrollpunkt wieder auf.
- Ein neuer Initiallauf startet nur, wenn kein passender Kontrollpunkt vorhanden ist.
- Eine echte Benutzerfrage pausiert den Ablauf und öffnet ein Popup.

## 8. Laufzustand und Wiederaufnahme

Der Orchestrator hält nur den technischen Laufzustand vor:

- laufender Turn
- Quellagent
- Zielagent oder noch unbestimmtes Ziel
- letztes Ergebnis
- Status und Statuszuweisung
- Kontrollpunkt
- Fehler- oder Rückfragestatus

Der fachliche Inhalt bleibt im Codex-Chat. Der Kontrollpunkt verhindert, dass ein Startsignal nach einem Stopp den bereits abgeschlossenen Stand unnötig erneut ausführt.

## 9. Bridge-Schnittstelle

Die Bridge ist die einzige technische Verbindung zwischen Orchestrator und Codex-Chats.

Sie ist zuständig für:

- Projekt- und Chat-Liste
- Chat-Zuordnung
- Senden eines Übergabeturns
- Auslesen des Ergebnisses eines Turns
- Unterbrechen eines Turns beim vollständigen Workflow-Reset
- Erkennen von Thread-Ersetzungen
- projektbezogene Ausführungsgrenzen
- technische Fehler und Wiederholbarkeit

Die Bridge darf keine fachliche Entscheidung treffen. Sie führt nur die vom Orchestrator bestätigte technische Operation aus.

## 10. Nicht-Ziele

Der Orchestrator wird nicht zu:

- einem zweiten LLM-Chat
- einem eigenständigen Forschungsagenten
- einem Dateieditor für fachliche Änderungen
- einem Ersatz für Codex-Projekte
- einer globalen Wissensdatenbank mit Schreibrechten für Agenten
- einem automatischen Teamgenerator ohne Benutzerauftrag

## 11. Umbau in Stufen

### Stufe 1: Kommunikationskern stabilisieren

- Projekt- und Chat-Synchronisierung prüfen
- Übergaben, Kontrollpunkte und Wiederaufnahme stabilisieren
- doppelte Übergaben verhindern
- Popup- und Rückfragenformat vereinheitlichen

### Stufe 2: Chat-Oberfläche zurückbauen

- vollständige Chatdarstellung aus dem Orchestrator entfernen
- manuelle Chat-Eingabe entfernen
- technische Übergabe- und Statusansicht beibehalten
- Verweis oder Öffnen des zugehörigen Codex-Chats anbieten

### Stufe 3: Bridge-Verträge festigen

- Übergabeformat versionieren
- Projekt- und Thread-Zuordnung eindeutig machen
- Fehlerzustände maschinenlesbar protokollieren
- Ende-zu-Ende-Tests für Start, Stopp, Wiederaufnahme und Fehlübergabe ergänzen

### Stufe 4: Bereinigung

- nicht mehr benötigte Chat-State-Logik entfernen
- doppelte Polling- und Nachrichtenpfade entfernen
- README und UI-Bezeichnungen an die Kommunikationsbrücken-Rolle anpassen

## 12. Abnahmekriterien

Die Zielarchitektur gilt als erreicht, wenn:

- ein Codex-Projekt seine vorhandenen Chats zuverlässig im Orchestrator abbildet,
- ein Chat nur einem Projekt und höchstens einem Agenten eindeutig zugeordnet ist,
- eine Übergabe genau einen vorgesehenen Zielpfad ausführt,
- gewöhnliche Benutzerunterhaltungen nicht ungefragt weitergegeben werden,
- ein Stopp keinen abgeschlossenen Arbeitsstand verliert,
- ein Neustart zuerst den Kontrollpunkt fortsetzt,
- fehlende Arbeitsaufträge keine Endlosschleife erzeugen,
- Benutzerfragen sichtbar als Popup erscheinen,
- fachliche Arbeit ausschließlich im Codex-Chat stattfindet,
- der Orchestrator als technische Kommunikationsbrücke verständlich und testbar bleibt.

## 13. Umsetzungsstand

Die erste Umbauphase ist umgesetzt:

- Die sichtbare Chat-Historie und die manuelle Nachrichteneingabe wurden aus der Agenten-Arbeitsfläche entfernt.
- Die Arbeitsfläche zeigt jetzt ausschließlich den Kommunikationsstatus, Workflow-Status, Laufzeit, Rückfragen und geänderte Dateien.
- Codex bleibt der Ort für Unterhaltung, Facharbeit und vollständigen Kontext.
- Die interne Codex-Abfrage bleibt vorerst für Synchronisierung, Teamplan-Erkennung und technische Übergaben bestehen. Sie ist keine zweite Chat-Oberfläche.
- Der bestehende Bridge-, Start-, Stopp-, Kontrollpunkt- und Wiederaufnahme-Pfad bleibt erhalten und ist durch den UI-Smoke-Test abgedeckt.

Die nächste technische Bereinigung entfernt die verbliebene interne Chat-Kompatibilitätslogik, sobald Teamplan-Erkennung und Übergabestatus vollständig auf strukturierte Bridge-Ergebnisse umgestellt sind.
