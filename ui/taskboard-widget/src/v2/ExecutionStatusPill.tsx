import React from 'react'

export default function ExecutionStatusPill({ status }: { status?: string }) {
  const s = (status || '').toLowerCase()
  const label = s ? (String(s).charAt(0).toUpperCase() + String(s).slice(1)) : 'Unknown'
  const color = s === 'completed' ? '#10b981' : s === 'running' ? '#f59e0b' : s === 'failed' ? '#ef4444' : s === 'cancelled' ? '#6b7280' : s === 'published' ? '#3b82f6' : '#6b7280'
  return (
    <div className="exec-status-pill" style={{ background: color, color: '#fff', padding: '6px 10px', borderRadius: 999, fontWeight: 700, fontSize: 12 }}>
      {label}
    </div>
  )
}
