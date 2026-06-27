import React from 'react'
import { safeText } from '../components/safeText'
import ConversationMessage from './ConversationMessage'
import ConversationFollowupCard from './ConversationFollowupCard'
import ConversationActionCard from './ConversationActionCard'
import ArtifactsWorkspace from './ArtifactsWorkspace'
import ExecutionMonitor from './ExecutionMonitor'
import { normalizeTaskSessions } from './sessionModel'

export default function ConversationTimeline({ task, followups, onTaskUpdate, onRefresh }: { task: any; followups?: any[]; onTaskUpdate?: (t: any) => void; onRefresh?: () => Promise<void> }) {
  if (!task) return <div style={{ padding: 16 }}>No task selected</div>

  const normalized = normalizeTaskSessions(task)
  const sessions = Array.isArray(normalized.sessions) ? normalized.sessions : []
  const activeId = normalized.activeSessionId || (sessions.length ? sessions[sessions.length - 1].sessionId : null)

  // Render sessions newest-first, active session expanded, previous collapsed
  const sessionsNewFirst = sessions.slice().reverse()

  return (
    <div style={{ padding: 12 }} className="messages" aria-live="polite">
      <div style={{ marginBottom: 8 }}>
        {/* Execution monitor shows data for the active session via compatibility fields (normalizeTaskSessions populates executionReport/messages) */}
        <ExecutionMonitor task={normalized} />
      </div>

      {/* Sessions list: newest first, active expanded */}
      {sessionsNewFirst.map((s: any) => {
        if (!s) return null
        const isActive = s.sessionId === activeId
        if (!isActive) {
          return (
            <div key={s.sessionId} style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: '#f8fafc', border: '1px solid #e6eefc' }}>
              <div style={{ fontWeight: 800 }}>{s.title || `Session ${s.sessionId}`}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{s.createdAt ? new Date(s.createdAt).toLocaleString() : ''} · {s.status || 'Complete'}</div>
              {s.executionReport && s.executionReport.summary ? <div style={{ marginTop: 8, fontSize: 13, color: '#374151' }}>{String(s.executionReport.summary).slice(0, 300)}</div> : null}
            </div>
          )
        }

        // Active session: expanded view
        const active = s
        const events: any[] = []

        // messages
        if (Array.isArray(active.messages) && active.messages.length) {
          active.messages.forEach((m: any, i: number) => {
            const ts = m && (m.createdAt || m.created_at || m.ts || m.time) ? (m.createdAt || m.created_at || m.ts || m.time) : (m && m.t ? m.t : active.updatedAt || new Date().toISOString())
            const text = (typeof m === 'string') ? safeText(m) : safeText(m && (m.text || m.message || m.body) ? (m.text || m.message || m.body) : JSON.stringify(m))
            events.push({ id: (m && m.id) ? m.id : `msg-${i}`, type: 'message', text, ts, data: m })
          })
        } else {
          events.push({ id: `evt-session-${s.sessionId}-start`, type: 'system', text: 'Session started', ts: s.createdAt || new Date().toISOString() })
        }

        // execution report events (active session)
        if (active.executionReport) {
          const exec = active.executionReport
          if (Array.isArray(exec.events) && exec.events.length) {
            exec.events.forEach((ev: any, i: number) => {
              const ts = ev.ts || ev.time || ev.createdAt || ev.t || ev.timestamp || exec.completedAt || active.updatedAt || new Date().toISOString()
              const text = ev.title || ev.summary || ev.message || ev.text || JSON.stringify(ev)
              events.push({ id: ev.id || `exec-${i}`, type: 'execution', text: safeText(text), ts, data: { ...exec, ...ev, _runner_marker: true } })
            })
          } else if (typeof exec.summary === 'string' && exec.summary.trim().length > 0) {
            const lines = exec.summary.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
            const base = exec.completedAt || exec.updatedAt || exec.startedAt || active.updatedAt || new Date().toISOString()
            const baseMs = Date.parse(base as string) || Date.now()
            const startMs = baseMs - Math.max(0, lines.length) * 1000
            lines.forEach((ln: string, idx: number) => {
              const ts = new Date(startMs + idx * 1000).toISOString()
              events.push({ id: `exec-summary-${idx}`, type: 'execution', text: safeText(ln), ts, data: { ...exec, _runner_marker: true } })
            })
          } else {
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
              events.push({ id: 'exec-unknown', type: 'execution', text: safeText(exec.summary || 'Execution'), ts: exec.completedAt || active.updatedAt || new Date().toISOString(), data: { ...exec, _runner_marker: true } })
            }
          }
        }

        events.sort((a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

        return (
          <div key={s.sessionId} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Execution Cycle · {s.title || s.sessionId}{s.immutable ? ' (history)' : ' (active)'}</div>
            <div style={{ marginBottom: 8 }}>
              {events.map((e) => {
                if (e.type === 'execution' && e.data && e.data._runner_marker) {
                  return (
                    <div key={e.id} style={{ marginBottom: 8 }}>
                      <ConversationMessage event={e} />
                    </div>
                  )
                }

                if (e.type === 'message') {
                  return (
                    <div key={e.id} style={{ marginBottom: 12 }}>
                      <ConversationMessage event={e} />
                    </div>
                  )
                }

                return (
                  <div key={e.id} style={{ marginBottom: 12 }}>
                    <ConversationMessage event={e} />
                  </div>
                )
              })}
            </div>

            {/* Artifacts workspace for active session only */}
            {s.immutable ? null : (
              <div style={{ marginTop: 8 }}>
                <ArtifactsWorkspace task={normalized} />
              </div>
            )}

            {/* Action card (active only) */}
            <div style={{ marginTop: 12 }}>
              {!s.immutable ? <ConversationActionCard task={normalized} onTaskUpdate={onTaskUpdate} onRefresh={onRefresh} /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
