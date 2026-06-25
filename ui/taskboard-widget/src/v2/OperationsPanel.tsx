import React, { useState } from 'react'
import StatusBadge from './StatusBadge'

export default function OperationsPanel({ runnerStatus, agents }: { runnerStatus?: any; agents?: any[] }) {
  const [collapsed, setCollapsed] = useState(true)

  const agentCount = Array.isArray(agents) ? agents.length : 0
  const runner = runnerStatus && runnerStatus.status ? runnerStatus.status : 'unknown'

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Operations</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge label={`Runner: ${runner}`} ok={runner === 'connected'} color={runner === 'connected' ? '#ecfeff' : undefined} />
            <StatusBadge label={`Agents: ${agentCount}`} color={agentCount > 0 ? '#fff7ed' : undefined} />
          </div>
          <button className="small" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} style={{ marginLeft: 8 }}>{collapsed ? 'Expand' : 'Collapse'}</button>
        </div>
      </div>

      {!collapsed ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>Agent Capacity</div>
            <div style={{ marginTop: 6 }}>{Array.isArray(agents) ? `${agents.length} agents` : 'Unknown'}</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>Notifications</div>
            <div style={{ marginTop: 6 }} className="muted">No new notifications</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>Health</div>
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <StatusBadge label="Runner" ok={runner === 'connected'} />
                <StatusBadge label="Matrix" ok={true} />
                <StatusBadge label="Kafka" ok={true} />
                <StatusBadge label="SDK" ok={true} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
