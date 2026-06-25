import React from 'react'

export default function ConversationHeader({ task }: any) {
  return (
    <div style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{task && (task.title || task.taskId) ? (task.title || task.taskId) : 'Conversation'}</div>
          <div style={{ fontSize: 13, color: '#666' }}>Conversation: {task && task.conversationId ? task.conversationId : '(none)'}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#666' }}>Participants: Human · Reviewer · OpenHands</div>
        </div>
      </div>
    </div>
  )
}
