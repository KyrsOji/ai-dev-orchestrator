import React from 'react'

export default function ConversationSystemEvent({ event }: any) {
  const timeStr = event && event.createdAt ? new Date(event.createdAt).toLocaleString() : ''
  return (
    <div style={{ marginBottom: 8, padding: 8, borderRadius: 6, border: '1px dashed #e2e8f0', background: '#fafafa' }}>
      <div style={{ fontSize: 12, color: '#666' }}>System · {timeStr}</div>
      <div style={{ marginTop: 6, fontSize: 13 }}>{event.text}</div>
    </div>
  )
}
