import React from 'react'

export default function ConversationMessage({ message }: any) {
  const timeStr = message && message.createdAt ? new Date(message.createdAt).toLocaleString() : ''
  return (
    <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, border: '1px solid #eef2ff', background: '#fbfbff' }}>
      <div style={{ fontSize: 12, color: '#666' }}>{message.author} · {timeStr}</div>
      <div style={{ marginTop: 6 }}>{message.text}</div>
      {message.data ? <pre style={{ background: '#fff', padding: 8, marginTop: 8, borderRadius: 6 }}>{JSON.stringify(message.data, null, 2)}</pre> : null}
    </div>
  )
}
