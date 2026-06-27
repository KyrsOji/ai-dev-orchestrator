import React, { useState } from 'react'
import { safeText } from './safeText'
import { postDecision } from '../v2/api'

export default function ConversationActionCard({ task, onTaskUpdate }: any) {
  const [localRejectError, setLocalRejectError] = useState<string | null>(null)
  const recs = task && task.proposedActions ? task.proposedActions : [
    'Verify Kafka',
    'Update README',
    'Run smoke'
  ]

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
        decision: 'rejected',
        policy: null,
        selectedAction: null,
        editedAction: null,
        newAction: null,
        notes: null,
        source: 'taskboard-v2',
        createdAt: new Date().toISOString(),
      }

      try {
        await postDecision(decisionPayload)

        // Update task to rejected on success
        try {
          const base = task || {}
          const updatedTask = { ...base, status: 'rejected', decision: 'rejected', rejected: true, rejectedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          if (typeof onTaskUpdate === 'function') {
            onTaskUpdate(updatedTask)
          } else {
            try { if (task) { task.rejected = true; task.status = 'rejected'; task.decision = 'rejected' } } catch (e) {}
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

  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Recommended actions</div>
        <div style={{ fontSize: 13, color: '#666' }}>{recs.length} suggested</div>
      </div>

      <div>
        {recs.map((r: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input type="checkbox" />
            <div style={{ flex: 1 }}>{renderActionLabel(r)}</div>
          </div>
        ))}
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
        <button className="small" onClick={() => handleReject()} style={{ flex: 1 }}>Reject</button>
      </div>

      {localRejectError ? (
        <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8 }}>{localRejectError}</div>
      ) : null}
    </div>
  )
}
