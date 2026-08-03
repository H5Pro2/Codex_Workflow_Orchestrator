export function explicitAgentStatusIds(value: unknown, ..._legacyArgs: unknown[]) {
  const explicitIds = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    : []
  return Array.from(new Set(explicitIds))
}
