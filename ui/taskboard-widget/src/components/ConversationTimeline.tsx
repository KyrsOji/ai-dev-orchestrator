import React from 'react'
import ConversationMessage from './ConversationMessage'
import ConversationSystemEvent from './ConversationSystemEvent'
import ConversationFollowupCard from './ConversationFollowupCard'
import ConversationActionCard from './ConversationActionCard'

export default function ConversationTimeline({ events }: any) {
  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#ffffff', minHeight: 240 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Timeline</div>
      {Array.isArray(events) && events.length ? (
        events.map((e: any) => {
          if (!e) return null
          try {
            if (e.type === 'system') return <ConversationSystemEvent key={e.id || Math.random()} event={e.event} />
            if (e.type === 'message') return <ConversationMessage key={e.id || Math.random()} message={e.message} />
            if (e.type === 'followup') return <ConversationFollowupCard key={e.id || Math.random()} followup={e.followup} />
            if (e.type === 'action') return <div key={e.id || Math.random()} style={{ marginBottom: 8 }}><ConversationActionCard task={e.task} /></div>
          } catch (err) {
            return null
          }
          // fallback
          if (e.message) return <ConversationMessage key={e.id || Math.random()} message={e.message} />
          return null
        })
      ) : (
        <div style={{ color: '#666' }}>No events yet</div>
      )}
    </div>
  )
}
