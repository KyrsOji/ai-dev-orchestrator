import React from 'react'
import ExecutionEvent from './ExecutionEvent'
import ExecutionStatusPill from './ExecutionStatusPill'
import { safeText } from '../components/safeText'
import { getActiveSession } from './sessionModel'

function parseSummaryLines(summary: string) {
  if (!summary) return []
  return summary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function asISO(t:any){
  if(!t) return null
  const d = new Date(t)
  if(isNaN(d.getTime())) return null
  return d.toISOString()
}

// Helper to format ISO timestamp
function formatIso(iso: any) {
  try {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleString()
  } catch (e) { return String(iso) }
}

function durationBetween(a: any, b: any) {
  try {
    if (!a) return ''
    const at = new Date(a).getTime()
    const bt = b ? new Date(b).getTime() : Date.now()
    if (isNaN(at) || isNaN(bt)) return ''
    const sec = Math.floor(Math.max(0, bt - at) / 1000)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h) return `${h}h ${m}m ${s}s`
    if (m) return `${m}m ${s}s`
    return `${s}s`
  } catch (e) { return '' }
}

function pickFirst(...vals: any[]) {
  for (const v of vals) if (v) return v
  return null
}

export default function ExecutionTimeline({ exec, task }: { exec?: any; task?: any }) {
  const e = exec || (task && (task.executionReport || task.execution)) || null

  // If task is present and has sessions, render the higher-level execution timeline (Conversation -> Review -> Approved -> Publishing -> Runner Started -> Executing -> Evidence -> Complete)
  if (task) {
    const session = getActiveSession(task) || null
    const report = (session && session.executionReport) || task.executionReport || null

    const STAGES = [
      'Conversation',
      'Review',
      'Approved',
      'Publishing',
      'Runner Started',
      'Executing',
      'Evidence',
      'Complete'
    ]

    const tsMap: Record<string, any> = {}
    tsMap['Conversation'] = pickFirst(session && session.createdAt, task && (task.createdAt || task.updatedAt))
    tsMap['Review'] = (session && session.reviewDecision && Array.isArray(session.reviewDecision.proposals) && session.reviewDecision.proposals.length) ? (session.updatedAt || session.createdAt) : null
    tsMap['Approved'] = (session && session.approval && session.approval.approvedAt) ? session.approval.approvedAt : null
    tsMap['Publishing'] = (session && session.dispatch && (session.dispatch.dispatchedAt || session.dispatch.at || session.dispatch.timestamp)) ? (session.dispatch.dispatchedAt || session.dispatch.at || session.dispatch.timestamp) : (task && (task.dispatchedAt || task.dispatched_at)) || null
    tsMap['Runner Started'] = report && (report.startedAt || report.executionStartedAt || report.startTime || report.createdAt) ? (report.startedAt || report.executionStartedAt || report.startTime || report.createdAt) : null
    tsMap['Executing'] = report && ((String(report.status || '').toLowerCase() === 'running') || (report && report.startedAt && !report.completedAt)) ? (report.startedAt || report.executionStartedAt || null) : null
    tsMap['Evidence'] = report ? (report.completedAt || report.finishedAt || report.updatedAt || report.createdAt) : null
    tsMap['Complete'] = report && (report.completedAt || report.finishedAt) ? (report.completedAt || report.finishedAt) : (task && (task.completedAt || task.completed_at)) || null

    // Determine current stage heuristically
    function determineCurrent() {
      try {
        if (tsMap['Complete']) return 'Complete'
        if (report && String((report.status || '').toLowerCase()) === 'running') return 'Executing'
        if (tsMap['Runner Started'] && !tsMap['Complete']) return 'Runner Started'
        if (tsMap['Publishing'] && !tsMap['Runner Started']) return 'Publishing'
        if (tsMap['Approved'] && !tsMap['Publishing']) return 'Approved'
        if (tsMap['Review'] && !tsMap['Approved']) return 'Review'
        return 'Conversation'
      } catch (e) { return 'Conversation' }
    }

    const current = determineCurrent()
    const currentIdx = STAGES.indexOf(current)

    return (
      <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #eee' }} aria-label="Execution timeline">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Execution Timeline</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{task.title || task.taskId}</div>
          </div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>Status: <strong style={{ color: '#111827' }}>{current}</strong></div>
        </div>

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 16, minWidth: 700, alignItems: 'flex-start' }}>
            {STAGES.map((s, i) => {
              const ts = tsMap[s] || null
              const nextTs = (() => {
                for (let j = i + 1; j < STAGES.length; j++) {
                  const v = tsMap[STAGES[j]]
                  if (v) return v
                }
                return null
              })()
              const isCompleted = !!ts && (i <= currentIdx)
              const isCurrent = i === currentIdx
              const statusText = isCompleted ? 'done' : isCurrent ? 'in progress' : 'pending'

              return (
                <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 140 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 999, background: isCompleted ? '#10b981' : isCurrent ? '#3b82f6' : '#d1d5db', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{isCompleted ? '\u2713' : s.charAt(0)}</div>
                  <div style={{ marginTop: 8, fontSize: 13, color: isCompleted ? '#065f46' : isCurrent ? '#0f172a' : '#6b7280', fontWeight: isCurrent ? 800 : 600 }}>{s}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>{ts ? formatIso(ts) : ''}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>{ts && nextTs ? durationBetween(ts, nextTs) : (ts ? durationBetween(ts, null) : '')}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: isCurrent ? '#0f172a' : '#6b7280' }}>{statusText}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Fallback: existing execution-event style timeline when only exec is present
  if (!e) {
    return (
      <div className="card" style={{ padding: 12, borderRadius: 12 }}>
        <div style={{ fontWeight: 800 }}>Execution</div>
        <div style={{ marginTop: 8, color: '#6b7280' }}>No execution report available</div>
      </div>
    )
  }

  // If there is a discrete events array, prefer it
  let events: any[] = []
  if (Array.isArray(e.events) && e.events.length) {
    events = e.events.map((ev:any, i:number) => ({
      id: ev.id || `evt-${i}`,
      ts: asISO(ev.ts || ev.time || ev.createdAt || ev.t || ev.timestamp) || asISO(e.completedAt) || asISO(e.updatedAt) || new Date().toISOString(),
      title: ev.title || ev.name || ev.event || ev.type || String(ev.message || ev.text || 'Event'),
      subtitle: ev.subtitle || ev.summary || ev.note || ''
    }))
  } else if (typeof e.summary === 'string' && e.summary.trim().length > 0) {
    const lines = parseSummaryLines(e.summary)
    const base = asISO(e.completedAt) || asISO(e.updatedAt) || asISO(e.startedAt) || asISO(task && task.updatedAt) || new Date().toISOString()
    const baseMs = Date.parse(base) || Date.now()
    const startMs = baseMs - Math.max(0, lines.length) * 1000
    events = lines.map((ln, idx) => ({ id: `summary-${idx}`, ts: new Date(startMs + idx * 1000).toISOString(), title: ln, subtitle: '' }))
  } else {
    // Fallback: create a few structured events from available fields
    const candidates: any[] = []
    const pushIf = (k:any, title:string) => {
      const t = e[k]
      if (t) {
        candidates.push({ k, ts: asISO(t), title })
      }
    }
    pushIf('createdAt', 'SDK Started')
    pushIf('startedAt', 'Runner Started')
    pushIf('executionStartedAt', 'Execution Running')
    pushIf('completedAt', 'Execution Completed')
    pushIf('publishedAt', 'Result Published')
    pushIf('followupGeneratedAt', 'Follow-up Generated')

    // include summary as last event
    if (e.summary) candidates.push({ k:'summary', ts: asISO(e.updatedAt) || asISO(e.completedAt) || asISO(e.createdAt) || new Date().toISOString(), title: e.summary })

    if (candidates.length) {
      events = candidates.map((c:any, i:number) => ({ id: c.k || `c-${i}`, ts: c.ts || new Date().toISOString(), title: String(c.title), subtitle: '' }))
    } else {
      events = [{ id: 'exec-unknown', ts: asISO(e.completedAt) || asISO(e.updatedAt) || new Date().toISOString(), title: e.summary || 'Execution', subtitle: '' }]
    }
  }

  // ensure deterministic ordering
  events.sort((a,b)=> new Date(a.ts).getTime() - new Date(b.ts).getTime())

  return (
    <div className="execution-timeline card" style={{ padding: 12, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 800 }}>⚙ Execution timeline</div>
        <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 13 }}>{events.length} events</div>
      </div>

      {/* Summary row: status, return code, duration, conversation id */}
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <ExecutionStatusPill status={e.status || e.executionStatus || e.state || (task && task.status)} />
        { (e.returnCode || e.return_code || e.rc || e.returncode) !== undefined && (
          <div className="exec-pill exec-pill-rc" style={{ marginLeft: 8 }}>{`RC ${String(e.returnCode || e.return_code || e.rc || e.returncode)}`}</div>
        ) }
        {(() => {
          const dur = e.executionDurationSeconds || e.executionDuration || e.duration || e.elapsed || e.time
          if (dur) return <div style={{ marginLeft: 8, color: '#6b7280' }}>{`Duration: ${String(dur)}`}</div>
          if (e.startedAt && e.finishedAt) {
            try { const d = (new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime())/1000; return <div style={{ marginLeft: 8, color: '#6b7280' }}>{`Duration: ${d}s`}</div> } catch { return null }
          }
          return null
        })()}
        { (task && (task.conversationId || null)) || e.conversationId || e.conversation_id ? (
          <div style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', fontWeight: 700 }}>{safeText(task && (task.conversationId || e.conversationId || e.conversation_id))}</div>
        ) : null }
      </div>

      <div style={{ marginTop: 12 }}>
        {events.map((ev) => (
          <ExecutionEvent key={ev.id} event={ev} exec={e} />
        ))}
      </div>
    </div>
  )
}
