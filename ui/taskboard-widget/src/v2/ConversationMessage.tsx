import React, { useState } from 'react'
import { safeText } from '../components/safeText'

type Event = {
  id?: string
  type?: string
  text?: any
  ts?: string
  data?: any
  followup?: any
}

function escapeHtml(s: any) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTime(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleString()
  } catch (e) {
    return String(ts)
  }
}

function initialsFor(actorLabel: string) {
  if (!actorLabel) return '??'
  const parts = actorLabel.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return actorLabel.slice(0, 2).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + (parts[1][0] || '')).toUpperCase()
}

function renderMarkdown(raw: string) {
  if (!raw && raw !== 0) return ''
  let text = String(raw)
  // escape HTML first
  text = escapeHtml(text)

  // Extract fenced code blocks to placeholders
  const codeBlocks: string[] = []
  text = text.replace(/```(?:([^\n]*)\n)?([\s\S]*?)```/g, (_m, _lang, code) => {
    codeBlocks.push(escapeHtml(code))
    return `@@CODE_BLOCK_${codeBlocks.length - 1}@@`
  })

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => {
    const safeUrl = escapeHtml(u)
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t}</a>`
  })

  // Inline code `...`
  text = text.replace(/`([^`]+)`/g, (_m, c) => `<code>${escapeHtml(c)}</code>`)

  // Bold **text** or __text__
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, g) => `<strong>${g}</strong>`)
  text = text.replace(/__([^_]+)__/g, (_m, g) => `<strong>${g}</strong>`)

  // Italic *text* or _text_
  text = text.replace(/\*([^*]+)\*/g, (_m, g) => `<em>${g}</em>`)
  text = text.replace(/_([^_]+)_/g, (_m, g) => `<em>${g}</em>`)

  // Split into lines and handle headings and lists
  const lines = text.split(/\r?\n/)
  let out = ''
  let inUl = false
  let inOl = false

  function closeLists() {
    if (inUl) { out += '</ul>'; inUl = false }
    if (inOl) { out += '</ol>'; inOl = false }
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*$/.test(l)) {
      // blank line -> paragraph separator
      closeLists()
      out += '<div style="height:8px"></div>'
      continue
    }

    const headingMatch = l.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      closeLists()
      const lvl = Math.min(6, headingMatch[1].length)
      out += `<h${lvl}>${headingMatch[2]}</h${lvl}>`
      continue
    }

    const ulMatch = l.match(/^\s*[-*+]\s+(.*)$/)
    if (ulMatch) {
      if (!inUl) { closeLists(); out += '<ul>'; inUl = true }
      out += `<li>${ulMatch[1]}</li>`
      continue
    }

    const olMatch = l.match(/^\s*\d+\.\s+(.*)$/)
    if (olMatch) {
      if (!inOl) { closeLists(); out += '<ol>'; inOl = true }
      out += `<li>${olMatch[1]}</li>`
      continue
    }

    // Normal paragraph line
    closeLists()
    out += `<p>${l}</p>`
  }
  closeLists()

  // Restore code blocks
  out = out.replace(/@@CODE_BLOCK_(\d+)@@/g, (_m, idx) => {
    const i = Number(idx)
    const html = codeBlocks[i] || ''
    return `<pre class="md-code"><code>${html}</code></pre>`
  })

  return out
}

const actorMap: any = {
  human: { label: 'ME', class: 'human' },
  reviewer: { label: 'RV', class: 'reviewer' },
  openhands: { label: 'OH', class: 'openhands' },
  result: { label: 'OH', class: 'openhands' },
  system: { label: 'SY', class: 'system' },
  matrix: { label: 'MX', class: 'matrix' },
  followup: { label: 'FU', class: 'followup' },
  execution: { label: 'EX', class: 'execution' },
  action: { label: 'AC', class: 'action' },
}

