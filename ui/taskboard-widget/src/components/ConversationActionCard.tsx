import React from 'react'
import { safeText } from './safeText'

export default function ConversationActionCard({ task }: any) {
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
        <button className="small" onClick={() => console.log('Approve Selected')} style={{ flex: 1 }}>Approve Selected</button>
        <button className="small" onClick={() => console.log('Reject Selected')} style={{ flex: 1 }}>Reject</button>
      </div>
    </div>
  )
}
