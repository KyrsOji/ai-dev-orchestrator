import React from 'react'
import ConversationTimeline from './ConversationTimeline'
import ConversationComposer from './ConversationComposer'

export default function ConversationPanel({ task, followups }: { task: any; followups?: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <ConversationTimeline task={task} followups={followups} />
      </div>
      <div style={{ borderTop: '1px solid #eee' }}>
        <ConversationComposer onSend={(t) => { console.log('compose send', t) }} />
      </div>
    </div>
  )
}
