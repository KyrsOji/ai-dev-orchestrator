import React, { useEffect, useState } from 'react'
import { Task, ProposedAction } from './types'

declare global { interface Window { matrixWidgetApi?: any; MatrixWidgetApi?: any } }

const matrixAvailable = typeof window !== 'undefined' && (!!(window as any).matrixWidgetApi || !!(window as any).MatrixWidgetApi)

function uuid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const api = {
  async getTasks(): Promise<Task[]> {
    const res = await fetch(`${import.meta.env.BASE_URL}api/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
  },
  async saveTask(task: Task): Promise<Task[]> {
    const res = await fetch(`${import.meta.env.BASE_URL}api/task/save`, {
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
  // newActionDraft holds form state for creating a new action inline
  const [newActionDraft, setNewActionDraft] = useState<{ type: string; description: string } | null>(null)
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

  function startNewAction() {
    setNewActionDraft({ type: 'manual', description: '' })
  }

  function cancelNewAction() {
    setNewActionDraft(null)
  }

  function createNewAction() {
    if (!newActionDraft) return
    const newAct: ProposedAction = {
      id: uuid('act-'),
      type: newActionDraft.type,
      description: newActionDraft.description || 'New action',
      payload: {},
    }
    const updated = { ...local, proposedActions: [...local.proposedActions, newAct] }
    setLocal(updated)
    setNewActionDraft(null)
    // Inform Matrix (capture-only); local save occurs when user clicks Draft Changes
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
      <div className="task-header">
        <h2>{local.title}</h2>
        <div className="muted">{local.taskId}</div>
        <div style={{ marginBottom: 8 }}>
          <strong>Connection:</strong> {matrixAvailable ? 'Matrix Connected' : 'Local Mode'}
        </div>
      </div>

      {/* toast */}
      {toast.message ? (
        <div className={`toast ${toast.type ? `toast-${toast.type}` : ''}`}>{toast.message}</div>
      ) : null}

      <div className="task-content">
        {/* Reviewer summary first — primary guidance */}
        <div className="panel panel-reviewer">
          <h4>Reviewer summary</h4>
          <pre>{local.reviewerSummary}</pre>
        </div>

        <div className="panel panel-openhands">
          <h4>OpenHands output</h4>
          <pre>{local.openhandsResponse}</pre>
        </div>

        <div className="panel panel-selected-action">
          <h4>Selected Action</h4>
          {selectedActionObj ? (
            <div className="selected-action-panel">
              <div style={{ fontWeight: 700 }}>{selectedActionObj.description}</div>
              <div className="muted">{selectedActionObj.type} • {selectedActionObj.id}</div>
            </div>
          ) : (
            <div className="muted">No action selected</div>
          )}
        </div>

        <div className="panel panel-actions">
          <h4>Proposed Actions</h4>

          {/* New action inline mini-form */}
          {!newActionDraft ? (
            <button className="small" onClick={startNewAction} style={{ marginBottom: 8 }}>
              + Create New Action
            </button>
          ) : (
            <div className="new-action-form" style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={newActionDraft.type} onChange={(e) => setNewActionDraft({ ...newActionDraft, type: e.target.value })}>
                <option value="commit">commit</option>
                <option value="push">push</option>
                <option value="docs">docs</option>
                <option value="test">test</option>
                <option value="manual">manual</option>
              </select>
              <input style={{ flex: 1, padding: 6 }} value={newActionDraft.description} onChange={(e) => setNewActionDraft({ ...newActionDraft, description: e.target.value })} placeholder="Description" />
              <button className="small" onClick={createNewAction}>Create</button>
              <button className="small" onClick={cancelNewAction}>Cancel</button>
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <strong>Selected:</strong>{' '}
            {selectedActionObj ? `${selectedActionObj.description} (${selectedActionObj.id})` : 'None'}
          </div>

          {local.proposedActions.map((a) => {
            const isSelected = local.selectedAction === a.id
            return (
              <div key={a.id} className={`action ${isSelected ? 'selected-action' : ''}`}>
                <input
                  type="radio"
                  name={`selected-${local.taskId}`}
                  checked={isSelected}
                  onChange={() => update({ selectedAction: a.id })}
                  title="Select this action"
                />
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isSelected && <span className="selected-badge">✓ Selected</span>}
                    <input
                      type="text"
                      value={a.description}
                      onChange={(e) => updateAction(a.id, { description: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <select value={a.type} onChange={(e) => updateAction(a.id, { type: e.target.value })}>
                      <option value="commit">commit</option>
                      <option value="push">push</option>
                      <option value="docs">docs</option>
                      <option value="test">test</option>
                      <option value="manual">manual</option>
                    </select>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button className="small" onClick={() => removeAction(a.id)}>Remove</button>
                    <button className="small" onClick={() => sendEditAction(a)} style={{ marginLeft: 8 }}>Send Proposal</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="panel panel-notes">
          <h4>Notes</h4>
          <textarea value={local.notes} onChange={(e) => update({ notes: e.target.value })} />
        </div>
      </div>

      <div className="buttons workspace-actions">
        <button onClick={handleSave}>Draft Changes</button>
        <button onClick={() => doDecision('approved')} disabled={!local.selectedAction}>Approve</button>
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

  // sidebar collapse state
  const [collapsedAll, setCollapsedAll] = useState(false)
  const [collapsedPending, setCollapsedPending] = useState(false)
  const [collapsedApproved, setCollapsedApproved] = useState(false)
  const [collapsedDeferred, setCollapsedDeferred] = useState(false)
  const [collapsedDenied, setCollapsedDenied] = useState(false)
  const [collapsedCompleted, setCollapsedCompleted] = useState(false)

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

  const allTasks = tasks
  const pending = tasks.filter((t) => t.status === 'pending_review')
  const approved = tasks.filter((t) => t.status === 'approved')
  const deferred = tasks.filter((t) => t.status === 'deferred')
  const denied = tasks.filter((t) => t.status === 'denied')
  const completed = tasks.filter((t) => t.status === 'completed')

  const current = tasks.find((t) => t.taskId === selected) || null

  return (
    <div className="app">
      <header>
        <h1>Task Board MVP</h1>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedAll(!collapsedAll)}>
              <h3>All Tasks ({allTasks.length})</h3>
              <div className="collapse-indicator">{collapsedAll ? '+' : '−'}</div>
            </div>
            {!collapsedAll && <div className="section-list">
              {allTasks.map((t) => (
                <div
                  className={'card' + (selected === t.taskId ? ' selected' : '')}
                  key={t.taskId}
                  onClick={() => setSelected(t.taskId)}
                >
                  <div className="card-title">{t.title}</div>
                  <div className="muted">{t.taskId} • {t.status}</div>
                </div>
              ))}
            </div>}
          </div>

          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedPending(!collapsedPending)}>
              <h3>Pending Review ({pending.length})</h3>
              <div className="collapse-indicator">{collapsedPending ? '+' : '−'}</div>
            </div>
            {!collapsedPending && <div className="section-list">
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
            </div>}
          </div>

          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedApproved(!collapsedApproved)}>
              <h3>Approved ({approved.length})</h3>
              <div className="collapse-indicator">{collapsedApproved ? '+' : '−'}</div>
            </div>
            {!collapsedApproved && <div className="section-list">
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
            </div>}
          </div>

          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedDeferred(!collapsedDeferred)}>
              <h3>Deferred ({deferred.length})</h3>
              <div className="collapse-indicator">{collapsedDeferred ? '+' : '−'}</div>
            </div>
            {!collapsedDeferred && <div className="section-list">
              {deferred.map((t) => (
                <div
                  className={'card' + (selected === t.taskId ? ' selected' : '')}
                  key={t.taskId}
                  onClick={() => setSelected(t.taskId)}
                >
                  <div className="card-title">{t.title}</div>
                  <div className="muted">{t.taskId}</div>
                </div>
              ))}
            </div>}
          </div>

          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedDenied(!collapsedDenied)}>
              <h3>Denied ({denied.length})</h3>
              <div className="collapse-indicator">{collapsedDenied ? '+' : '−'}</div>
            </div>
            {!collapsedDenied && <div className="section-list">
              {denied.map((t) => (
                <div
                  className={'card' + (selected === t.taskId ? ' selected' : '')}
                  key={t.taskId}
                  onClick={() => setSelected(t.taskId)}
                >
                  <div className="card-title">{t.title}</div>
                  <div className="muted">{t.taskId}</div>
                </div>
              ))}
            </div>}
          </div>

          <div className="sidebar-section">
            <div className="section-header" onClick={() => setCollapsedCompleted(!collapsedCompleted)}>
              <h3>Completed ({completed.length})</h3>
              <div className="collapse-indicator">{collapsedCompleted ? '+' : '−'}</div>
            </div>
            {!collapsedCompleted && <div className="section-list">
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
            </div>}
          </div>
        </aside>

        <main className="main-workspace">
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
              <div className="placeholder">Select a task to view details</div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
