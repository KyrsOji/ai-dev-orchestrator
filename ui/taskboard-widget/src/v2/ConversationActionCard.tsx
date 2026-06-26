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

    // select the new recommendation locally
    setSelectedAction(newAction)

    // collapse editor and reset
    setShowForm(false)
    setDescription('')
    setInstructions('')
  }

  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid #eef2ff', boxShadow: '0 6px 18px #02061708' }}>
      <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 16 }}>Engineering Recommendations</div>
      {recs.length ? (
        <div style={{ color: '#374151', marginBottom: 12 }}>{recs.length} suggested</div>
      ) : (
        <div style={{ color: '#6b7280', marginBottom: 12 }}>No engineering recommendations have been created. Create one below or continue the conversation.</div>
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
          <button className="big" onClick={() => setShowForm(true)} style={{ background: '#ffffff', border: '1px dashed #cbd5e1', padding: '10px 14px', borderRadius: 10 }}>Create Recommendation</button>
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
