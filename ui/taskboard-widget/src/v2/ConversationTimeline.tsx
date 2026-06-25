import React from 'react'
import { safeText } from '../components/safeText'
import ConversationFollowupCard from '../components/ConversationFollowupCard'

export default function ConversationTimeline({ task, followups }: { task: any; followups?: any[] }) {
  if (!task) return <div style={{ padding: 16 }}>No task selected</div>

  const events: any[] = []
  // Task created
  events.push({ id: 'evt-created', type: 'system', text: 'Task Created', ts: task.createdAt || task.updatedAt || new Date().toISOString() })
  // Notes
  if (task.notes) events.push({ id: 'evt-notes', type: 'user', text: safeText(task.notes), ts: task.updatedAt || new Date().toISOString() })
  // OpenHands response
  if (task.openhandsResponse) events.push({ id: 'evt-oh', type: 'result', text: safeText(task.openhandsResponse), ts: task.updatedAt || new Date().toISOString() })
  // Reviewer summary
  if (task.reviewerSummary) events.push({ id: 'evt-reviewer', type: 'reviewer', text: safeText(task.reviewerSummary), ts: task.updatedAt || new Date().toISOString() })
  // Proposed actions
  if (Array.isArray(task.proposedActions)) {
    task.proposedActions.forEach((a: any, i: number) => {
      let label = ''
      if (a && typeof a === 'object') {
        if (a.description != null) label = String(a.description)
        else if (a.title != null) label = String(a.title)
        else if (a.id != null) label = String(a.id)
        else label = safeText(a)
      } else {
        label = safeText(a)
      }
      events.push({ id: `evt-action-${i}`, type: 'action', text: label, ts: task.updatedAt || new Date().toISOString() })
    })
  }
  // Followups: include any followups that reference this task id in suggestionId or taskId
  if (Array.isArray(followups)) {
    followups.forEach((f: any, i: number) => {
      const matched = (f && (f.suggestionId || f.id || f.taskId)) ? true : false
      if (matched) {
        // keep the original followup object so we can render an interactive followup card
        events.push({ id: `evt-followup-${i}`, type: 'followup', followup: f, text: safeText(f.title) || safeText(f.reason) || safeText(f), ts: f && f.createdAt ? f.createdAt : new Date().toISOString() })
      }
    })
  }

  events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  return (
    <div style={{ padding: 12 }}>
      {events.map((e) => {
        if (e.type === 'followup' && e.followup) {
          // render the existing followup card (shares styling and behavior)
          return <div key={e.id} style={{ marginBottom: 8 }}><ConversationFollowupCard followup={e.followup} /></div>
        }
        return (
          <div key={e.id} style={{ padding: 8, marginBottom: 8, border: '1px solid #eee', borderRadius: 6, background: '#fff' }}>
            <div style={{ fontSize: 12, color: '#666' }}>{e.type}</div>
            <div style={{ marginTop: 6 }}>{safeText(e.text)}</div>
          </div>
        )
      })}
    </div>
  )
}
