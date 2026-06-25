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

  return (
    <div className="execution-details" style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {conversationId ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Conversation</div>
            <div style={{ fontWeight: 700 }}>{safeText(conversationId)}</div>
          </div>
        ) : null}

        {rc !== undefined && rc !== null ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Return code</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', fontWeight: 700 }}>{safeText(rc)}</div>
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
            <div style={{ color: '#6b7280', width: 140 }}>Event counts</div>
            <pre className="message-data" style={{ margin: 0, maxWidth: '100%' }}><code>{escapeHtml(typeof eventTypeCounts === 'string' ? eventTypeCounts : JSON.stringify(eventTypeCounts, null, 2))}</code></pre>
          </div>
        ) : null}

        {runDir ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ color: '#6b7280', width: 140 }}>Run directory</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' }}>{safeText(runDir)}</div>
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
