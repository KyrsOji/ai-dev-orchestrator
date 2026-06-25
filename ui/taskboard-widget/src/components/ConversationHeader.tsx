import React from 'react'

export default function ConversationHeader({ task, tasks, openTask }: any) {
  // build compact session breadcrumb
  let breadcrumb: any[] = []
  try {
    if (task) {
      const byId: { [k: string]: any } = {}
      if (Array.isArray(tasks)) tasks.forEach((t: any) => { if (t && t.taskId) byId[t.taskId] = t })
      let cur: any = task
      while (cur) {
        breadcrumb.unshift(cur)
        const parentId = cur.parentTaskId || cur.rootTaskId || null
        if (!parentId) break
        const p = byId[parentId]
        if (!p) break
        cur = p
      }
    }
  } catch (e) {
    breadcrumb = []
  }

  return (
    <div style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 8, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{task && (task.title || task.taskId) ? (task.title || task.taskId) : 'Conversation'}</div>
          <div style={{ fontSize: 13, color: '#666' }}>Conversation: {task && task.conversationId ? task.conversationId : '(none)'}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#666' }}>Participants: Human · Reviewer · OpenHands</div>
        </div>
      </div>

      {breadcrumb && breadcrumb.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: 12, color: '#444' }}>
          <span style={{ fontWeight: 700, marginRight: 8 }}>Session</span>
          {breadcrumb.map((b: any, i: number) => (
            <span key={b.taskId || i} style={{ marginRight: 6, cursor: openTask ? 'pointer' : 'default' }} onClick={() => { if (openTask && b && b.taskId) openTask(b.taskId) }}>{b.taskId || '(unknown)'}{i < breadcrumb.length - 1 ? ' → ' : ''}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
