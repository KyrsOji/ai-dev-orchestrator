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
  let out = t.replace(/```([\s\S]*?)```/g, function (m: any, g: any) {
    return '<pre class="md-code"><code>' + escapeHtml(g) + '</code></pre>'
  })
  out = out.replace(/`([^`]+)`/g, function (m: any, g: any) { return '<code>' + g + '</code>' })
  out = out.replace(/\*\*([^*]+)\*\*/g, function (m: any, g: any) { return '<strong>' + g + '</strong>' })
  out = out.replace(/\*([^*]+)\*/g, function (m: any, g: any) { return '<em>' + g + '</em>' })
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m: any, g1: any, g2: any) { return '<a href="' + g2 + '" target="_blank" rel="noopener noreferrer">' + g1 + '</a>' })
  out = out.replace(/\n/g, '<br/>')
  return out
}

export default function ConversationSystemEvent({ event }: any) {
  const timeStr = event && event.createdAt ? new Date(event.createdAt).toLocaleString() : ''
  const label = 'System'
  const col = { bg: '#fff7ed', avatar: '#f59e0b', text: '#1f2937' }
  const initials = 'S'
  const body = safeText(event && event.text)

  return (
    <div className="chat-row" style={{ marginBottom: 8 }}>
      <div className="chat-avatar" style={{ background: col.avatar }}>{initials}</div>
      <div className="chat-main" style={{ maxWidth: '100%' }}>
        <div className="chat-meta">
          <span className="chat-actor" style={{ color: col.avatar, fontWeight: 700 }}>{label}</span>
          <span className="chat-time" style={{ marginLeft: 8 }}>{timeStr}</span>
        </div>
        <div className={`chat-bubble actor-system`} style={{ background: col.bg, color: col.text }} dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      </div>
    </div>
  )
}
