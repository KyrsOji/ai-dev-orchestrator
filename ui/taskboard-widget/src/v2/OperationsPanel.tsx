import React from 'react'
import StatusBadge from './StatusBadge'

export default function OperationsPanel({ runnerStatus, agents }: { runnerStatus?: any; agents?: any[] }) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>Runner Status</div>
        <div style={{ marginTop: 6 }}>{runnerStatus ? <StatusBadge label={runnerStatus.status || 'unknown'} ok={runnerStatus && runnerStatus.status === 'running'} /> : <div className="muted">Unknown</div>}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>Agent Capacity</div>
        <div style={{ marginTop: 6 }}>{Array.isArray(agents) ? `${agents.length} agents` : 'Unknown'}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>Notifications</div>
        <div style={{ marginTop: 6 }} className="muted">No new notifications</div>
      </div>
    </div>
  )
}
