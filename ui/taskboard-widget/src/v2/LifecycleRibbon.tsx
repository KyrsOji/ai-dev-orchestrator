import React from 'react'
import StatusBadge from './StatusBadge'
import { STAGES, determineStage } from './lifecycle'

export default function LifecycleRibbon({ task }: { task?: any }) {
  const stage = determineStage(task)
  const idx = STAGES.findIndex((s) => s === stage)

  const circleSize = 28
  const completedColor = '#10b981'
  const currentColor = '#3b82f6'
  const futureColor = '#d1d5db'

  return (
    <div style={{ padding: 12, borderBottom: '1px solid #eee', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Engineering Session</div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusBadge label={stage} ok={true} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* placeholder for potential stage actions or meta */}
        </div>
      </div>

      <div style={{ marginTop: 12, overflowX: 'auto' }} aria-label="Engineering session lifecycle" role="list">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 640, paddingBottom: 6 }}>
          {STAGES.map((s, i) => {
            const isCompleted = i < idx
            const isCurrent = i === idx
            const circleBg = isCompleted ? completedColor : isCurrent ? currentColor : futureColor
            const labelColor = isCompleted ? '#065f46' : isCurrent ? '#0f172a' : '#6b7280'
            const lineColor = i < idx ? completedColor : '#e5e7eb'

            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12 }} role="listitem">
                <div
                  tabIndex={0}
                  aria-current={isCurrent ? 'step' : undefined}
                  role="button"
                  onKeyDown={(e) => { if (e.key === 'Enter') { /* no-op for now */ } }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}
                >
                  <div style={{ width: circleSize, height: circleSize, borderRadius: 999, background: circleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
                    {isCompleted ? '✓' : s.charAt(0)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: labelColor, whiteSpace: 'nowrap' }}>{s}</div>
                </div>

                {i !== STAGES.length - 1 ? (
                  <div aria-hidden style={{ width: 40, height: 2, background: lineColor }} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
