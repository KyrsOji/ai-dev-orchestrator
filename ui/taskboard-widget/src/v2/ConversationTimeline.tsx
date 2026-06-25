import React from 'react'
import { safeText } from '../components/safeText'
import ConversationMessage from './ConversationMessage'
import ConversationFollowupCard from './ConversationFollowupCard'
import ConversationActionCard from './ConversationActionCard'

export default function ConversationTimeline({ task, followups }: { task: any; followups?: any[] }) {
  if (!task) return <div style={{ padding: 16 }}>No task selected</div>

  const events: any[] = []
  // Task metadata / created
  events.push({ id: 'evt-created', type: 'system', text: 'Task Created', ts: task.createdAt || task.updatedAt || new Date().toISOString() })
  // Notes
  if (task.notes) events.push({ id: 'evt-notes', type: 'user', text: safeText(task.notes), ts: task.updatedAt || new Date().toISOString() })
  // OpenHands response
  if (task.openhandsResponse) events.push({ id: 'evt-oh', type: 'result', text: safeText(task.openhandsResponse), ts: task.updatedAt || new Date().toISOString() })
  // Reviewer summary
  if (task.reviewerSummary) events.push({ id: 'evt-reviewer', type: 'reviewer', text: safeText(task.reviewerSummary), ts: task.updatedAt || new Date().toISOString() })
  // Proposed actions (render with action card)
  if (Array.isArray(task.proposedActions) && task.proposedActions.length) {
    events.push({ id: 'evt-actions', type: 'action-card', task })
  }
  // Followups: include any followups that reference this task id in suggestionId or taskId
  if (Array.isArray(followups)) {
    followups.forEach((f: any, i: number) => {
      const matched = (f && (f.suggestionId || f.id || f.taskId)) ? true : false
      if (matched) {
        events.push({ id: `evt-followup-${i}`, type: 'followup', followup: f, text: safeText(f.title) || safeText(f.reason) || safeText(f), ts: f && f.createdAt ? f.createdAt : new Date().toISOString() })
      }
    })
  }

  // Execution outputs (if present on task.executionReport or similar)
  if (task.executionReport) {
    events.push({ id: 'evt-exec', type: 'execution', text: safeText(task.executionReport.summary || task.executionReport.stdout || task.executionReport.stderr || JSON.stringify(task.executionReport)), ts: task.executionReport.completedAt || task.updatedAt || new Date().toISOString(), data: task.executionReport })
  }

  events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  return (
    <div style={{ padding: 12 }} className="messages" aria-live="polite">
      {events.map((e) => {
        if (e.type === 'followup' && e.followup) {
          return (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <ConversationFollowupCard followup={e.followup} />
            </div>
          )
        }

        if (e.type === 'action-card') {
          return (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <ConversationActionCard task={e.task} />
            </div>
          )
        }

        // default: render as a chat message
        return (
          <div key={e.id} style={{ marginBottom: 12 }}>
            <ConversationMessage event={e} />
          </div>
        )
      })}
    </div>
  )
}
