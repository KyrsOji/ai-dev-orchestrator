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

export async function postDecision(decisionPayload: any) {
  const headers: any = { 'Content-Type': 'application/json' }
  let token: any = null
  try {
    if (typeof window !== 'undefined') {
      token = (window as any).__TASKBOARD_API_TOKEN || (window.localStorage ? window.localStorage.getItem('taskboard_standalone_token') : null)
    }
  } catch (e) { token = null }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/taskboard/api/task/decision', {
    method: 'POST',
    headers,
    body: JSON.stringify(decisionPayload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Decision dispatch failed: ${res.status} ${res.statusText} ${text}`)
  }
  try { return await res.json() } catch (e) { return { ok: true } }
}


export async function dispatchDecision(task: any, selectedAction?: any) {
  // Build the selected object from either provided selectedAction or the task
  let selectedObj: any = null
  try {
    if (selectedAction) {
      if (typeof selectedAction === 'string') {
        selectedObj = (Array.isArray(task && task.proposedActions) ? task.proposedActions.find((a: any) => a.id === selectedAction) : null) || selectedAction
      } else {
        selectedObj = selectedAction
      }
    } else if (task && task.selectedAction) {
      if (typeof task.selectedAction === 'string') {
        selectedObj = (Array.isArray(task.proposedActions) ? task.proposedActions.find((a: any) => a.id === task.selectedAction) : null) || task.selectedAction
      } else {
        selectedObj = task.selectedAction
      }
    }
  } catch (e) {
    selectedObj = null
  }

  if (!selectedObj) {
    throw new Error('No selected action to dispatch')
  }

  const decisionPayload: any = {
    taskId: task && task.taskId,
    decision: 'approved',
    policy: (selectedObj && selectedObj.type) || null,
    selectedAction: selectedObj || (task && task.selectedAction) || null,
    editedAction: null,
    newAction: null,
    notes: null,
    source: 'taskboard-ui',
    createdAt: new Date().toISOString(),
  }

  return await postDecision(decisionPayload)
}


export async function pollTaskUntilExecution(taskId: string | null, opts: { intervalMs?: number; timeoutMs?: number } = {}) {
  const intervalMs = opts.intervalMs || 2000
  const timeoutMs = opts.timeoutMs || 60000
  if (!taskId) return null
  const start = Date.now()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  while (Date.now() - start < timeoutMs) {
    try {
      const tasks = await fetchTasks()
      if (Array.isArray(tasks)) {
        const t = tasks.find((x: any) => x && x.taskId === taskId)
        if (t) {
          const exec = t.executionReport || t.execution || t.execution_report || null
          const hasExec = !!exec || (t.status && ['running', 'completed', 'failed'].includes(String(t.status)))
          if (hasExec) return t
        }
      }
    } catch (e) {
      // ignore transient errors and continue polling
    }
    await sleep(intervalMs)
  }
  return null
}
