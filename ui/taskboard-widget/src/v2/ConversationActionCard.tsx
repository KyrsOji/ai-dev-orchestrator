import React, { useState } from 'react'
import { safeText } from '../components/safeText'
import { determineStage } from './lifecycle'
import { dispatchDecision, pollTaskUntilExecution, postDecision } from './api'
import { normalizeTaskSessions, getActiveSession, addMessageToActiveSession, addDecisionToActiveSession, createFollowUpSession, determineSessionStage } from './sessionModel'

export default function ConversationActionCard({ task, onTaskUpdate, onRefresh }: any) {
  const [localDispatchError, setLocalDispatchError] = useState<string | null>(null)
  // Use whatever proposedActions are present on the task, or an empty array.
  // We want to render the action card even if there are no recommendations yet.
  const initialRecs = task && Array.isArray(task.proposedActions)
    ? task.proposedActions
    : []

  const [recs, setRecs] = useState<any[]>(initialRecs.slice())
  const [showForm, setShowForm] = useState(false)
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [selectedAction, setSelectedAction] = useState<any>(null)
  const [isDispatching, setIsDispatching] = useState(false)
  const [isPolling, setIsPolling] = useState(false)

  // Keep local recs in sync with incoming task prop (UI-only local state)
  React.useEffect(() => {
    const next = task && Array.isArray(task.proposedActions) ? task.proposedActions.slice() : []
    setRecs(next)
  }, [task && task.proposedActions])

  // Keep selectedAction in sync with task.selectedAction if provided
  React.useEffect(() => {
    try {
      if (task && task.selectedAction && Array.isArray(task.proposedActions)) {
        const found = task.proposedActions.find((a: any) => a.id === task.selectedAction)
        setSelectedAction(found || null)
      }
    } catch (e) {
      // ignore
    }
  }, [task && task.selectedAction, task && task.proposedActions])

  // Helper: determine whether dispatch can be performed (UI-level check)
  const canDispatch = (() => {
    try {
      if (selectedAction) return true
      if (task && task.selectedAction) return true
      if (Array.isArray(recs) && recs.length > 0) return true
      if (task && Array.isArray(task.proposedActions) && task.proposedActions.length > 0) return true
    } catch (e) {}
    return false
  })()
  // Compute lifecycle stage for conditional rendering
  const stage = determineStage(task)
  // Derived collections: separate follow-up recommendations from historical ones
  const allRecs = Array.isArray(task && task.proposedActions) ? task.proposedActions.slice() : []
  const followups = allRecs.filter((r: any) => r && r.followup)
  const historyRecs = allRecs.filter((r: any) => !(r && r.followup))

  // Execution history helpers: preserve prior executions in executionHistory
  const executionHistory = Array.isArray(task && task.executionHistory) ? task.executionHistory.slice() : []
  const currentExec = task && (task.executionReport || task.execution || task.execution_report) || null
  const priorExecToShow = executionHistory.length ? executionHistory[executionHistory.length - 1] : (currentExec || null)
  const hasPriorExecution = Boolean(priorExecToShow)




  function renderActionLabel(a: any) {
    if (a === null || a === undefined) return ''
    if (typeof a === 'string' || typeof a === 'number') return String(a)
    if (typeof a === 'object') {
      if (a.description != null) return String(a.description)
      if (a.title != null) return String(a.title)
      if (a.id != null) return String(a.id)
      return safeText(a)
    }
    return safeText(a)
  }

  function handleCreateRecommendation() {
    const newAction = {
      type: 'manual',
      id: 'custom-' + Date.now(),
      description: description,
      payload: { instructions },
    }

    // update local UI state immediately
    setRecs((prev) => [...prev, newAction])
    setSelectedAction(newAction)

    // Propagate the change to parent task state if callback provided
    try {
      const base = task || {}
      const msg = { id: 'msg-' + Date.now(), author: 'user', text: (instructions && instructions.length) ? instructions : (description || ''), createdAt: new Date().toISOString() }

      try {
        const normalized = normalizeTaskSessions(base)
        const active = getActiveSession(normalized)
        const stageLocal = determineSessionStage(active)
        let updatedTask: any = null
        if (stageLocal === 'Complete' || (active && active.immutable)) {
          updatedTask = createFollowUpSession(base, msg, newAction)
        } else {
          const withMsg = addMessageToActiveSession(base, msg)
          updatedTask = addDecisionToActiveSession(withMsg, newAction)
        }

        if (typeof onTaskUpdate === 'function') {
          onTaskUpdate(updatedTask)
        }
      } catch (e) {
        // fallback to legacy behavior
        const existingMessages = Array.isArray(base.messages) ? base.messages.slice() : []
        existingMessages.push(msg)
        const updatedTask: any = { ...base, messages: existingMessages, proposedActions: [...(Array.isArray(base.proposedActions) ? base.proposedActions : []), newAction], selectedAction: newAction.id, updatedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() }
        if (typeof onTaskUpdate === 'function') onTaskUpdate(updatedTask)
      }
    } catch (e) {
      // ignore and keep local-only state
    }

    // collapse editor and reset
    setShowForm(false)
    setDescription('')
    setInstructions('')
  }

  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid #eef2ff', boxShadow: '0 6px 18px #02061708' }}>
      <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 16 }}>Review Decisions</div>
      {/* Summary line: different when viewing a completed task or an active follow-up */}
      {(() => {
        if (stage === 'Complete' || (task && task.followUp && task.followUp.active)) {
          if (followups.length) return <div style={{ color: '#374151', marginBottom: 12 }}>{followups.length} follow-up decision{followups.length > 1 ? 's' : ''} pending</div>
          if (historyRecs.length) return <div style={{ color: '#374151', marginBottom: 12 }}>{historyRecs.length} recorded</div>
          return <div style={{ color: '#6b7280', marginBottom: 12 }}>No review decisions yet. Use the composer below to create one or continue the conversation.</div>
        }
        return recs.length ? (
          <div style={{ color: '#374151', marginBottom: 12 }}>{recs.length} suggested</div>
        ) : (
          <div style={{ color: '#6b7280', marginBottom: 12 }}>No review decisions yet. Use the composer below to create one or continue the conversation.</div>
        )
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(() => {
          // For completed tasks and active follow-ups we render history/followups inside the execution section below
          if (stage === 'Complete' || (task && task.followUp && task.followUp.active)) return null

          // Non-completed stages: render local recommendations
          const listToRender = recs
          if (!Array.isArray(listToRender) || listToRender.length === 0) return null

          return listToRender.map((r: any, i: number) => {
            const rid = (r && (r.id || String(i)))
            const selected = (() => {
              let currentSelId: any = null
              try {
                if (selectedAction) {
                  if (typeof selectedAction === 'string') currentSelId = selectedAction
                  else if (typeof selectedAction === 'object') currentSelId = (selectedAction && selectedAction.id) || null
                }
              } catch (e) { currentSelId = null }
              if (!currentSelId && Array.isArray(listToRender) && listToRender.length > 0) {
                currentSelId = listToRender[0] && (listToRender[0].id || String(0))
              }
              if (!currentSelId) return false
              return currentSelId === rid
            })()

            return (
              <div
                key={rid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: selected ? '#eef2ff' : 'transparent',
                  padding: 8,
                  borderRadius: 10,
                  cursor: 'pointer'
                }}
                onClick={() => {
                  try {
                    setSelectedAction(r)
                    // propagate selection to parent so Dispatch becomes enabled
                    if (typeof onTaskUpdate === 'function' && task) {
                      const base = task || {}
                      const updatedTask: any = { ...base, selectedAction: r && r.id ? r.id : r, updatedAt: new Date().toISOString() }
                      // If selecting a follow-up recommendation for a completed task, mark followUp active and status
                      try {
                        if (r && r.followup) {
                          updatedTask.status = 'followup'
                          updatedTask.followUp = { ...(base.followUp || {}), id: r.id, active: true, createdAt: (base.followUp && base.followUp.createdAt) || new Date().toISOString(), parentExecutionId: (base && (base.executionReport || base.execution || base.execution_report) && ((base.executionReport && (base.executionReport.id || base.executionReport.runId)) || (base.execution && (base.execution.id || base.execution.runId)) || null)) || null }
                        }
                      } catch (e) {}
                      onTaskUpdate(updatedTask)
                    }
                  } catch (e) {}
                }}
              >
                <input aria-label={`select recommendation ${i}`} type="radio" name={`selectedAction-${task && task.taskId || 'task'}`} checked={selected} readOnly />
                <div style={{ flex: 1, fontWeight: 600 }}>{renderActionLabel(r)}</div>
              </div>
            )
          })
        })()}
      </div>

      {/* Collapsed CTA */}
      {!showForm && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="small" onClick={() => setShowForm(true)} style={{ background: '#fff', border: '1px solid #e6eefc', padding: '6px 10px', borderRadius: 8, color: '#0f172a' }}>+ New Review Decision</button>
          <div style={{ flex: 1 }} />
        </div>
      )}

      {/* Expanded editor */}
      {showForm && (
        <div style={{ marginTop: 14 }}>
          <div style={{ padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e6eefc' }}>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 15 }}>Create Review Decision</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Decision Title</label>
              <input
                aria-label="recommendation title"
                placeholder="Short descriptive title"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e6eefc', fontSize: 14 }}
              />

              <label style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>Decision Instructions</label>
              <textarea
                aria-label="engineering instructions"
                placeholder={'Describe exactly what you want the engineering team to do.\nYou can override OpenHands recommendations.\n\nExamples:\n• Refactor reviewer/service.py\n• Add unit tests\n• Improve retry logic\n• Update documentation'}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e6eefc', minHeight: 110, fontSize: 14, lineHeight: '1.4' }}
              />

              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6, whiteSpace: 'pre-line' }}>
                Describe exactly what you want the engineering team to do.
                You can override OpenHands recommendations.

                Examples:
                • Refactor reviewer/service.py
                • Add unit tests
                • Improve retry logic
                • Update documentation
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="big" onClick={() => { setShowForm(false); setDescription(''); setInstructions('') }} style={{ background: '#f3f4f6', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Cancel</button>
                <button className="big" onClick={handleCreateRecommendation} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Create Review Decision</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* If there is a prior execution available, show it above the action bar (avoid duplicate when we're already in the completed UI) */}
      {hasPriorExecution && !(['Complete','Reviewed','Evidence'].includes(stage)) ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Completed Execution</div>
          <div style={{ padding: 8, borderRadius: 10, background: '#f8fafc', border: '1px solid #e6eefc' }}>
            {priorExecToShow && (priorExecToShow.returnCode || priorExecToShow.return_code || priorExecToShow.exitCode || priorExecToShow.exit_code || priorExecToShow.code || priorExecToShow.statusCode) ? (
              <div>Return code: <strong>{String(priorExecToShow.returnCode || priorExecToShow.return_code || priorExecToShow.exitCode || priorExecToShow.exit_code || priorExecToShow.code || priorExecToShow.statusCode)}</strong></div>
            ) : null}
            {priorExecToShow && (priorExecToShow.stdout || priorExecToShow.output || priorExecToShow.response || priorExecToShow.responsePreview) ? (
              <div style={{ marginTop: 8 }}><strong>Output</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(priorExecToShow.stdout || priorExecToShow.output || priorExecToShow.response || priorExecToShow.responsePreview).slice(0, 2000)}</pre></div>
            ) : null}
          </div>
        </div>
      ) : null}


      {/* Action bar: show/hide based on lifecycle stage */}
      {(() => {
        if (stage === 'Conversation') return null

        const completedStages = ['Complete', 'Reviewed', 'Evidence']
        const isCompleted = completedStages.includes(stage)

        async function handleDispatch() {
          if (isDispatching) return
          try {
            setIsDispatching(true)
            try { setLocalDispatchError(null) } catch (e) {}

            // Resolve candidate action to dispatch: prefer local selection, then task.selectedAction, then first recommendation
            let candidate: any = null
            try {
              if (selectedAction) {
                if (typeof selectedAction === 'string') {
                  candidate = (Array.isArray(task && task.proposedActions) ? task.proposedActions.find((a: any) => a.id === selectedAction) : null) || selectedAction
                } else {
                  candidate = selectedAction
                }
              } else if (task && task.selectedAction) {
                if (typeof task.selectedAction === 'string') {
                  candidate = (Array.isArray(task.proposedActions) ? task.proposedActions.find((a: any) => a.id === task.selectedAction) : null) || task.selectedAction
                } else {
                  candidate = task.selectedAction
                }
              } else if (Array.isArray(recs) && recs.length > 0) {
                candidate = recs[0]
              } else if (Array.isArray(task && task.proposedActions) && task.proposedActions.length > 0) {
                candidate = task.proposedActions[0]
              }
            } catch (e) { candidate = null }

            // Detect if this dispatch relates to a follow-up decision
            const isFollowupCandidate = Boolean((candidate && candidate.followup) || (task && String(task.status).toLowerCase() === 'followup') || (task && task.followUp && task.followUp.active && candidate && task.followUp.id === (candidate && (candidate.id || candidate))))

            await dispatchDecision(task, candidate)

            // Update task to dispatched on success
            try {
              const base = task || {}
              const updatedTask: any = { ...base, status: 'dispatched', dispatched: true, dispatchedAt: new Date().toISOString(), decision: 'approved', updatedAt: new Date().toISOString() }
              if (isFollowupCandidate) {
                try {
                  updatedTask.followUp = { ...(base.followUp || {}), id: (candidate && (candidate.id || candidate)) || ((base.followUp && base.followUp.id) || null), dispatchedAt: new Date().toISOString(), active: true }
                } catch (e) {}
              }
              if (typeof onTaskUpdate === 'function') {
                onTaskUpdate(updatedTask)
              }
            } catch (e) {}

            // optionally refresh once immediately
            try { if (typeof onRefresh === 'function') await onRefresh() } catch (e) {}

            // Start bounded polling for execution report: poll every 2s up to 60s
            setIsPolling(true)
            try {
              const updated = await pollTaskUntilExecution(task && task.taskId, { intervalMs: 2000, timeoutMs: 60000 })
              if (updated) {
                try {
                  // Preserve prior execution report into executionHistory when present
                  const base = task || {}
                  const prevExec = base && (base.executionReport || base.execution || base.execution_report) || null
                  const merged: any = { ...updated }
                  merged.executionHistory = Array.isArray(updated.executionHistory) ? updated.executionHistory.slice() : []
                  const baseHistory = Array.isArray(base.executionHistory) ? base.executionHistory.slice() : []
                  if (prevExec) {
                    const exists = merged.executionHistory.find((h: any) => (h && ((h.id && prevExec.id && h.id === prevExec.id) || (h.runId && prevExec.runId && h.runId === prevExec.runId) || JSON.stringify(h) === JSON.stringify(prevExec))))
                    if (!exists) {
                      merged.executionHistory = merged.executionHistory.concat(baseHistory.filter(Boolean))
                      merged.executionHistory.push(prevExec)
                    }
                  }
                  if (typeof onTaskUpdate === 'function') onTaskUpdate(merged)
                } catch (e) {
                  if (typeof onTaskUpdate === 'function') onTaskUpdate(updated)
                }
              } else {
                try { setLocalDispatchError('No execution evidence observed within 60 seconds') } catch (e) {}
              }
            } catch (e) {
              console.error('polling error', e)
            } finally {
              setIsPolling(false)
            }

          } catch (e: any) {
            console.error('dispatch error', e)
            try { setLocalDispatchError(e && e.message ? String(e.message) : 'Dispatch failed') } catch (e) {}
          } finally {
            setIsDispatching(false)
          }
        }

        async function handleReject(notes?: string) {
          try {
            try { setLocalDispatchError(null) } catch (e) {}

            // Build selectedObj similar to dispatch
            let selectedObj: any = null
            try {
              if (task && task.selectedAction) {
                if (typeof task.selectedAction === 'string') {
                  selectedObj = (Array.isArray(task.proposedActions) ? task.proposedActions.find((a: any) => a.id === task.selectedAction) : null) || null
                } else {
                  selectedObj = task.selectedAction
                }
              }
            } catch (e) { selectedObj = null }

            const decisionPayload: any = {
              taskId: task && task.taskId,
              decision: 'denied',
              policy: (selectedObj && selectedObj.type) || null,
              selectedAction: selectedObj || (task && task.selectedAction) || null,
              editedAction: null,
              newAction: null,
              notes: notes || null,
              source: 'taskboard-standalone',
              createdAt: new Date().toISOString(),
            }

            try {
              await postDecision(decisionPayload)

              // Update task to denied on success
              try {
                const base = task || {}
                const updatedTask = { ...base, status: 'denied', decision: 'denied', denied: true, deniedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                if (typeof onTaskUpdate === 'function') {
                  onTaskUpdate(updatedTask)
                } else {
                  try { if (task) { task.denied = true; task.status = 'denied'; task.decision = 'denied' } } catch (e) {}
                }
              } catch (e) {
                // ignore
              }

              // Optionally refresh tasks if parent provided onRefresh
              try {
                if (typeof onRefresh === 'function') {
                  await onRefresh()
                }
              } catch (e) {
                // ignore
              }
            } catch (e: any) {
              console.error('reject dispatch error', e)
              try { setLocalDispatchError(e && e.message ? String(e.message) : 'Reject failed') } catch (e) {}
              setTimeout(() => { try { setLocalDispatchError(null) } catch (e) {} }, 5000)
            }
          } catch (e) {
            console.error('reject handler error', e)
          }
        }

        if (isCompleted) {
          const exec = task && (task.executionReport || task.execution || task.execution_report) || null
          const returnCode = exec && (exec.returnCode || exec.return_code || exec.exitCode || exec.exit_code || exec.code || exec.statusCode) || null
          const stdout = exec && (exec.stdout || exec.output || exec.response || exec.responsePreview || exec.response_preview) || null

          return (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Execution completed</div>

              <div style={{ padding: 8, borderRadius: 10, background: '#f8fafc', border: '1px solid #e6eefc' }}>
                {returnCode !== null ? <div>Return code: <strong>{String(returnCode)}</strong></div> : null}
                {stdout ? <div style={{ marginTop: 8 }}><strong>Output</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(stdout).slice(0, 2000)}</pre></div> : null}
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Review Decisions (history)</div>
                {historyRecs.length ? historyRecs.map((r: any, i: number) => {
                  const rid = (r && (r.id || String(i)))
                  const selectedId = task && task.selectedAction ? (typeof task.selectedAction === 'string' ? task.selectedAction : (task.selectedAction && task.selectedAction.id)) : null
                  const isSelected = selectedId === rid
                  return (
                    <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 12, background: isSelected ? '#eef2ff' : 'transparent', padding: 8, borderRadius: 10, cursor: 'pointer' }} onClick={() => {
                      try {
                        setSelectedAction(r)
                        if (typeof onTaskUpdate === 'function' && task) {
                          const base = task || {}
                          const updatedTask: any = { ...base, selectedAction: r && r.id ? r.id : r, updatedAt: new Date().toISOString() }
                          // If selecting a historical follow-up, mark followUp active and status
                          try {
                            if (r && r.followup) {
                              updatedTask.status = 'followup'
                              updatedTask.followUp = { ...(base.followUp || {}), id: r.id, active: true, createdAt: (base.followUp && base.followUp.createdAt) || new Date().toISOString(), parentExecutionId: (base && (base.executionReport || base.execution || base.execution_report) && ((base.executionReport && (base.executionReport.id || base.executionReport.runId)) || (base.execution && (base.execution.id || base.execution.runId)) || null)) || null }
                            }
                          } catch (e) {}
                          onTaskUpdate(updatedTask)
                        }
                      } catch (e) {}
                    }}>
                      <input type="radio" aria-label={`review-decision-${i}`} name={`selectedAction-${task && task.taskId || 'task'}`} checked={isSelected} readOnly />
                      <div style={{ flex: 1, fontWeight: 600 }}>{renderActionLabel(r)}</div>
                    </div>
                  )
                }) : <div style={{ color: '#6b7280' }}>No review decisions recorded.</div>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="small" onClick={() => { setShowForm(true) }} style={{ background: '#fff', border: '1px solid #e6eefc', padding: '6px 10px', borderRadius: 8 }}>Create follow-up decision</button>
                <div style={{ flex: 1 }} />
                <button className="small" onClick={() => { try { const ta = document.querySelector('.composer textarea') as HTMLTextAreaElement | null; if (ta) { ta.focus() } } catch (e) {} }} style={{ background: '#fff', border: '1px solid #e6eefc', padding: '6px 10px', borderRadius: 8 }}>Continue conversation</button>
              </div>
            </div>
          )
        }

        if (stage === 'Decision') {
          return (
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <button className="big" style={{ flex: 1, background: '#10b981', color: '#fff', border: 'none' }} onClick={() => {
              try {
                const base = task || {}

                // Determine an action id to mark as approved (prefer local selection, then task.selectedAction, then first proposed action)
                let selId: any = null
                try {
                  if (selectedAction) {
                    selId = typeof selectedAction === 'string' ? selectedAction : (selectedAction && (selectedAction.id || selectedAction))
                  } else if (base.selectedAction) {
                    selId = typeof base.selectedAction === 'string' ? base.selectedAction : (base.selectedAction && (base.selectedAction.id || base.selectedAction))
                  } else if (Array.isArray(base.proposedActions) && base.proposedActions.length) {
                    const first = base.proposedActions[0]
                    selId = first && (first.id || first)
                  }
                } catch (e) { selId = null }

                const updatedTask: any = {
                  ...base,
                  status: 'approved',
                  decision: 'approved',
                  approved: true,
                  approvedAt: new Date().toISOString(),
                  selectedAction: selId,
                  updatedAt: new Date().toISOString(),
                  lastActivityAt: new Date().toISOString(),
                }

                // If this approval is for a follow-up, preserve followUp metadata
                try {
                  const isFollowupSelected = Boolean((selId && Array.isArray(base.proposedActions) && base.proposedActions.find((a: any) => a.id === selId && a.followup)) || (base && String(base.status).toLowerCase() === 'followup') || (base.followUp && base.followUp.active && base.followUp.id === selId))
                  if (isFollowupSelected) {
                    updatedTask.followUp = { ...(base.followUp || {}), id: selId, approvedAt: new Date().toISOString(), active: true }
                  }
                } catch (e) {}

                if (typeof onTaskUpdate === 'function') {
                  onTaskUpdate(updatedTask)
                } else {
                  try { if (task) { task.status = 'approved'; task.decision = 'approved' } } catch (e) {}
                }
              } catch (e) {}
            }}>Approve</button>
              <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => handleReject()}>Reject</button>
            </div>


          )
        }

        if (stage === 'Approved') {
          return (
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none' }} onClick={() => handleDispatch()} disabled={!canDispatch || isDispatching}>{isDispatching ? 'Dispatching...' : 'Dispatch to Engineering'}</button>
              <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => handleReject()}>Reject</button>
            </div>
          )
        }

        // default: do not expose the send CTA here; only allow reject (but hide reject for non-decision/approved states)
        return null
      })()}

      {/* Status / dispatch progress */}
      {(isDispatching || isPolling || (task && (task.dispatched || task.status || task.executionReport))) ? (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: isDispatching ? '#f0f9ff' : (isPolling ? '#f0f9ff' : (task && task.executionReport ? '#ecfdf5' : '#fff7ed')), color: isDispatching ? '#0c4a6e' : (isPolling ? '#0c4a6e' : (task && task.executionReport && (task.executionReport.status === 'completed' || task.executionReport.status === 'success') ? '#065f46' : '#92400e')) }}>
          {isDispatching ? (
            'Dispatching...'
          ) : isPolling ? (
            'Dispatched — waiting for runner (polling)'
          ) : (task && task.executionReport) ? (
            (task.executionReport.status ? String(task.executionReport.status).charAt(0).toUpperCase() + String(task.executionReport.status).slice(1) : 'Completed')
          ) : (task && task.dispatched) ? (
            'Dispatched'
          ) : (task && task.status) ? (
            String(task.status).charAt(0).toUpperCase() + String(task.status).slice(1)
          ) : null}
        </div>
      ) : null}

      {localDispatchError ? (
        <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8 }}>{localDispatchError}</div>
      ) : null}


      {(!['Complete','Reviewed','Evidence'].includes(stage)) ? (
        <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
          Approve only sets the task to "approved". Dispatch posts the decision to the engineering pipeline (POST /taskboard/api/task/decision) and marks the task as "dispatched" on success. An error will be shown if the dispatch fails.
        </div>
      ) : null}
    </div>
  )
}
