import React, { useState } from 'react'
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

function extIcon(path: string) {
  if (!path) return '📁'
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'py':
      return '🐍'
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return '⚛'
    case 'css':
      return '🎨'
    case 'md':
      return '📝'
    case 'json':
      return '📄'
    default:
      return '📁'
  }
}

export default function ArtifactsWorkspace({ task }: { task: any }) {
  // derive files changed if present in executionReport or task payload
  const filesFromReport = (task && task.executionReport && (task.executionReport.filesChanged || task.executionReport.files || task.executionReport.changed || task.executionReport.changes)) || []
  const filesFromTask = (task && task.task && (task.task.files || task.task.changedFiles || task.task.modifiedFiles)) || []
  let files: string[] = []
  try {
    if (Array.isArray(filesFromReport) && filesFromReport.length) files = filesFromReport.map((f: any) => (typeof f === 'string' ? f : f.path || f.filename || f.file))
    else if (Array.isArray(filesFromTask) && filesFromTask.length) files = filesFromTask.map((f: any) => (typeof f === 'string' ? f : f.path || f.filename || f.file))
  } catch (e) {
    files = []
  }

  // if nothing found, show a helpful placeholder list
  if (!files || !files.length) {
    files = ['runner/service.py', 'reviewer/service.py', 'matrix_bridge/bridge.py']
  }

  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({})
  const toggleFile = (f: string) => setExpandedFiles((s) => ({ ...s, [f]: !s[f] }))

  const exec = task && task.executionReport ? task.executionReport : (task && task.execution ? task.execution : null)
  const status = exec && (exec.status || exec.executionStatus || exec.state) ? String(exec.status || exec.executionStatus || exec.state) : task && task.status ? String(task.status) : 'unknown'
  const statusLabel = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'
  const statusColor = status === 'completed' ? '#10b981' : status === 'running' ? '#f59e0b' : status === 'failed' ? '#ef4444' : '#6b7280'
  const rc = exec && (exec.returnCode || exec.rc || exec.return_code) !== undefined ? (exec.returnCode || exec.rc || exec.return_code) : null
  const duration = exec && (exec.duration || exec.elapsed || exec.time) ? (exec.duration || exec.elapsed || exec.time) : null
  const convId = task && (task.conversationId || (exec && (exec.conversationId || exec.conversation_id))) ? (task.conversationId || exec.conversationId || exec.conversation_id) : null
  const runDir = task && (task.runDirectory || task.run_directory || (exec && (exec.runDirectory || exec.run_directory))) ? (task.runDirectory || exec.runDirectory || exec.run_directory) : null
  const resp = exec && (exec.responsePreview || exec.response_preview || exec.response) ? (exec.responsePreview || exec.response_preview || exec.response) : null

  // tests summary (best-effort)
  const tests = exec && (exec.tests || exec.testResults || exec.test_summary || exec.testResultsSummary) ? (exec.tests || exec.testResults || exec.test_summary || exec.testResultsSummary) : null
  let testsOk = null
  if (tests) {
    if (typeof tests === 'string') testsOk = tests.toLowerCase().includes('pass') || tests.toLowerCase().includes('ok')
    else if (Array.isArray(tests)) testsOk = tests.every((t) => t && t.ok !== false)
    else if (typeof tests === 'object') testsOk = tests.passed !== undefined ? tests.passed : null
  }

  const logs = exec && (exec.stdout || exec.stderr || exec.logs) ? (String(exec.stdout || '') + '\n' + String(exec.stderr || '') + '\n' + (exec.logs ? JSON.stringify(exec.logs, null, 2) : '')) : ''

  return (
    <div className="artifacts-workspace" style={{ marginTop: 12, display: 'grid', gap: 12 }}>

      <div className="artifacts-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 320px' }}>
        <div className="card" style={{ padding: 12, borderRadius: 12, background: '#fff', boxShadow: '0 6px 18px rgba(2,6,23,0.04)', border: '1px solid #eef2ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Files changed</div>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{files.length} files</div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f) => (
              <div key={f} style={{ borderRadius: 10, padding: 8, display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', background: '#fff' }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{extIcon(f)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', fontWeight: 700 }}>{f}</div>
                    <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 13 }}>{/* placeholder */}</div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <button className="small" onClick={() => toggleFile(f)} style={{ padding: '6px 10px', borderRadius: 8 }}>{expandedFiles[f] ? 'Hide' : 'Show diff'}</button>

                    {expandedFiles[f] ? (
                      <div style={{ marginTop: 8 }}>
                        <pre className="message-data" style={{ margin: 0 }}><code>{escapeHtml(`--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-Placeholder\n+Updated by runner`)}</code></pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 12, borderRadius: 12, background: '#fff', boxShadow: '0 6px 18px rgba(2,6,23,0.04)', border: '1px solid #eef2ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontWeight: 800 }}>⚙ Execution</div>
              <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{statusLabel}</div>
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {rc !== null ? <div style={{ padding: '6px 10px', borderRadius: 999, background: '#f3f4f6', fontWeight: 700 }}>{`RC ${String(rc)}`}</div> : null}
                <div style={{ padding: '6px 10px', borderRadius: 999, background: statusColor, color: '#fff', fontWeight: 700 }}>{statusLabel}</div>
                {duration ? <div style={{ marginLeft: 'auto', color: '#6b7280' }}>{safeText(duration)}</div> : null}
              </div>

              <div style={{ marginTop: 12 }}>
                {convId ? <div style={{ fontSize: 13, color: '#6b7280' }}>Conversation: <strong>{safeText(convId)}</strong></div> : null}
                {runDir ? <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>Run directory: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' }}>{safeText(runDir)}</span></div> : null}
                {resp ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Response preview</div>
                    <pre className="message-data" style={{ maxHeight: 180, overflow: 'auto' }}><code>{escapeHtml(typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2))}</code></pre>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12, borderRadius: 12, background: '#fff', boxShadow: '0 6px 18px rgba(2,6,23,0.04)', border: '1px solid #eef2ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontWeight: 800 }}>🧪 Tests</div>
              <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{tests ? (testsOk ? 'PASS' : 'FAIL') : '—'}</div>
            </div>

            <div style={{ marginTop: 10, color: '#374151' }}>
              {tests ? (
                <div style={{ fontSize: 13 }}>{safeText(typeof tests === 'string' ? tests : JSON.stringify(tests))}</div>
              ) : (
                <div style={{ fontSize: 13, color: '#6b7280' }}>No test results available</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ padding: 12, borderRadius: 12, background: '#fff', boxShadow: '0 6px 18px rgba(2,6,23,0.04)', border: '1px solid #eef2ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Logs</div>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>Collapsed</div>
          </div>

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>Expand</summary>
            <pre className="message-data" style={{ marginTop: 8 }}><code>{escapeHtml(logs || 'Runner output unavailable')}</code></pre>
          </details>
        </div>

        <div className="card" style={{ padding: 12, borderRadius: 12, background: '#fff', boxShadow: '0 6px 18px rgba(2,6,23,0.04)', border: '1px solid #eef2ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Conversation metadata</div>
          </div>

          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Conversation</div><div style={{ fontWeight: 700 }}>{safeText(task.conversationId || convId || '')}</div></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Task</div><div style={{ fontWeight: 700 }}>{safeText(task.taskId || '')}</div></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Runner</div><div style={{ fontWeight: 700 }}>{safeText((task.runner || (task.executionReport && task.executionReport.runner)) || 'SDK')}</div></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Matrix</div><div style={{ fontWeight: 700 }}>Connected</div></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Kafka</div><div style={{ fontWeight: 700 }}>Connected</div></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ color: '#6b7280', width: 140 }}>Human reviewer</div><div style={{ fontWeight: 700 }}>{task.reviewerSummary ? 'Present' : 'None'}</div></div>
          </div>
        </div>
      </div>

    </div>
  )
}
