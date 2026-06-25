import React from 'react'

export default function StatusBadge({ label, ok = true }: { label: string; ok?: boolean }) {
  return <span style={{ padding: '4px 8px', borderRadius: 6, background: ok ? '#ecfeff' : '#fee2e2', color: ok ? '#064e3b' : '#7f1d1d', fontWeight: 600 }}>{label}</span>
}
