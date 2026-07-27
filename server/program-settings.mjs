import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const THEMES = new Set(['system', 'light', 'dark'])
const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const MAX_FONT_LENGTH = 80
const MAX_NAME_LENGTH = 120

const DEFAULT_SETTINGS = Object.freeze({
  displayName: '',
  theme: 'dark',
  accentColor: '#72d6c9',
  backgroundColor: '#0b0b0c',
  foregroundColor: '#f2f2f3',
  buttonColor: '#19191b',
  buttonTextColor: '#f2f2f3',
  uiFont: 'Segoe UI Variable Text',
  codeFont: 'Cascadia Code',
  contrast: 60,
  showWorkflowStatusLines: false,
})

function normalizedColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback
}

export function normalizeProgramSettings(value) {
  const settings = value && typeof value === 'object' ? value : {}
  return {
    displayName: typeof settings.displayName === 'string'
      ? settings.displayName.slice(0, MAX_NAME_LENGTH)
      : DEFAULT_SETTINGS.displayName,
    theme: THEMES.has(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    accentColor: normalizedColor(settings.accentColor, DEFAULT_SETTINGS.accentColor),
    backgroundColor: normalizedColor(settings.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    foregroundColor: normalizedColor(settings.foregroundColor, DEFAULT_SETTINGS.foregroundColor),
    buttonColor: normalizedColor(settings.buttonColor, DEFAULT_SETTINGS.buttonColor),
    buttonTextColor: normalizedColor(settings.buttonTextColor, DEFAULT_SETTINGS.buttonTextColor),
    uiFont: typeof settings.uiFont === 'string' && settings.uiFont.trim()
      ? settings.uiFont.trim().slice(0, MAX_FONT_LENGTH)
      : DEFAULT_SETTINGS.uiFont,
    codeFont: typeof settings.codeFont === 'string' && settings.codeFont.trim()
      ? settings.codeFont.trim().slice(0, MAX_FONT_LENGTH)
      : DEFAULT_SETTINGS.codeFont,
    contrast: Math.min(100, Math.max(0, Number(settings.contrast ?? DEFAULT_SETTINGS.contrast))),
    showWorkflowStatusLines: typeof settings.showWorkflowStatusLines === 'boolean'
      ? settings.showWorkflowStatusLines
      : DEFAULT_SETTINGS.showWorkflowStatusLines,
  }
}

export function createProgramSettingsStore(filePath) {
  let writeTail = Promise.resolve()
  return {
    async read() {
      try {
        const stored = JSON.parse(await readFile(filePath, 'utf8'))
        return {
          settings: normalizeProgramSettings(stored.settings),
          updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
        }
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          return { settings: null, updatedAt: '' }
        }
        throw error
      }
    },
    async write(value) {
      const operation = writeTail.then(async () => {
        const settings = normalizeProgramSettings(value)
        const updatedAt = new Date().toISOString()
        const temporaryPath = `${filePath}.${process.pid}.tmp`
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(temporaryPath, `${JSON.stringify({ settings, updatedAt }, null, 2)}\n`, 'utf8')
        await rename(temporaryPath, filePath)
        return { settings, updatedAt }
      })
      writeTail = operation.then(() => undefined, () => undefined)
      return operation
    },
  }
}
