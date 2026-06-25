import React from 'react'
import { safeText } from '../components/safeText'

export default function ConversationList({ tasks, selectedId, onSelect }: { tasks: any[]; selectedId?: string; onSelect?: (id: string) => void }) {
  return (
    <div style={{ padding: 8 }}>
      {Array.isArray(tasks) && tasks.length ? tasks.map((t) => (
        <div key={t.taskId} className={'card'} style={{ marginBottom: 8, cursor: 'pointer', border: (selectedId === t.taskId) ? '2px solid #60a5fa' : undefined }} onClick={() => onSelect && onSelect(t.taskId)}>
          <div style={{ fontWeight: 700 }}>{safeText(t.title) || t.taskId}</div>
          <div className="muted" style={{ marginTop: 6 }}>{safeText(t.reviewerSummary) || safeText(t.openhandsResponse)}</div>
        </div>
      )) : (<div>No engineering sessions</div>)}
    </div>
  )
}
