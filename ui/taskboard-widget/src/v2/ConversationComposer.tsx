import React, { useState, useRef } from 'react'

export default function ConversationComposer({ onSend }: { onSend?: (text: string) => void }) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  function handleSend() {
    const v = text.trim()
    if (!v) return
    onSend && onSend(v)
    setText('')
    taRef.current && taRef.current.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="composer" style={{ padding: 12, borderTop: '1px solid #eef2ff', background: '#fff', boxShadow: '0 -6px 18px #02061708' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <textarea
          ref={taRef}
          aria-label="Continue the engineering conversation"
          placeholder="Continue the engineering conversation..."
          value={text}
          onKeyDown={handleKeyDown}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minHeight: 64, maxHeight: 200, padding: 12, borderRadius: 12, border: '1px solid #e6eefc', boxShadow: 'inset 0 1px 0 #fff', resize: 'vertical', fontSize: 15 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="big" onClick={handleSend} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: 12, boxShadow: '0 6px 18px #00000014' }}>
            Send
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
        Tip: press Ctrl/Cmd+Enter to send. Use Shift+Enter for newline.
      </div>
    </div>
  )
}
