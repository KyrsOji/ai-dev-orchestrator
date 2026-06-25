import React from 'react'
import { safeText } from '../components/safeText'
import ConversationMessage from './ConversationMessage'
import ConversationFollowupCard from './ConversationFollowupCard'
import ConversationActionCard from './ConversationActionCard'
import ArtifactsWorkspace from './ArtifactsWorkspace'

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
  // Proposed actions (render with action card) - always render the action card even if no proposedActions
  events.push({ id: 'evt-actions', type: 'action-card', task })
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
    const exec = task.executionReport
    // Prefer explicit events array if provided by the runner
    if (Array.isArray(exec.events) && exec.events.length) {
      exec.events.forEach((ev: any, i: number) => {
        const ts = ev.ts || ev.time || ev.createdAt || ev.t || ev.timestamp || exec.completedAt || task.updatedAt || new Date().toISOString()
        const text = ev.title || ev.summary || ev.message || ev.text || JSON.stringify(ev)
        events.push({ id: ev.id || `exec-${i}`, type: 'execution', text: safeText(text), ts, data: { ...exec, ...ev, _runner_marker: true } })
      })
    } else if (typeof exec.summary === 'string' && exec.summary.trim().length > 0) {
      const lines = exec.summary.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
      const base = exec.completedAt || exec.updatedAt || exec.startedAt || task && task.updatedAt || new Date().toISOString()
      const baseMs = Date.parse(base as string) || Date.now()
      const startMs = baseMs - Math.max(0, lines.length) * 1000
      lines.forEach((ln: string, idx: number) => {
        const ts = new Date(startMs + idx * 1000).toISOString()
        events.push({ id: `exec-summary-${idx}`, type: 'execution', text: safeText(ln), ts, data: { ...exec, _runner_marker: true } })
      })
    } else {
      // Derive from known timestamp fields (non-invasive)
      const candidates: any[] = []
      const pushIf = (k: any, title: string) => {
        const t = exec[k]
        if (t) candidates.push({ k, ts: t, title })
      }
      pushIf('createdAt', 'SDK Started')
      pushIf('startedAt', 'Runner Started')
      pushIf('executionStartedAt', 'Execution Running')
      pushIf('completedAt', 'Execution Completed')
      pushIf('publishedAt', 'Result Published')
      pushIf('followupGeneratedAt', 'Follow-up Generated')
      if (exec.summary) candidates.push({ k: 'summary', ts: exec.updatedAt || exec.completedAt || exec.createdAt || new Date().toISOString(), title: exec.summary })
      if (candidates.length) {
        candidates.forEach((c: any, i: number) => events.push({ id: c.k || `c-${i}`, type: 'execution', text: safeText(String(c.title)), ts: c.ts, data: { ...exec, _runner_marker: true } }))
      } else {
        events.push({ id: 'exec-unknown', type: 'execution', text: safeText(exec.summary || 'Execution'), ts: exec.completedAt || task.updatedAt || new Date().toISOString(), data: { ...exec, _runner_marker: true } })
      }
    }
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

      {/* Artifacts workspace appears below the conversation */}
      <div style={{ marginTop: 8 }}>
        <ArtifactsWorkspace task={task} />
      </div>
    </div>
  )
}
