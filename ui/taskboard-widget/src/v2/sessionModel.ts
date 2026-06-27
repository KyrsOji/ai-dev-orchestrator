// sessionModel.ts
// Helpers to normalize legacy task model into sessions and operate on sessions.

function nowISO() { return new Date().toISOString() }

function genSessionId(prefix = 'sess-') { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,8) }

export function determineSessionStage(session: any): string {
  if (!session) return 'Conversation'
  try {
    const exec = session.executionReport || null
    const execStatus = exec && (exec.status || exec.executionStatus || exec.state) ? String(exec.status || exec.executionStatus || exec.state).toLowerCase() : ''
    if (exec && (exec.completedAt || exec.finishedAt || (execStatus && ['completed','success','finished','executed'].includes(execStatus)))) return 'Complete'
    if (exec && (exec.status && String(exec.status).toLowerCase() === 'running')) return 'Running'
    if (session.dispatched && (session.dispatched === true || session.dispatchedAt)) return 'Dispatched'
    if (session.approval && session.approval.value === true) return 'Reviewed'
    if (session.reviewDecision && Array.isArray(session.reviewDecision.proposals) && session.reviewDecision.proposals.length > 0) return 'Decision'
  } catch (e) {}
  return 'Conversation'
}

export function normalizeTaskSessions(task: any): any {
  if (!task) return task
  // If already normalized, ensure certain fields and return
  if (Array.isArray(task.sessions)) {
    const sessions = task.sessions.map((s: any) => ({ ...s }))
    const activeSessionId = task.activeSessionId || (sessions.length ? sessions[sessions.length - 1].sessionId : null)
    const active = sessions.find((s: any) => s && s.sessionId === activeSessionId) || (sessions.length ? sessions[sessions.length - 1] : null)
    const copy: any = { ...task, sessions, activeSessionId }
    // Compatibility top-level fields point to active session
    if (active) {
      try {
        copy.proposedActions = (active.reviewDecision && active.reviewDecision.proposals) ? active.reviewDecision.proposals.slice() : (task.proposedActions ? task.proposedActions.slice() : [])
      } catch (e) { copy.proposedActions = task.proposedActions || [] }
      copy.selectedAction = (active.reviewDecision && active.reviewDecision.selectedActionId) ? active.reviewDecision.selectedActionId : (task.selectedAction || null)
      copy.executionReport = active.executionReport || task.executionReport || null
      copy.messages = active.messages || task.messages || []
    }
    return copy
  }

  // Legacy -> create sessions
  const sessions: any[] = []

  // If executionHistory is present, turn each item into an immutable session (older runs first)
  if (Array.isArray(task.executionHistory) && task.executionHistory.length) {
    for (let i = 0; i < task.executionHistory.length; i++) {
      const h = task.executionHistory[i]
      const s: any = {
        sessionId: h.id || genSessionId('hist-'),
        title: task.title || '',
        createdAt: h.startedAt || h.createdAt || h.execution_started_at || nowISO(),
        updatedAt: h.completedAt || h.updatedAt || nowISO(),
        prompt: null,
        messages: [],
        reviewDecision: { proposals: [] },
        selectedActionId: null,
        approval: null,
        dispatch: null,
        executionReport: h,
        artifacts: h.filesChanged || [],
        timeline: [],
        status: 'Complete',
        immutable: true
      }
      sessions.push(s)
    }
  }

  // Latest / current session derived from top-level fields
  const latest: any = {
    sessionId: task.activeSessionId || task.sessionId || genSessionId('sess-'),
    title: task.title || '',
    createdAt: task.createdAt || task.updatedAt || nowISO(),
    updatedAt: task.updatedAt || nowISO(),
    prompt: null,
    messages: Array.isArray(task.messages) ? task.messages.slice() : [],
    reviewDecision: { proposals: Array.isArray(task.proposedActions) ? task.proposedActions.slice() : [], selectedActionId: task.selectedAction || null },
    selectedActionId: task.selectedAction || null,
    approval: task.reviewerDecision ? { value: true, approver: task.reviewerDecision, approvedAt: nowISO() } : (task.reviewerSummary ? { value: true, approver: task.reviewerSummary, approvedAt: nowISO() } : null),
    dispatch: (task.dispatched || task.dispatchedAt) ? { value: true, dispatchedAt: task.dispatchedAt || nowISO() } : null,
    executionReport: task.executionReport || null,
    artifacts: [],
    timeline: [],
    status: determineSessionStage({ executionReport: task.executionReport, reviewDecision: { proposals: task.proposedActions || [] }, approval: task.reviewerDecision || null, dispatched: task.dispatched || false }),
    immutable: !!(task.completed || task.completedAt || (task.executionReport && (task.executionReport.completedAt || task.executionReport.updatedAt)))
  }

  sessions.push(latest)

  const activeSessionId = latest.sessionId

  // Build compatibility top-level fields
  const copy: any = { ...task, sessions, activeSessionId }
  copy.proposedActions = latest.reviewDecision && latest.reviewDecision.proposals ? latest.reviewDecision.proposals.slice() : (task.proposedActions || [])
  copy.selectedAction = latest.selectedActionId || task.selectedAction || null
  copy.executionReport = latest.executionReport || task.executionReport || null
  copy.messages = latest.messages || task.messages || []

  return copy
}

