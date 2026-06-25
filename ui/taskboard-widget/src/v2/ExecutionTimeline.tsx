import React from 'react'
import ExecutionEvent from './ExecutionEvent'

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

export default function ExecutionTimeline({ exec, task }: { exec?: any; task?: any }) {
  const e = exec || (task && (task.executionReport || task.execution)) || null
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

      <div style={{ marginTop: 12 }}>
        {events.map((ev) => (
          <ExecutionEvent key={ev.id} event={ev} exec={e} />
        ))}
      </div>
    </div>
  )
}
