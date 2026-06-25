import React from 'react'
import { safeText } from '../components/safeText'

export default function ConversationActionCard({ task }: any) {
  const recs = task && task.proposedActions ? task.proposedActions : [
    'Verify Kafka',
    'Update README',
    'Run smoke'
  ]

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
    <div style={{ padding: 12, borderRadius: 12, background: '#fff', border: '1px solid #eef2ff' }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Engineering Recommendations</div>
      <div style={{ color: '#374151', marginBottom: 10 }}>{recs.length} suggested</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recs.map((r: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input aria-label={`select action ${i}`} type="checkbox" />
            <div style={{ flex: 1, fontWeight: 600 }}>{renderActionLabel(r)}</div>
            <button className="small" onClick={() => console.log('Run action', r)}>Run</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button className="big" style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none' }} onClick={() => console.log('Approve Selected')}>Approve Selected</button>
        <button className="big" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }} onClick={() => console.log('Reject Selected')}>Reject</button>
      </div>
    </div>
  )
}
