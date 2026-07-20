@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"
title Codex Workflow Orchestrator

where node >nul 2>&1
if errorlevel 1 (
  echo Fehler: Node.js wurde nicht gefunden.
  echo Bitte Node.js installieren und diese Datei anschließend erneut starten.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Fehler: npm wurde nicht gefunden.
  echo Bitte die Node.js-Installation überprüfen.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Abhängigkeiten werden installiert...
  call npm.cmd install
  if errorlevel 1 (
    echo Fehler: Die Abhängigkeiten konnten nicht installiert werden.
    pause
    exit /b 1
  )
)

netstat -ano | findstr /R /C:":4317 .*LISTENING" >nul
if errorlevel 1 (
  echo Codex-Connector wird gestartet...
  start "Codex Orchestrator - Connector" /min cmd /k "cd /d ""%~dp0"" && npm.cmd run bridge"
) else (
  echo Codex-Connector läuft bereits.
)

netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if errorlevel 1 (
  echo Weboberfläche wird gestartet...
  start "Codex Orchestrator - Weboberfläche" /min cmd /k "cd /d ""%~dp0"" && npm.cmd run dev -- --host 127.0.0.1"
) else (
  echo Weboberfläche läuft bereits.
)

echo Browser wird geöffnet...
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173/"

endlocal
