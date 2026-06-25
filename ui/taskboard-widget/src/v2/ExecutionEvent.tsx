import React, { useState } from 'react'
import ExecutionStatusPill from './ExecutionStatusPill'
import ExecutionDetailsDrawer from './ExecutionDetailsDrawer'
import { safeText } from '../components/safeText'

function formatTime(iso: string | number | undefined) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleTimeString()
  } catch (e) {
    return String(iso)
  }
}

export default function ExecutionEvent({ event, exec }: { event: any; exec?: any }) {
  const [open, setOpen] = useState(false)
  const title = event.title || event.name || event.type || 'Event'
  const subtitle = event.subtitle || event.note || ''
  const ts = event.ts || event.time || event.createdAt || event.updatedAt || ''

  return (
    <div className={`execution-item ${open ? 'open' : ''}`}>
      <div className="execution-item-row" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e:any)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); setOpen(!open) } }}>
        <div className="execution-item-left">
          <div className="execution-dot" aria-hidden />
          <div className="execution-line" aria-hidden />
        </div>

        <div className="execution-item-main">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ minWidth: 80, color: '#6b7280', fontSize: 13 }}>{formatTime(ts)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>{safeText(title)}</div>
              {subtitle ? <div style={{ color: '#6b7280', marginTop: 4 }}>{safeText(subtitle)}</div> : null}
            </div>
            <div style={{ marginLeft: 'auto' }}>
              {exec && exec.executionStatus ? <ExecutionStatusPill status={exec.executionStatus} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className={`execution-item-details ${open ? 'open' : ''}`}> 
        {open ? <ExecutionDetailsDrawer exec={exec} /> : null}
      </div>
    </div>
  )
}
