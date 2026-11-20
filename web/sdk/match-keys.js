/* Match keys for a node's template: its name, extends chain and resolved role (nearest wins). */

export function matchKeysFor(templateName, templatesByName) {
  const keys = []
  const seen = new Set()
  let role
  let current = templateName
  while (current && !seen.has(current)) {
    seen.add(current)
    keys.push(current)
    const template = templatesByName.get(current)
    if (!template) break
    if (role === undefined && typeof template.role === 'string') role = template.role
    current = template.extends
  }
  if (role !== undefined) keys.push(role)
  return keys
}
