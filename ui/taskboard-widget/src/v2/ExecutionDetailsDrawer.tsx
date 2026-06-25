import React from 'react'
import { safeText } from '../components/safeText'

function escapeHtml(s: any) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function ExecutionDetailsDrawer({ exec }: { exec: any }) {
  if (!exec) return null
  const conversationId = exec.conversationId || exec.conversation_id || exec.convId || exec.cid || ''
  const rc = exec.returnCode || exec.return_code || exec.rc
  const runDir = exec.runDirectory || exec.run_directory || exec.runDir
  const summary = exec.summary || exec.summaryText || exec.note || ''
  const responsePreview = exec.responsePreview || exec.response_preview || exec.response
  const eventTypeCounts = exec.eventTypeCounts || exec.event_type_counts || exec.eventCounts

  function prettyLabel(k: string) {
    return String(k)
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\bmsg\b/ig, 'Message')
      .replace(/\bresp\b/ig, 'Response')
      .trim()
  }

  function renderEventCounts(obj: any) {
    let data: any = obj
    if (!data) return null
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch { /* leave as-is */ }
    }
    if (typeof data !== 'object') return <div style={{ color: '#6b7280' }}>{String(data)}</div>
    const entries = Object.entries(data)
    if (!entries.length) return null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ color: '#374151' }}>{prettyLabel(k)}</div>
            <div style={{ fontWeight: 700, color: '#111827' }}>{String(v)}</div>
          </div>
        ))}
      </div>
    )
  }

  function shortenId(s: string) {
    if (!s) return ''
    if (s.length <= 12) return s
    return `${s.slice(0,8)}...${s.slice(-4)}`
  }

  function shortenPath(p: string) {
    if (!p) return ''
    if (p.length <= 32) return p
    return `${p.slice(0,18)}...${p.slice(-12)}`
  }

  function formatDuration(d: any) {
    if (d === undefined || d === null) return ''
    const n = Number(String(d).replace(/[^0-9\.\-]/g, ''))
    if (isNaN(n)) return String(d)
    // if larger than 1000 assume milliseconds
    if (n >= 1000) {
      const s = Math.round(n / 1000)
      return `${s} second${s === 1 ? '' : 's'}`
    }
    return `${n} ms`
  }

  const duration = exec && (exec.duration || exec.elapsed || exec.time || exec.executionDurationSeconds || exec.executionDuration)

  return (
    <div className="execution-details" style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {conversationId ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Engineering Conversation</div>
            <div style={{ fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span title={conversationId} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' }}>{shortenId(conversationId)}</span>
              <button className="small" onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(conversationId) } catch { } }}>Copy</button>
            </div>
          </div>
        ) : null}

        {rc !== undefined && rc !== null ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Return Code</div>
            <div><span className="exec-pill-rc">{safeText(rc)}</span></div>
          </div>
        ) : null}

        {duration ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Duration</div>
            <div style={{ fontWeight: 700 }}>{formatDuration(duration)}</div>
          </div>
        ) : null}

        {summary ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Summary</div>
            <div style={{ color: '#111827' }}>{safeText(summary)}</div>
          </div>
        ) : null}

        {eventTypeCounts ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Event Counts</div>
            {renderEventCounts(eventTypeCounts)}
          </div>
        ) : null}

        {runDir ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Run directory</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span title={runDir}>{shortenPath(runDir)}</span>
              <button className="small" onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(runDir) } catch { } }}>Copy</button>
            </div>
          </div>
        ) : null}

        {responsePreview ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Response preview</div>
            <pre className="message-data" style={{ margin: 0, maxHeight: 260, overflow: 'auto' }}><code>{escapeHtml(typeof responsePreview === 'string' ? responsePreview : JSON.stringify(responsePreview, null, 2))}</code></pre>
          </div>
        ) : null}
      </div>
    </div>
  )
}