export function getActiveSession(task: any): any {
  if (!task) return null
  const normalized = normalizeTaskSessions(task)
  if (!Array.isArray(normalized.sessions) || normalized.sessions.length === 0) return null
  const aid = normalized.activeSessionId || (normalized.sessions[normalized.sessions.length - 1] && normalized.sessions[normalized.sessions.length - 1].sessionId)
  const active = normalized.sessions.find((s: any) => s && s.sessionId === aid) || normalized.sessions[normalized.sessions.length - 1]
  return active || null
}

export function addMessageToActiveSession(task: any, message: any): any {
  const normalized = normalizeTaskSessions(task)
  const sessions = Array.isArray(normalized.sessions) ? normalized.sessions.slice() : []
  const activeId = normalized.activeSessionId || (sessions.length ? sessions[sessions.length - 1].sessionId : null)
  let updated = { ...normalized }
  if (!activeId) {
    // create a new session
    const sess = { sessionId: genSessionId('sess-'), createdAt: nowISO(), updatedAt: nowISO(), title: task.title || '', messages: [message], reviewDecision: { proposals: [] }, selectedActionId: null, approval: null, dispatch: null, executionReport: null, artifacts: [], timeline: [], status: 'Conversation', immutable: false }
    updated.sessions = [...sessions, sess]
    updated.activeSessionId = sess.sessionId
  } else {
    updated.sessions = sessions.map((s: any) => {
      if (s.sessionId === activeId) {
        const msgs = Array.isArray(s.messages) ? s.messages.slice() : []
        msgs.push(message)
        return { ...s, messages: msgs, updatedAt: nowISO() }
      }
      return s
    })
  }
  // Update compatibility top-level
  const active = updated.sessions.find((s: any) => s.sessionId === updated.activeSessionId) || (updated.sessions.length ? updated.sessions[updated.sessions.length - 1] : null)
  if (active) {
    updated.proposedActions = (active.reviewDecision && active.reviewDecision.proposals) ? active.reviewDecision.proposals.slice() : []
    updated.selectedAction = active.selectedActionId || null
    updated.executionReport = active.executionReport || null
    updated.messages = active.messages || []
  }
  return updated
}

export function addDecisionToActiveSession(task: any, action: any): any {
  const normalized = normalizeTaskSessions(task)
  const sessions = Array.isArray(normalized.sessions) ? normalized.sessions.slice() : []
  const activeId = normalized.activeSessionId || (sessions.length ? sessions[sessions.length - 1].sessionId : null)
  let updated = { ...normalized }
  if (!activeId) {
    // create a session and add decision
    const sess: any = { sessionId: genSessionId('sess-'), createdAt: nowISO(), updatedAt: nowISO(), title: task.title || '', messages: [], reviewDecision: { proposals: [action], selectedActionId: action && action.id ? action.id : null }, selectedActionId: action && action.id ? action.id : null, approval: null, dispatch: null, executionReport: null, artifacts: [], timeline: [], status: 'Decision', immutable: false }
    updated.sessions = [...sessions, sess]
    updated.activeSessionId = sess.sessionId
  } else {
    updated.sessions = sessions.map((s: any) => {
      if (s.sessionId === activeId) {
        const proposals = (s.reviewDecision && Array.isArray(s.reviewDecision.proposals)) ? s.reviewDecision.proposals.slice() : []
        proposals.push(action)
        return { ...s, reviewDecision: { proposals, selectedActionId: action && action.id ? action.id : null }, selectedActionId: action && action.id ? action.id : null, updatedAt: nowISO() }
      }
      return s
    })
  }
  // compatibility
  const active = updated.sessions.find((s: any) => s.sessionId === updated.activeSessionId)
  if (active) {
    updated.proposedActions = active.reviewDecision && active.reviewDecision.proposals ? active.reviewDecision.proposals.slice() : []
    updated.selectedAction = active.selectedActionId || null
  }
  return updated
}

