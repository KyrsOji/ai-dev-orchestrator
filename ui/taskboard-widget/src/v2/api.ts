export async function fetchTasks() {
  const res = await fetch('/taskboard/api/tasks')
  if (!res.ok) throw new Error('Failed to fetch tasks')
  return res.json()
}

export async function fetchFollowups() {
  const res = await fetch('/taskboard/api/followups')
  if (!res.ok) throw new Error('Failed to fetch followups')
  return res.json()
}

export async function fetchRunnerStatus() {
  const res = await fetch('/taskboard/api/runner-status')
  if (!res.ok) throw new Error('Failed to fetch runner status')
  return res.json()
}

export async function fetchAgents() {
  const res = await fetch('/taskboard/api/agents')
  if (!res.ok) throw new Error('Failed to fetch agents')
  const body = await res.json()
  let list: any[] = []
  if (Array.isArray(body)) list = body
  else if (Array.isArray(body.agents)) list = body.agents
  else list = []

  const now = Date.now()
  const normalized = list.map((a: any) => {
    const agentId = a.agentId || a.id || ''
    const hostname = a.hostname || a.host || ''
    const roles = Array.isArray(a.roles) ? a.roles : (a.roles ? [a.roles] : [])
    const status = a.status || 'unknown'
    const cpuCount = typeof a.cpuCount === 'number' ? a.cpuCount : (typeof a.cpu === 'number' ? a.cpu : 0)
    const memoryGb = typeof a.memoryGb === 'number' ? a.memoryGb : (typeof a.memory_gb === 'number' ? a.memory_gb : null)
    const diskFreeGb = typeof a.diskFreeGb === 'number' ? a.diskFreeGb : (typeof a.disk_free_gb === 'number' ? a.disk_free_gb : null)
    const loadAverage = typeof a.loadAverage === 'number' ? a.loadAverage : (typeof a.load_avg === 'number' ? a.load_avg : null)
    const lastSeen = a.lastSeen || a.last_seen || null
    let freshnessSeconds: number | null = null
    let isFresh = false
    if (lastSeen) {
      const t = new Date(lastSeen).getTime()
      if (!Number.isNaN(t)) {
        freshnessSeconds = Math.floor((now - t) / 1000)
        isFresh = freshnessSeconds <= 300
      }
    }
    return {
      agentId,
      id: agentId,
      hostname,
      roles,
      status,
      cpuCount,
      memoryGb,
      diskFreeGb,
      loadAverage,
      lastSeen,
      freshnessSeconds,
      isFresh,
      raw: a,
    }
  })

  normalized.sort((A: any, B: any) => {
    if ((A.isFresh ? 1 : 0) !== (B.isFresh ? 1 : 0)) return (A.isFresh ? -1 : 1)
    const aIdle = (A.status === 'idle') ? 1 : 0
    const bIdle = (B.status === 'idle') ? 1 : 0
    if (aIdle !== bIdle) return (bIdle - aIdle)
    return String(A.agentId || '').localeCompare(String(B.agentId || ''))
  })

  return normalized
}
