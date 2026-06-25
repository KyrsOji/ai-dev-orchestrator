import React from 'react'
import ConversationMessage from './ConversationMessage'
import ConversationSystemEvent from './ConversationSystemEvent'

export default function ConversationTimeline({ messages }: any) {
  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#ffffff', maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Timeline</div>
      {Array.isArray(messages) && messages.length ? (
        messages.map((m: any) => {
          if (!m) return null
          if (m.author === 'system') return <ConversationSystemEvent key={m.id || Math.random()} event={m} />
          return <ConversationMessage key={m.id || Math.random()} message={m} />
        })
      ) : (
        <div style={{ color: '#666' }}>No events yet</div>
      )}
    </div>
  )
}
