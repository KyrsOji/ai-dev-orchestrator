import React, { useState } from 'react'
import { safeText } from '../components/safeText'

export default function ConversationActionCard({ task }: any) {
  const initialRecs = task && Array.isArray(task.proposedActions) && task.proposedActions.length
    ? task.proposedActions
    : [
      'Verify Kafka',
      'Update README',
      'Run smoke'
    ]

  const [recs, setRecs] = useState<any[]>(initialRecs.slice())
  const [showForm, setShowForm] = useState(false)
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [selectedAction, setSelectedAction] = useState<any>(null)

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

  function handleSaveCustom() {
    const newAction = {
      type: 'manual',
      id: 'custom-' + Date.now(),
      description: description,
      payload: { instructions }
    }

    // update local UI state
    setRecs([...recs, newAction])

    // also append to the incoming task object locally (UI-only prototype)
    try {
      if (task) {
        if (!Array.isArray(task.proposedActions)) task.proposedActions = []
        task.proposedActions.push(newAction)
      }
    } catch (e) {
      // ignore mutation errors in constrained environments
    }

    // select the new action locally
    setSelectedAction(newAction)

    // reset form
    setShowForm(false)
    setDescription('')
    setInstructions('')
  }

  return (
    <div style={{ padding: 12, borderRadius: 12, background: '#fff', border: '1px solid #eef2ff' }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Engineering Recommendations</div>
      <div style={{ color: '#374151', marginBottom: 10 }}>{recs.length} suggested</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recs.map((r: any, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: selectedAction === r ? '#eef2ff' : 'transparent',
              padding: 6,
              borderRadius: 8
            }}
            onClick={() => setSelectedAction(r)}
          >
            <input aria-label={`select action ${i}`} type="checkbox" checked={selectedAction === r} readOnly />
            <div style={{ flex: 1, fontWeight: 600 }}>{renderActionLabel(r)}</div>
            <button className="small" onClick={(e) => { e.stopPropagation(); console.log('Run action', r) }}>Run</button>
          </div>
        ))}
      </div>

      {/* Inline custom action form toggle */}
      {showForm ? (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#fafafa', border: '1px solid #f0f0f0' }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Custom Action</div>
            <input
              aria-label="custom description"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #e6eefc', marginBottom: 8 }}
            />
            <textarea
              aria-label="custom instructions"
              placeholder="Instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #e6eefc', minHeight: 80 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="big" onClick={handleSaveCustom} style={{ background: '#10b981', color: '#fff', border: 'none' }}>Save</button>
            <button className="big" onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="big" onClick={() => setShowForm(true)} style={{ background: '#ffffff', border: '1px dashed #cbd5e1' }}>+ Custom Action</button>
          <div style={{ flex: 1 }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none' }} onClick={() => console.log('Approve Selected')}>Approve Selected</button>
        <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
      </div>
    </div>
  )
}
