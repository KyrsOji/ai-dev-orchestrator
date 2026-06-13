import React, { useEffect, useState } from 'react'
import { Task, ProposedAction } from './types'

declare global { interface Window { matrixWidgetApi?: any; MatrixWidgetApi?: any } }

const matrixAvailable = typeof window !== 'undefined' && (!!(window as any).matrixWidgetApi || !!(window as any).MatrixWidgetApi)

function uuid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const api = {
  async getTasks(): Promise<Task[]> {
    const res = await fetch('/api/tasks')
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
  },
  async saveTask(task: Task): Promise<Task[]> {
    const res = await fetch('/api/task/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) throw new Error('Failed to save task')
    return res.json()
  },
}

const Column = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="column">
    <h3>{title}</h3>
    {children}
  </div>
)

function TaskDetail({ task, onSave }: { task: Task; onSave: (t: Task) => Promise<any> }) {
  const [local, setLocal] = useState<Task>(task)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error' | null; message: string | null }>({ type: null, message: null })
  useEffect(() => setLocal(task), [task])

  function update(change: Partial<Task>) {
    const updated = { ...local, ...change }
    setLocal(updated)
  }

  async function handleSave() {
    await onSave(local)
    setToast({ type: 'success', message: 'Saved locally' })
    setTimeout(() => setToast({ type: null, message: null }), 3000)
  }

  function addAction() {
    const newAct: ProposedAction = {
      id: uuid('act-'),
      type: 'manual',
      description: 'New action',
      payload: {},
    }
    const updated = { ...local, proposedActions: [...local.proposedActions, newAct] }
    setLocal(updated)
    // Try to inform Matrix about the new action (does not change status)
    sendActionEvent('new_action', { newAction: newAct }).catch(() => {})
  }

  function updateAction(id: string, change: Partial<ProposedAction>) {
    const actions = local.proposedActions.map((a) => (a.id === id ? { ...a, ...change } : a))
    update({ proposedActions: actions })
  }

  function removeAction(id: string) {
    update({ proposedActions: local.proposedActions.filter((a) => a.id !== id) })
  }

  async function sendMatrixEvent(content: any): Promise<boolean> {
    try {
      const mw = (window as any).matrixWidgetApi
      if (mw) {
        if (typeof mw.requestSendEvent === 'function') {
          await mw.requestSendEvent('ai.dev.taskboard.action', content)
          return true
        }
        if (typeof mw.sendEvent === 'function') {
          await mw.sendEvent('ai.dev.taskboard.action', content)
          return true
        }
      }

      const MWC = (window as any).MatrixWidgetApi
      if (MWC) {
        try {
          const parentOrigin = document.referrer || window.location.origin
          const widgetApi = new MWC(parentOrigin)
          if (typeof widgetApi.requestSendEvent === 'function') {
            await widgetApi.requestSendEvent('ai.dev.taskboard.action', content)
            return true
          }
          if (typeof widgetApi.sendEvent === 'function') {
            await widgetApi.sendEvent('ai.dev.taskboard.action', content)
            return true
          }
        } catch (e) {
          // ignore
        }
      }

      return false
    } catch (e) {
      console.error('sendMatrixEvent failed', e)
      return false
    }
  }

  async function sendActionEvent(decision: 'approved' | 'denied' | 'deferred' | 'edited' | 'new_action', opts: any = {}) {
    const selectedActionObj = local.proposedActions.find((a) => a.id === local.selectedAction) || null
    const policy = (selectedActionObj && selectedActionObj.type) || (local.proposedActions[0] && local.proposedActions[0].type) || 'manual'

    const content = {
      taskId: local.taskId,
      decision,
      policy,
      selectedAction: selectedActionObj,
      editedAction: opts.editedAction || null,
      newAction: opts.newAction || null,
      notes: local.notes || null,
      source: 'element-widget',
      createdAt: new Date().toISOString(),
    }

    if (matrixAvailable) {
      setToast({ type: 'warning', message: 'Sending to Matrix...' })
      const ok = await sendMatrixEvent(content)
      if (ok) {
        setToast({ type: 'success', message: 'Action sent to Matrix' })
        setTimeout(() => setToast({ type: null, message: null }), 3000)
        return true
      } else {
        setToast({ type: 'error', message: 'Failed to send Matrix event' })
        setTimeout(() => setToast({ type: null, message: null }), 3000)
        return false
      }
    } else {
      // fallback to local save; only change status for explicit decisions
      let newStatus = local.status
      if (decision === 'approved') newStatus = 'approved'
      else if (decision === 'denied') newStatus = 'denied'
      else if (decision === 'deferred') newStatus = 'deferred'

      const updated: Task = {
        ...local,
        status: newStatus,
      }

      await onSave(updated)
      setLocal(updated)
      // Saved locally is a success toast
      setToast({ type: 'success', message: 'Saved locally' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
      return false
    }
  }

  async function doDecision(decision: 'approved' | 'denied' | 'deferred') {
    await sendActionEvent(decision)
  }

  async function sendEditAction(a: ProposedAction) {
    await sendActionEvent('edited', { editedAction: a })
  }

  const selectedActionObj = local.proposedActions.find((a) => a.id === local.selectedAction) || null

  return (
    <div className="task-detail">
      <h2>{local.title}</h2>
      <div className="muted">{local.taskId}</div>

      {/* connection/info */}
      <div style={{ marginBottom: 8 }}>
        <strong>Connection:</strong> {matrixAvailable ? 'Matrix Connected' : 'Local Mode'}
      </div>

      {/* toast */}
      {toast.message ? (
        <div className={`toast ${toast.type ? `toast-${toast.type}` : ''}`}>{toast.message}</div>
      ) : null}

      <div className="panel">
        <h4>OpenHands output</h4>
        <pre>{local.openhandsResponse}</pre>
      </div>

      <div className="panel">
        <h4>Reviewer summary</h4>
        <pre>{local.reviewerSummary}</pre>
      </div>

      <div className="panel">
        <h4>Proposed actions</h4>
        <button className="small" onClick={addAction} style={{ marginBottom: 8 }}>
          + Create New Action
        </button>
        <div style={{ marginBottom: 8 }}>
          <strong>Selected:</strong>{' '}
          {selectedActionObj ? `${selectedActionObj.description} (${selectedActionObj.id})` : 'None'}
        </div>
        {local.proposedActions.map((a) => (
          <div key={a.id} className="action">
            <input
              type="radio"
              name={`selected-${local.taskId}`}
              checked={local.selectedAction === a.id}
              onChange={() => update({ selectedAction: a.id })}
              title="Select this action"
            />
            <input
              type="text"
              value={a.description}
              onChange={(e) => updateAction(a.id, { description: e.target.value })}
            />
            <select value={a.type} onChange={(e) => updateAction(a.id, { type: e.target.value })}>
              <option value="commit">commit</option>
              <option value="push">push</option>
              <option value="docs">docs</option>
              <option value="test">test</option>
              <option value="manual">manual</option>
            </select>
            <button className="small" onClick={() => removeAction(a.id)}>
              Remove
            </button>
            <button className="small" onClick={() => sendEditAction(a)} style={{ marginLeft: 8 }}>
              Submit Edited Action
            </button>
          </div>
        ))}
      </div>

      <div className="panel">
        <h4>Notes</h4>
        <textarea value={local.notes} onChange={(e) => update({ notes: e.target.value })} />
      </div>

      <div className="buttons">
        <button onClick={handleSave}>Save</button>
        <button onClick={() => doDecision('approved')} disabled={!local.selectedAction}>
          Approve Selected Action
        </button>
        <button onClick={() => doDecision('denied')}>Deny</button>
        <button onClick={() => doDecision('deferred')}>Defer</button>
      </div>
    </div>
  )
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getTasks()
      setTasks(data)
      if (!selected && data.length > 0) setSelected(data[0].taskId)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function saveTask(task: Task) {
    const data = await api.saveTask(task)
    setTasks(data)
    return data
  }

  const pending = tasks.filter((t) => t.status === 'pending_review')
  const approved = tasks.filter((t) => t.status === 'approved')
  const completed = tasks.filter((t) => t.status === 'completed')

  const current = tasks.find((t) => t.taskId === selected) || null

  return (
    <div className="app">
      <header>
        <h1>Task Board MVP</h1>
      </header>
      <div className="board">
        <div className="columns">
          <Column title="Pending Review">
            {pending.map((t) => (
              <div
                className={'card' + (selected === t.taskId ? ' selected' : '')}
                key={t.taskId}
                onClick={() => setSelected(t.taskId)}
              >
                <div className="card-title">{t.title}</div>
                <div className="muted">{t.taskId}</div>
              </div>
            ))}
          </Column>

          <Column title="Approved">
            {approved.map((t) => (
              <div
                className={'card' + (selected === t.taskId ? ' selected' : '')}
                key={t.taskId}
                onClick={() => setSelected(t.taskId)}
              >
                <div className="card-title">{t.title}</div>
                <div className="muted">{t.taskId}</div>
              </div>
            ))}
          </Column>

          <Column title="Completed">
            {completed.map((t) => (
              <div
                className={'card' + (selected === t.taskId ? ' selected' : '')}
                key={t.taskId}
                onClick={() => setSelected(t.taskId)}
              >
                <div className="card-title">{t.title}</div>
                <div className="muted">{t.taskId}</div>
              </div>
            ))}
          </Column>
        </div>

        <div className="detail-pane">
          {current ? (
            <TaskDetail
              task={current}
              onSave={async (t) => {
                const d = await saveTask(t)
                await load()
                return d
              }}
            />
          ) : (
            <div>Select a task to view details</div>
          )}
        </div>
      </div>
    </div>
  )
}