export default function ConversationMessage({ event }: { event: Event }) {
  if (!event) return null

  let actor = 'human'
  if (event.type === 'system') actor = 'system'
  else if (event.type === 'reviewer') actor = 'reviewer'
  else if (event.type === 'result' || event.type === 'openhands') actor = 'openhands'
  else if (event.type === 'matrix') actor = 'matrix'
  else if (event.type === 'followup') actor = 'followup'
  else if (event.type === 'action') actor = 'action'
  else if (event.data && event.data._runner_marker) actor = 'execution'

  const map = actorMap[actor] || { label: '??', class: 'default' }
  const actorLabel = (actor === 'human') ? 'ME' : (map.label || actor.toUpperCase())
  const initials = initialsFor(actorLabel)
  const body = safeText(event.text)
  const ts = event.ts || event.createdAt || new Date().toISOString()

  const bubbleHtml = { __html: renderMarkdown(String(body)) }

  // avatar color mapping
  const avatarColors: any = {
    human: '#2563eb', // blue
    reviewer: '#6b7280', // gray
    openhands: '#7c3aed', // purple
    system: '#f59e0b', // amber
    matrix: '#10b981', // green
    followup: '#06b6d4', // cyan
    execution: '#f97316', // orange
    action: '#64748b', // slate
    default: '#9ca3af'
  }

  // For execution-style events, attempt to show a compact card
  const isExecution = actor === 'execution' || event.type === 'execution'

  // execution payload helpers (support common field name variations)
  const exec = event.data || {}
  const getField = (o: any, ...names: string[]) => {
    for (const n of names) {
      if (o && o[n] !== undefined && o[n] !== null) return o[n]
    }
    return undefined
  }

  const conversationId = getField(exec, 'conversationId', 'conversation_id')
  const executionStatusRaw = getField(exec, 'executionStatus', 'execution_status', 'status')
  const executionStatus = executionStatusRaw ? String(executionStatusRaw).toLowerCase() : ''
  const statusLabel = executionStatus ? (String(executionStatus).charAt(0).toUpperCase() + String(executionStatus).slice(1)) : 'Unknown'
  const returnCode = getField(exec, 'returnCode', 'return_code', 'rc')
  const duration = getField(exec, 'duration', 'elapsed', 'time')
  const eventTypeCounts = getField(exec, 'eventTypeCounts', 'event_type_counts', 'eventCounts')
  const runDirectory = getField(exec, 'runDirectory', 'run_directory', 'runDir')
  const responsePreview = getField(exec, 'responsePreview', 'response_preview', 'response')
  const summary = getField(exec, 'summary', 'summaryText')
  const taskId = getField(exec, 'taskId', 'task_id', 'id')

  const statusColor = executionStatus === 'completed' ? '#10b981' : executionStatus === 'running' ? '#f59e0b' : executionStatus === 'failed' ? '#ef4444' : '#6b7280'

  const [open, setOpen] = useState(false)

  return (
    <div className={`chat-row ${actor === 'human' ? 'me' : ''}`} tabIndex={0} style={{ animation: 'fadeIn 160ms ease-in' }}>
      <div className="chat-avatar" aria-hidden style={{ background: avatarColors[map.class] || avatarColors.default }}>
        {initials}
      </div>

      <div className="chat-main">
        <div className="chat-meta">
          <div className="chat-actor">{map.class === 'human' ? 'You' : map.class.charAt(0).toUpperCase() + map.class.slice(1)}</div>
          <div className="chat-time">{formatTime(ts)}</div>
        </div>

        {isExecution ? (
          <div className={`chat-bubble actor-${map.class}`}>
            <div className="execution-card">
              <div
                className="execution-header"
                role="button"
                tabIndex={0}
                onClick={() => setOpen(!open)}
                onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="exec-icon" aria-hidden>⚙</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{'SDK Execution'}{taskId ? ` · ${safeText(taskId)}` : ''}</div>
                    {summary ? <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>{safeText(summary)}</div> : null}
                  </div>
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {returnCode !== undefined && returnCode !== null ? (
                    <div className="exec-pill exec-pill-rc">{`RC ${String(returnCode)}`}</div>
                  ) : null}

                  <div className="exec-pill" style={{ background: statusColor, color: '#fff' }}>{statusLabel}</div>

                  <div className={`exec-chevron ${open ? 'open' : ''}`} aria-hidden>▾</div>
                </div>
              </div>

              <div className={`execution-body ${open ? 'open' : ''}`}>
                <div className="execution-grid">
                  {conversationId ? (
                    <div className="execution-field">
                      <div className="field-label">Conversation</div>
                      <div className="field-value">{safeText(conversationId)}</div>
                    </div>
                  ) : null}

                  {duration ? (
                    <div className="execution-field">
                      <div className="field-label">Duration</div>
                      <div className="field-value">{safeText(duration)}</div>
                    </div>
                  ) : null}

                  {eventTypeCounts ? (
                    <div className="execution-field" style={{ flex: '1 1 100%' }}>
                      <div className="field-label">Events</div>
                      <div className="field-value"><pre style={{ margin: 0 }}><code>{escapeHtml(typeof eventTypeCounts === 'string' ? eventTypeCounts : JSON.stringify(eventTypeCounts))}</code></pre></div>
                    </div>
                  ) : null}

                  {runDirectory ? (
                    <div className="execution-field">
                      <div className="field-label">Run Directory</div>
                      <div className="field-value">{safeText(runDirectory)}</div>
                    </div>
                  ) : null}
                </div>

                {responsePreview ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Response Preview</div>
                    <pre className="message-data" style={{ maxHeight: 260, overflow: 'auto' }}><code>{escapeHtml(typeof responsePreview === 'string' ? responsePreview : JSON.stringify(responsePreview, null, 2))}</code></pre>
                  </div>
                ) : null}

              </div>
            </div>
          </div>
        ) : (
          <div className={`chat-bubble actor-${map.class}`} dangerouslySetInnerHTML={bubbleHtml} />
        )}
      </div>
    </div>
  )
}
