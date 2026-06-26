import React, { useState } from 'react'
import { safeText } from '../components/safeText'
import { determineStage } from './lifecycle'

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
      payload: { instructions }
    }

    // update local UI state immediately
    setRecs((prev) => [...prev, newAction])
    setSelectedAction(newAction)

    // Update local UI-only state (do not call backend yet)
    // The new action is appended to local recs and selected in the UI.

    // collapse editor and reset
    setShowForm(false)
    setDescription('')
    setInstructions('')
  }

  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid #eef2ff', boxShadow: '0 6px 18px #02061708' }}>
      <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 16 }}>Review Decisions</div>
      {recs.length ? (
        <div style={{ color: '#374151', marginBottom: 12 }}>{recs.length} suggested</div>
      ) : (
        <div style={{ color: '#6b7280', marginBottom: 12 }}>No review decisions yet. Use the composer below to create one or continue the conversation.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {recs.map((r: any, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: selectedAction === r ? '#eef2ff' : 'transparent',
              padding: 8,
              borderRadius: 10
            }}
            onClick={() => setSelectedAction(r)}
          >
            <input aria-label={`select recommendation ${i}`} type="checkbox" checked={selectedAction === r} readOnly />
            <div style={{ flex: 1, fontWeight: 600 }}>{renderActionLabel(r)}</div>
          </div>
        ))}
      </div>

      {/* Collapsed CTA */}
      {!showForm && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="small" onClick={() => setShowForm(true)} style={{ background: '#fff', border: '1px solid #e6eefc', padding: '6px 10px', borderRadius: 8, color: '#0f172a' }}>+ Custom Action</button>
          <div style={{ flex: 1 }} />
        </div>
      )}

      {/* Expanded editor */}
      {showForm && (
        <div style={{ marginTop: 14 }}>
          <div style={{ padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e6eefc' }}>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 15 }}>Create Engineering Recommendation</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Recommendation Title</label>
              <input
                aria-label="recommendation title"
                placeholder="Short descriptive title"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e6eefc', fontSize: 14 }}
              />

              <label style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>Engineering Instructions</label>
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
                <button className="big" onClick={handleCreateRecommendation} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Create Recommendation</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action bar: show/hide based on lifecycle stage */}
      {(() => {
        const stage = determineStage(task)
        if (stage === 'Conversation') return null

        if (stage === 'Decision') {
          return (
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <button className="big" style={{ flex: 1, background: '#10b981', color: '#fff', border: 'none' }} onClick={() => {
              try {
                const base = task || {}
                const updatedTask = { ...base, status: 'approved', decision: 'approved', updatedAt: new Date().toISOString() }
                if (typeof onTaskUpdate === 'function') {
                  onTaskUpdate(updatedTask)
                } else {
                  try { if (task) task.status = 'approved' } catch (e) {}
                }
              } catch (e) {}
              console.log('Approved (local only)')
            }}>Approve</button>
              <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
            </div>
          )
        }

        if (stage === 'Approved') {
          return (
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none' }} onClick={async () => {
                // Optimistic update: mark dispatched locally and persist via onTaskUpdate
                try {
                  const base = task || {}
                  const updatedTask = { ...base, status: 'dispatched', dispatched: true, dispatchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                  if (typeof onTaskUpdate === 'function') {
                    onTaskUpdate(updatedTask)
                  } else {
                    try { if (task) { task.dispatched = true; task.status = 'dispatched' } } catch (e) {}
                  }

                  // Build dispatch payload
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

                  const dispatchPayload: any = {
                    taskId: updatedTask.taskId,
                    selectedAction: selectedObj || task && task.selectedAction || null,
                    instructions: (selectedObj && selectedObj.payload && selectedObj.payload.instructions) || null,
                    routing: task && task.routing ? task.routing : null,
                  }

                  // POST to decision endpoint (reuse existing review path)
                  try {
                    const selectedActionForPayload = selectedObj || (task && task.selectedAction) || null
                    const decisionPayload: any = {
                      taskId: updatedTask.taskId,
                      decision: 'approved',
                      policy: (selectedActionForPayload && selectedActionForPayload.type) || null,
                      selectedAction: selectedActionForPayload,
                      editedAction: null,
                      newAction: null,
                      notes: null,
                      source: 'taskboard-v2',
                      createdAt: new Date().toISOString(),
                    }

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

                    // Optionally refresh tasks if parent provided onRefresh
                    try {
                      if (typeof onRefresh === 'function') {
                        await onRefresh()
                      }
                    } catch (e) {
                      // ignore
                    }
                  } catch (e: any) {
                    console.error('dispatch error', e)
                    // non-blocking error: show small banner
                    try { setLocalDispatchError(e && e.message ? String(e.message) : 'Dispatch failed') } catch (e) {}
                    setTimeout(() => { try { setLocalDispatchError(null) } catch (e) {} }, 5000)
                  }
                } catch (e) {
                  console.error('Dispatch handler error', e)
                }
              }}>Dispatch to Engineering</button>
              <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
            </div>
          )
        }

        // default: show existing Send + Reject for other stages
        return (
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', opacity: selectedAction ? 1 : 0.6 }} onClick={() => console.log('Send to Engineering Team', selectedAction)} disabled={!selectedAction}>Send to Engineering Team</button>
            <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
          </div>
        )
      })()}

      {localDispatchError ? (
        <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8 }}>{localDispatchError}</div>
      ) : null}


      <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
        This will approve the selected recommendation and send it for execution once backend wiring is enabled.
      </div>
    </div>
  )
}
