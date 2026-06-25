import React, { useState } from 'react'

export default function ConversationComposer({
  placeholder = 'Write a note...',
  disabled = false,
  initialText = '',
  onSubmit,
  sendLabel = 'Send',
  rows = 4,
}: {
  placeholder?: string
  disabled?: boolean
  initialText?: string
  onSubmit?: (text: string) => Promise<any> | void
  sendLabel?: string
  rows?: number
}) {
  const [value, setValue] = useState<string>(initialText || '')
  const [working, setWorking] = useState<boolean>(false)

  async function handleSubmit() {
    if (!value || !value.trim()) return
    if (!onSubmit) {
      // No-op fallback: caller didn't provide a handler
      // This is intentional in some embedding contexts.
      // Please wire `onSubmit` to persist notes/actions where required.
      console.warn('ConversationComposer: no onSubmit handler provided (no-op)')
      setValue('')
      return
    }
    try {
      setWorking(true)
      const maybe = onSubmit(value)
      if (maybe && typeof (maybe as any).then === 'function') await maybe
      setValue('')
    } catch (e) {
      console.error('ConversationComposer submit error', e)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled || working}
        onChange={(e) => setValue((e.target as HTMLTextAreaElement).value)}
        style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 6, border: '1px solid #e6edf3' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          className="small"
          disabled={disabled || working || !value.trim()}
          onClick={handleSubmit}
          style={{ background: '#0ea5a4', color: '#fff', border: 'none' }}
          aria-disabled={disabled || working || !value.trim()}
        >
          {working ? 'Sending...' : sendLabel}
        </button>
      </div>
    </div>
  )
}
