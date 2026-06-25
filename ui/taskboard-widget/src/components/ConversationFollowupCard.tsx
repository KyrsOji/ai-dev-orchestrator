import React from 'react'

export default function ConversationFollowupCard({ followup }: any) {
  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>
      <div style={{ fontWeight: 700 }}>{followup && followup.title ? followup.title : 'Follow-up'}</div>
      <div style={{ marginTop: 6 }}>{followup && followup.reason ? followup.reason : ''}</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button className="small" onClick={() => console.log('Approve followup')}>Approve</button>
        <button className="small" onClick={() => console.log('Reject followup')}>Reject</button>
        <button className="small" disabled style={{ background: '#9ca3af', color: '#fff', border: 'none' }}>Publish</button>
      </div>
    </div>
  )
}
