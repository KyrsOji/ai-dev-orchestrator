import React, { useEffect, useState } from 'react'
import ConversationList from './v2/ConversationList'
import ConversationPanel from './v2/ConversationPanel'
import LifecycleRibbon from './v2/LifecycleRibbon'

import OperationsPanel from './v2/OperationsPanel'
import { fetchTasks, fetchFollowups, fetchRunnerStatus, fetchAgents } from './v2/api'

export default function TaskboardV2() {
  const [tasks, setTasks] = useState<any[]>([])
  const [followups, setFollowups] = useState<any[]>([])
  const [runnerStatus, setRunnerStatus] = useState<any>(null)
  const [agents, setAgents] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const t = await fetchTasks()
        setTasks(Array.isArray(t) ? t : [])
      } catch (e) { console.error('load tasks error', e) }
      try {
        const f = await fetchFollowups()
        setFollowups(Array.isArray(f) ? f : [])
      } catch (e) { console.error('load followups error', e) }
      try {
        const r = await fetchRunnerStatus()
        setRunnerStatus(r)
      } catch (e) { /* ignore */ }
      try {
        const a = await fetchAgents()
        setAgents(Array.isArray(a) ? a : [])
      } catch (e) { /* ignore */ }
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const selectedTask = tasks.find((t) => t.taskId === selectedId) || (tasks.length ? tasks[0] : null)
  useEffect(() => { if (!selectedId && tasks.length) setSelectedId(tasks[0].taskId) }, [tasks])

  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  async function handleTaskUpdate(updatedTask: any) {
    // optimistic local update: replace existing task or add if not present
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t && t.taskId === updatedTask.taskId)
      const next = prev.slice()
      if (idx === -1) {
        // add to front so it is visible
        next.unshift(updatedTask)
      } else {
        next[idx] = updatedTask
      }
      return next
    })

    // Fire-and-forget save to backend; keep UI optimistic regardless of save result
    try {
      // If task has no taskId, let server assign one (don't send taskId field)
      let bodyToSend: any = { ...updatedTask }
      if (!bodyToSend.taskId) {
        // remove taskId if falsy to allow server to generate
        delete bodyToSend.taskId
      }

      const res = await fetch('/taskboard/api/task/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyToSend),
      })

      if (!res.ok) throw new Error(`Save failed: ${res.status} ${res.statusText}`)

      const data = await res.json()

      if (Array.isArray(data)) {
        // Reconcile: put returned (stored) tasks first, then append any local-only tasks (synthetic) that aren't in returned data
        setTasks((prev) => {
          try {
            const returned = data.slice()
            const returnedIds = new Set(returned.map((t: any) => t.taskId))
            // Append prev tasks that are not in returned data (keeps synthetic tasks)
            for (const p of prev) {
              if (!returnedIds.has(p.taskId)) returned.push(p)
            }
            return returned
          } catch (e) {
            return prev
          }
        })
      }
    } catch (e: any) {
      console.error('task save error', e)
      try {
        setSaveMessage(e && e.message ? String(e.message) : 'Failed to save task')
        setTimeout(() => setSaveMessage(null), 5000)
      } catch (e) {}
    }
  }


  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ width: 320, overflow: 'auto' }}>
        <h2>Work items</h2>
        <ConversationList tasks={tasks} selectedId={selectedTask ? selectedTask.taskId : undefined} onSelect={(id) => setSelectedId(id)} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #eee', borderRight: '1px solid #eee' }}>
        <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0 }}>{selectedTask ? (selectedTask.title || selectedTask.taskId) : 'Conversation'}</h2>
              <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
                SDK Conversation · {selectedTask && selectedTask.taskId ? `Task ${selectedTask.taskId}` : ''}
                {selectedTask && selectedTask.conversationId ? ` · Conversation ${selectedTask.conversationId}` : ''}
                {selectedTask && selectedTask.rootTaskId ? ` · ROOT → ${selectedTask.rootTaskId}` : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Runner:</div>
              <div style={{ fontWeight: 700 }}>{runnerStatus ? runnerStatus.status : 'unknown'}</div>

              <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 6 }}>Follow-ups:</div>
              <div style={{ fontWeight: 700 }}>{followups ? followups.length : 0}</div>
            </div>
          </div>

          {/* Lifecycle ribbon -- immediately below the session title, above the conversation */}
          {/* render the ribbon inside the header area so it stays visible */}
        </div>

        {/* Lifecycle ribbon */}
        <div>
          {saveMessage ? (
            <div style={{ padding: 8, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8, marginBottom: 8 }}>{saveMessage}</div>
          ) : null}
          <LifecycleRibbon task={selectedTask} />
        </div>

        <div style={{ flex: 1 }}>
          <ConversationPanel task={selectedTask} followups={followups} onTaskUpdate={handleTaskUpdate} />
        </div>
      </div>

      <div style={{ width: 320, overflow: 'auto', padding: 12 }}>
        <h3>Operations</h3>
        <OperationsPanel runnerStatus={runnerStatus} agents={agents} />
      </div>
    </div>
  )
}
