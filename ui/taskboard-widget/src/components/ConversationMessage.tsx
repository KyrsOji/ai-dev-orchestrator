import React from 'react'
import { safeText } from './safeText'

function escapeHtml(s: any) {
  try {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  } catch (e) {
    return ''
  }
}

function renderMarkdown(raw: any) {
  const t = escapeHtml(raw === null || raw === undefined ? '' : raw)
  // code blocks
  let out = t.replace(/```([\s\S]*?)```/g, function (m: any, g: any) {
    return '<pre class="md-code"><code>' + escapeHtml(g) + '</code></pre>'
  })
  // inline code
  out = out.replace(/`([^`]+)`/g, function (m: any, g: any) { return '<code>' + g + '</code>' })
  // bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, function (m: any, g: any) { return '<strong>' + g + '</strong>' })
  // italics *text*
  out = out.replace(/\*([^*]+)\*/g, function (m: any, g: any) { return '<em>' + g + '</em>' })
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m: any, g1: any, g2: any) { return '<a href="' + g2 + '" target="_blank" rel="noopener noreferrer">' + g1 + '</a>' })
  // line breaks
  out = out.replace(/\n/g, '<br/>')
  return out
}

export default function ConversationMessage({ message }: any) {
  const timeStr = message && message.createdAt ? new Date(message.createdAt).toLocaleString() : ''
  const authorRaw = (message && message.author) ? String(message.author) : ''
  let actor = authorRaw.toLowerCase()
  if (actor === 'result' || actor === 'openhands') actor = 'openhands'
  if (actor === 'user' || actor === 'human') actor = 'human'
  if (actor === 'follow_up' || actor === 'followup') actor = 'followup'
  if (message && message.data && message.data._runner_marker) actor = 'execution'

  const actorLabelMap: any = {
    human: 'Human',
    reviewer: 'Reviewer',
    openhands: 'OpenHands',
    system: 'System',
    matrix: 'Matrix',
    followup: 'Follow-up',
    execution: 'Execution',
    note: 'Note',
    second_opinion: 'Second Opinion',
    result: 'OpenHands',
  }
  const label = actorLabelMap[actor] || (authorRaw || '')

  const colorMap: any = {
    human: { bg: '#bfdbfe', avatar: '#2563eb', text: '#0f172a' },
    reviewer: { bg: '#f3f4f6', avatar: '#6b7280', text: '#0f172a' },
    openhands: { bg: '#f5f3ff', avatar: '#7c3aed', text: '#0f172a' },
    system: { bg: '#fff7ed', avatar: '#f59e0b', text: '#1f2937' },
    matrix: { bg: '#ecfdf5', avatar: '#16a34a', text: '#064e3b' },
    followup: { bg: '#ecfeff', avatar: '#06b6d4', text: '#064e3b' },
    execution: { bg: '#fff7ed', avatar: '#f97316', text: '#1f2937' },
    default: { bg: '#ffffff', avatar: '#94a3b8', text: '#111827' },
  }

  const col = colorMap[actor] || colorMap.default
  const initials = label ? label.split(/\s+/).map((s: any) => s[0]).slice(0, 2).join('').toUpperCase() : ''

  const body = safeText(message && message.text)

  return (
    <div className={`chat-row ${actor === 'human' ? 'me' : ''}`} style={{ marginBottom: 8 }}>
      {!(actor === 'human') && <div className="chat-avatar" style={{ background: col.avatar }}>{initials}</div>}
      <div className="chat-main" style={{ maxWidth: '100%' }}>
        <div className="chat-meta">
          <span className="chat-actor" style={{ color: col.avatar, fontWeight: 700 }}>{label}</span>
          <span className="chat-time" style={{ marginLeft: 8 }}>{timeStr}</span>
        </div>
        <div className={`chat-bubble actor-${actor}`} style={{ background: col.bg, color: col.text }} dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        {message && message.data ? <pre className="message-data" style={{ marginTop: 8, background: '#fff', padding: 8, borderRadius: 8 }}>{JSON.stringify(message.data, null, 2)}</pre> : null}
      </div>
      {actor === 'human' && <div className="chat-avatar" style={{ background: col.avatar }}>{initials}</div>}
    </div>
  )
}
