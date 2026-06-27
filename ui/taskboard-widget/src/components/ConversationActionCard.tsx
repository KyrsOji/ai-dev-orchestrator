import React, { useState } from 'react'
import { safeText } from './safeText'
import { postDecision, dispatchDecision } from '../v2/api'

export default function ConversationActionCard({ task, onTaskUpdate }: any) {
  const [localRejectError, setLocalRejectError] = useState<string | null>(null)
  const recs = task && task.proposedActions ? task.proposedActions : [
    'Verify Kafka',
    'Update README',
    'Run smoke'
  ]
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function renderActionLabel(a: any) {
    if (a === null || a === undefined) return ''
    if (typeof a === 'string' || typeof a === 'number') return String(a)
    // For proposed actions prefer description, then title, then id
    if (typeof a === 'object') {
      if (a.description != null) return String(a.description)
      if (a.title != null) return String(a.title)
      if (a.id != null) return String(a.id)
      return safeText(a)
    }
    return safeText(a)
  }

  async function handleReject() {
    try {
      try { setLocalRejectError(null) } catch (e) {}

      const decisionPayload: any = {
        taskId: task && task.taskId,
        decision: 'denied',
        policy: null,
        selectedAction: null,
        editedAction: null,
        newAction: null,
        notes: null,
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
      } catch (e: any) {
        console.error('reject dispatch error', e)
        try { setLocalRejectError(e && e.message ? String(e.message) : 'Reject failed') } catch (e) {}
        setTimeout(() => { try { setLocalRejectError(null) } catch (e) {} }, 5000)
      }
    } catch (e) {
      console.error('reject handler error', e)
    }
  }

  async function handleDispatch() {
    try {
      try { setLocalRejectError(null) } catch (e) {}

      let selectedObj: any = null
      try {
        if (selectedId) {
          selectedObj = (Array.isArray(recs) ? recs.find((a: any) => (a && a.id ? String(a.id) : String(recs.indexOf(a)))) : null) || selectedId
        } else if (task && task.selectedAction) {
          selectedObj = task.selectedAction
        }
      } catch (e) { selectedObj = null }

      if (!selectedObj) {
        throw new Error('No selected action')
      }

      const decisionPayload: any = {
        taskId: task && task.taskId,
        decision: 'approved',
        policy: (selectedObj && selectedObj.type) || null,
        selectedAction: selectedObj || (task && task.selectedAction) || null,
        editedAction: null,
        newAction: null,
        notes: null,
        source: 'taskboard-standalone',
        createdAt: new Date().toISOString(),
      }

      await postDecision(decisionPayload)

      // Update task to dispatched on success
      try {
        const base = task || {}
        const updatedTask = { ...base, status: 'dispatched', dispatched: true, dispatchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        if (typeof onTaskUpdate === 'function') {
          onTaskUpdate(updatedTask)
        } else {
          try { if (task) { task.dispatched = true; task.status = 'dispatched' } } catch (e) {}
        }
      } catch (e) {
        // ignore
      }

    } catch (e: any) {
      console.error('dispatch error', e)
      try { setLocalRejectError(e && e.message ? String(e.message) : 'Dispatch failed') } catch (e) {}
      setTimeout(() => { try { setLocalRejectError(null) } catch (e) {} }, 5000)
    }
  }


  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Recommended actions</div>
        <div style={{ fontSize: 13, color: '#666' }}>{recs.length} suggested</div>
      </div>

      <div>
        {recs.map((r: any, i: number) => {
          const rid = (r && (r.id || String(i)))
          const checked = selectedId === rid || (!selectedId && task && task.selectedAction && task.selectedAction === rid)
          return (
            <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }} onClick={() => setSelectedId(rid)}>
              <input type="radio" name={`legacy-selected-${task && task.taskId || 'task'}`} checked={checked} readOnly />
              <div style={{ flex: 1 }}>{renderActionLabel(r)}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="small" onClick={() => {
          try {
            const base = task || {}
            const updatedTask = { ...base, status: 'approved', decision: 'approved', updatedAt: new Date().toISOString() }
            if (typeof onTaskUpdate === 'function') {
              onTaskUpdate(updatedTask)
            } else {
              try { if (task) task.status = 'approved' } catch (e) {}
            }
          } catch (e) {}
        }} style={{ flex: 1 }}>Approve Selected</button>
        <button className="small" onClick={() => handleDispatch()} style={{ flex: 1 }}>Dispatch Selected</button>
        <button className="small" onClick={() => handleReject()} style={{ flex: 1 }}>Reject</button>
      </div>

      {localRejectError ? (
        <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8 }}>{localRejectError}</div>
      ) : null}
    </div>
  )
}
