import React from 'react'

export default function StatusBadge({ label, ok = true, color }: { label: string; ok?: boolean; color?: string }) {
  const bg = color || (ok ? '#ecfeff' : '#fee2e2')
  const fg = color ? '#0f172a' : (ok ? '#064e3b' : '#7f1d1d')
  return <span style={{ padding: '6px 10px', borderRadius: 999, background: bg, color: fg, fontWeight: 700, fontSize: 12 }}>{label}</span>
}
