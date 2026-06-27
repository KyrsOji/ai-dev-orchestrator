export function safeText(value: any): string {
  if (value === null || value === undefined) return ''
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return String(value)
  if (Array.isArray(value)) {
    try { return JSON.stringify(value) } catch (e) { return String(value) }
  }
  if (t === 'object') {
    try {
      if (value.description != null) return String(value.description)
      if (value.title != null) return String(value.title)
      if (value.id != null) return String(value.id)
      return JSON.stringify(value)
    } catch (e) {
      try { return String(value) } catch (ee) { return '' }
    }
  }
  try { return String(value) } catch (e) { return '' }
}
