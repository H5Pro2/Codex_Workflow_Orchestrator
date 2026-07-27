export function manualInstructionSupersedesCheckpoints(instruction: string) {
  const normalized = instruction.trim().toLocaleLowerCase('de-DE')
  if (!normalized) return true
  const asksOnlyForStatusReset = /\bstatus(?:meldung)?\b/.test(normalized) &&
    /\b(zurücksetzen|zurückgesetzt|resetten|reset|löschen|lösche|entfernen|entferne)\b/.test(normalized)
  return !asksOnlyForStatusReset
}
