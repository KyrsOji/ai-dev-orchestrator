import React from 'react'

export default function ConversationSessionChain({ task, tasks, openTask }: any) {
  try {
    if (!task) return null
    const chain: any[] = []
    let cur: any = task
    const byId: { [k: string]: any } = {}
    if (Array.isArray(tasks)) tasks.forEach((t: any) => { if (t && t.taskId) byId[t.taskId] = t })

    while (cur) {
      chain.unshift(cur)
      const parentId = cur.parentTaskId || cur.rootTaskId || null
      if (!parentId) break
      const p = byId[parentId]
      if (!p) break
      cur = p
    }

    return (
      <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eef2ff', background: '#fbfbff' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Session Chain</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {chain.map((n: any, i: number) => (
            <div key={n.taskId || i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ cursor: openTask ? 'pointer' : 'default', padding: '4px 8px', borderRadius: 6, background: '#fff' }} onClick={() => { if (openTask && n && n.taskId) openTask(n.taskId) }}>{n.taskId || '(unknown)'}</div>
              {i < chain.length - 1 ? <div style={{ color: '#666' }}>➜</div> : null}
            </div>
          ))}
        </div>
      </div>
    )
  } catch (e) {
    return null
  }
}
