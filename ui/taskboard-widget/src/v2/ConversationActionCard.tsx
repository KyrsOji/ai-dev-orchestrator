import React, { useState } from 'react'
import { safeText } from '../components/safeText'

export default function ConversationActionCard({ task }: any) {
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

  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid #eef2ff', boxShadow: '0 6px 18px #02061708' }}>
      <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 16 }}>Review Decisions</div>
      {recs.length ? (
        <div style={{ color: '#374151', marginBottom: 12 }}>{recs.length} suggested</div>
      ) : (
        <div style={{ color: '#6b7280', marginBottom: 12 }}>No review decisions yet. Create a custom action or continue the conversation.</div>
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

      <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
        <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', opacity: selectedAction ? 1 : 0.6 }} onClick={() => console.log('Send to Engineering Team', selectedAction)} disabled={!selectedAction}>Send to Engineering Team</button>
        <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
      </div>

      <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
        This will approve the selected recommendation and send it for execution once backend wiring is enabled.
      </div>
    </div>
  )
}
