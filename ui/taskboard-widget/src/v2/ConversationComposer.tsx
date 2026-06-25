import React, { useState } from 'react'

export default function ConversationComposer({ onSend }: { onSend?: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div style={{ padding: 8, borderTop: '1px solid #eee', background: '#fff', display: 'flex', gap: 8 }}>
      <textarea style={{ flex: 1, minHeight: 48 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="small" onClick={() => { onSend && onSend(text); setText('') }}>Send</button>
      </div>
    </div>
  )
}
