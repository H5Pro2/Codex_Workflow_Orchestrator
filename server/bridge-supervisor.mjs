import { spawn } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const BRIDGE_FILE = join(SERVER_DIR, 'bridge.mjs')
const LOG_DIR = join(SERVER_DIR, 'logs')
const LOG_FILE = join(LOG_DIR, 'bridge-supervisor.log')
const PORT = Number(process.env.CODEX_BRIDGE_PORT || 4317)
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`
const HEALTH_INTERVAL_MS = 10_000
const RESTART_DELAY_MS = 2_000
const MAX_HEALTH_FAILURES = 3

let bridge = null
let stopping = false
let healthFailures = 0
let restartTimer = null

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  process.stdout.write(line)
  try {
    await mkdir(LOG_DIR, { recursive: true })
    await appendFile(LOG_FILE, line, 'utf8')
  } catch (error) {
    process.stderr.write(`Bridge-Protokoll konnte nicht geschrieben werden: ${error.message}\n`)
  }
}

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(4_000) })
    if (!response.ok) return false
    const payload = await response.json()
    return payload?.online === true
  } catch {
    return false
  }
}

function scheduleRestart(reason) {
  if (stopping || restartTimer || bridge) return
  void log(`${reason} Neustart in ${RESTART_DELAY_MS / 1000} Sekunden.`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    startBridge()
  }, RESTART_DELAY_MS)
}

function startBridge() {
  if (stopping || bridge) return

  void log('Codex-Connector wird gestartet.')
  const child = spawn(process.execPath, [BRIDGE_FILE], {
    cwd: join(SERVER_DIR, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  bridge = child

  child.stdout.on('data', (chunk) => void log(`[Bridge] ${String(chunk).trimEnd()}`))
  child.stderr.on('data', (chunk) => void log(`[Bridge-Fehler] ${String(chunk).trimEnd()}`))
  child.on('error', (error) => void log(`Connector-Prozessfehler: ${error.message}`))
  child.on('exit', (code, signal) => {
    if (bridge === child) bridge = null
    healthFailures = 0
    if (!stopping) {
      scheduleRestart(`Codex-Connector wurde beendet (Code ${code ?? '-'}, Signal ${signal ?? '-'}).`)
    }
  })
}

async function checkHealth() {
  if (stopping) return
  if (await isHealthy()) {
    healthFailures = 0
    return
  }

  healthFailures += 1
  if (!bridge) {
    scheduleRestart('Kein erreichbarer Codex-Connector.')
    return
  }
  if (healthFailures < MAX_HEALTH_FAILURES) return

  await log(`Health-Check ${healthFailures} Mal fehlgeschlagen. Connector wird kontrolliert neu gestartet.`)
  healthFailures = 0
  bridge.kill()
}

async function start() {
  if (await isHealthy()) {
    await log('Vorhandener Codex-Connector erkannt; Überwachung ist aktiv.')
  } else {
    startBridge()
  }
  setInterval(() => void checkHealth(), HEALTH_INTERVAL_MS).unref()
}

function shutdown(signal) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  void log(`Bridge-Supervisor wird beendet (${signal}).`)
  bridge?.kill()
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (error) => {
  void log(`Supervisor-Fehler: ${error.stack || error.message}`)
})
process.on('unhandledRejection', (error) => {
  void log(`Unbehandelte Supervisor-Ablehnung: ${error instanceof Error ? error.stack : String(error)}`)
})

await start()