export function createFollowUpSession(task: any, message: any, action: any): any {
  const normalized = normalizeTaskSessions(task)
  const sessions = Array.isArray(normalized.sessions) ? normalized.sessions.slice() : []
  // mark previous active session immutable
  const prevActiveId = normalized.activeSessionId || (sessions.length ? sessions[sessions.length-1].sessionId : null)
  const newSession: any = {
    sessionId: genSessionId('sess-'),
    title: (action && action.description) ? String(action.description).slice(0, 120) : (task.title || 'Follow-up'),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    prompt: null,
    messages: message ? [message] : [],
    reviewDecision: { proposals: action ? [action] : [], selectedActionId: action && action.id ? action.id : null },
    selectedActionId: action && action.id ? action.id : null,
    approval: null,
    dispatch: null,
    executionReport: null,
    artifacts: [],
    timeline: [],
    status: 'Decision',
    immutable: false
  }

  const updatedSessions = sessions.map((s: any) => s && s.sessionId === prevActiveId ? ({ ...s, immutable: true }) : s)
  updatedSessions.push(newSession)
  const updated: any = { ...normalized, sessions: updatedSessions, activeSessionId: newSession.sessionId }
  // compatibility
  updated.proposedActions = newSession.reviewDecision && newSession.reviewDecision.proposals ? newSession.reviewDecision.proposals.slice() : []
  updated.selectedAction = newSession.selectedActionId || null
  updated.executionReport = newSession.executionReport || null
  updated.messages = newSession.messages || []
  return updated
}

export function attachExecutionReportToSession(task: any, report: any, sessionId?: string): any {
  const normalized = normalizeTaskSessions(task)
  const sessions = Array.isArray(normalized.sessions) ? normalized.sessions.slice() : []
  let updated = { ...normalized }
  let attached = false
  if (Array.isArray(sessions) && sessions.length) {
    // prefer explicit sessionId
    if (sessionId) {
      updated.sessions = sessions.map((s: any) => {
        if (s.sessionId === sessionId) {
          if (!s.executionReport) {
            attached = true
            return { ...s, executionReport: report, updatedAt: nowISO(), status: determineSessionStage({ executionReport: report }) }
          }
        }
        return s
      })
    }
    // try match by runId or similar
    if (!attached) {
      const runId = report && (report.runId || report.id || report.run_id)
      updated.sessions = sessions.map((s: any) => {
        if (!attached && (!s.executionReport || Object.keys(s.executionReport).length === 0)) {
          attached = true
          return { ...s, executionReport: report, updatedAt: nowISO(), status: determineSessionStage({ executionReport: report }) }
        }
        return s
      })
    }
  }

  if (!attached) {
    // create a synthetic session with the report
    const s: any = { sessionId: genSessionId('sess-'), title: task.title || 'Run', createdAt: nowISO(), updatedAt: nowISO(), messages: [], reviewDecision: { proposals: [] }, selectedActionId: null, approval: null, dispatch: null, executionReport: report, artifacts: [], timeline: [], status: determineSessionStage({ executionReport: report }), immutable: true }
    updated.sessions = [...sessions, s]
    updated.activeSessionId = s.sessionId
  }

  // compatibility
  const active = updated.sessions.find((s: any) => s.sessionId === updated.activeSessionId) || (updated.sessions.length ? updated.sessions[updated.sessions.length-1] : null)
  if (active) {
    updated.executionReport = active.executionReport || null
    updated.proposedActions = active.reviewDecision && active.reviewDecision.proposals ? active.reviewDecision.proposals.slice() : []
    updated.selectedAction = active.selectedActionId || null
    updated.messages = active.messages || []
  }

  return updated
}

export default {
  normalizeTaskSessions,
  getActiveSession,
  addMessageToActiveSession,
  addDecisionToActiveSession,
  createFollowUpSession,
  attachExecutionReportToSession,
  determineSessionStage
}
