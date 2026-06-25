import React from 'react'

export default function ConversationActionCard({ task }: any) {
  const recs = task && task.proposedActions ? task.proposedActions : [
    'Verify Kafka',
    'Update README',
    'Run smoke'
  ]

  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Recommended actions</div>
        <div style={{ fontSize: 13, color: '#666' }}>{recs.length} suggested</div>
      </div>

      <div>
        {recs.map((r: string, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input type="checkbox" />
            <div style={{ flex: 1 }}>{r}</div>
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
