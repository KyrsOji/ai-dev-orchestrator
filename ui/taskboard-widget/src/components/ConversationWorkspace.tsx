import React from 'react'
import ConversationHeader from './ConversationHeader'
import ConversationTimeline from './ConversationTimeline'
import ConversationSessionChain from './ConversationSessionChain'
import ConversationActionCard from './ConversationActionCard'
import ConversationFollowupCard from './ConversationFollowupCard'

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
}

export default function ConversationWorkspace(props: any) {
  const { task, tasks, messages, openTask } = props

  return (
    <div className="conversation-workspace" style={containerStyle}>
      <ConversationHeader task={task} />

      <ConversationSessionChain task={task} tasks={tasks} openTask={openTask} />

      <ConversationTimeline messages={messages || []} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Context</div>
          <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eef2ff', background: '#fbfbff' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Reviewer Summary</strong></div>
            <div style={{ fontSize: 13 }}>{task && task.reviewerSummary ? task.reviewerSummary : '(none)'}</div>
          </div>
        </div>

        <div style={{ width: 320 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Actions</div>
          <ConversationActionCard task={task} />
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Follow-ups</div>
        <ConversationFollowupCard followup={{ title: 'Follow-up Suggested', reason: 'Verify Matrix approval path', description: 'Execution completed successfully' }} />
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Notes</div>
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>{task && task.notes ? task.notes : '(no notes)'}</div>
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Approval</div>
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eef2ff', background: '#f8fafc' }}>No approval actions wired yet</div>
      </div>
    </div>
  )
}
