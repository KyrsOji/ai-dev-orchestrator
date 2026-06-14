import React, { useEffect, useState, useRef } from 'react'
import { Task, ProposedAction } from './types'
import { WidgetApi } from 'matrix-widget-api'

declare global { interface Window { matrixWidgetApi?: any; MatrixWidgetApi?: any } }

function uuid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function safeStringify(obj: any) {
  try {
    const seen = new WeakSet()
    return JSON.stringify(obj, function (key, value) {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`
      return value
    })
  } catch (e) {
    try {
      return String(obj)
    } catch (_e) {
      return '[unstringifiable]'
    }
  }
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

function TaskDetail({
  task,
  onSave,
  sendMatrixEvent,
  widgetInfo,
  showDev,
}: {
  task: Task
  onSave: (t: Task) => Promise<any>
  sendMatrixEvent: (content: any) => Promise<{ ok: boolean; error?: string }>
  widgetInfo: { widgetId: string | null; parentUrl: string | null; roomId: string | null; connected: boolean; capabilitiesGranted: boolean }
  showDev?: boolean
}) {
  const [local, setLocal] = useState<Task>(task)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error' | null; message: string | null }>({ type: null, message: null })
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 600 : false)
  useEffect(() => setLocal(task), [task])

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth <= 600)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Mobile action / sheet states
  const [showFab, setShowFab] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)

  // form fields
  const [newType, setNewType] = useState<string>('manual')
  const [newDesc, setNewDesc] = useState<string>('')
  const [newPayloadText, setNewPayloadText] = useState<string>('')

  const [editedType, setEditedType] = useState<string>('manual')
  const [editedDesc, setEditedDesc] = useState<string>('')
  const [editedPayloadText, setEditedPayloadText] = useState<string>('')

  const [pasteText, setPasteText] = useState<string>('')

  // candidates to be sent on Approve
  const [newActionCandidate, setNewActionCandidate] = useState<ProposedAction | null>(null)
  const [editedActionCandidateState, setEditedActionCandidateState] = useState<ProposedAction | null>(null)

  useEffect(() => {
    // when selection changes, prefill edit fields
    const sel = local.proposedActions.find((a) => a.id === local.selectedAction) || null
    if (sel) {
      setEditedType(sel.type)
      setEditedDesc(sel.description)
      try {
        setEditedPayloadText(JSON.stringify(sel.payload || {}, null, 2))
      } catch (e) {
        setEditedPayloadText(String(sel.payload || ''))
      }
    }
  }, [local.selectedAction, local.proposedActions])

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
    const updated = { ...local, proposedActions: [...local.proposedActions, newAct], selectedAction: newAct.id }
    setLocal(updated)
    setNewActionCandidate(newAct)
    // persist locally only; do not send Matrix events until Approve
    onSave(updated).catch(() => {})
  }

  function updateAction(id: string, change: Partial<ProposedAction>) {
    const actions = local.proposedActions.map((a) => (a.id === id ? { ...a, ...change } : a))
    update({ proposedActions: actions })
  }

  function removeAction(id: string) {
    update({ proposedActions: local.proposedActions.filter((a) => a.id !== id) })
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

    // Attempt Matrix send only when connected AND capabilities are granted.
    if (widgetInfo.connected && widgetInfo.capabilitiesGranted) {
      setToast({ type: 'warning', message: 'Sending to Matrix...' })
      const res = await sendMatrixEvent(content)
      if (res && res.ok) {
        setToast({ type: 'success', message: 'Action sent to Matrix' })
        setTimeout(() => setToast({ type: null, message: null }), 3000)
        return true
      } else {
        // Friendly error message in normal UI; detailed diagnostics are captured elsewhere
        setToast({ type: 'error', message: 'Unable to submit approval. Open Developer Info for details.' })
        setTimeout(() => setToast({ type: null, message: null }), 6000)
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
    await sendActionEvent(decision, { editedAction: editedActionCandidateState, newAction: newActionCandidate })
  }

  async function sendEditAction(a: ProposedAction) {
    // Persist edits locally; do not send Matrix events until Approve
    const actions = local.proposedActions.map((act) => (act.id === a.id ? a : act))
    const updated = { ...local, proposedActions: actions, selectedAction: a.id }
    setLocal(updated)
    setEditedActionCandidateState(a)
    await onSave(updated)
  }

  const selectedActionObj = local.proposedActions.find((a) => a.id === local.selectedAction) || null

  // Copy for 2nd Opinion (structured prompt)
  async function copyFor2ndOpinion() {
    const promptParts = [
      `taskId: ${local.taskId}`,
      `title: ${local.title}`,
      `reviewer_summary: ${local.reviewerSummary}`,
      `openhands_output: ${local.openhandsResponse}`,
      `selected_action: ${selectedActionObj ? safeStringify(selectedActionObj) : 'none'}`,
      `proposed_actions: ${safeStringify(local.proposedActions)}`,
      `\nPlease propose the best next action as JSON with: type, description, payload`,
    ]
    const prompt = promptParts.join('\n\n')
    try {
      if (navigator && (navigator as any).clipboard && typeof (navigator as any).clipboard.writeText === 'function') {
        await (navigator as any).clipboard.writeText(prompt)
        setToast({ type: 'success', message: 'Copied for 2nd Opinion' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      } else {
        // fallback to modal showing text to copy
        setPasteText(prompt)
        setShowCopyModal(true)
        setToast({ type: 'success', message: 'Copied for 2nd Opinion' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      }
    } catch (e) {
      setPasteText(prompt)
      setShowCopyModal(true)
    }
  }

  // Copy reviewer summary only
  async function copySummary() {
    const text = local.reviewerSummary || ''
    try {
      if (navigator && (navigator as any).clipboard && typeof (navigator as any).clipboard.writeText === 'function') {
        await (navigator as any).clipboard.writeText(text)
        setToast({ type: 'success', message: 'Reviewer summary copied' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      } else {
        setPasteText(text)
        setShowCopyModal(true)
        setToast({ type: 'success', message: 'Reviewer summary copied' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      }
    } catch (e) {
      setPasteText(text)
      setShowCopyModal(true)
    }
  }

  // Copy OpenHands output only
  async function copyOutput() {
    const text = local.openhandsResponse || ''
    try {
      if (navigator && (navigator as any).clipboard && typeof (navigator as any).clipboard.writeText === 'function') {
        await (navigator as any).clipboard.writeText(text)
        setToast({ type: 'success', message: 'OpenHands output copied' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      } else {
        setPasteText(text)
        setShowCopyModal(true)
        setToast({ type: 'success', message: 'OpenHands output copied' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
      }
    } catch (e) {
      setPasteText(text)
      setShowCopyModal(true)
    }
  }

  // Create new action from form
  function handleCreateSave() {
    let payload: any = {}
    try {
      payload = newPayloadText ? JSON.parse(newPayloadText) : {}
    } catch (e) {
      // if invalid JSON, treat as empty object
      payload = {}
    }
    const act: ProposedAction = { id: uuid('act-'), type: newType || 'manual', description: newDesc || 'New action', payload }
    const updated = { ...local, proposedActions: [...local.proposedActions, act], selectedAction: act.id }
    setLocal(updated)
    setNewActionCandidate(act)
    setShowCreate(false)
    setShowFab(false)
    onSave(updated).catch(() => {})
    setToast({ type: 'success', message: 'New action created (select Approve to send)' })
    setTimeout(() => setToast({ type: null, message: null }), 3000)
  }

  // Save edited action from sheet
  function handleEditSave() {
    if (!selectedActionObj) return
    let payload: any = {}
    try {
      payload = editedPayloadText ? JSON.parse(editedPayloadText) : {}
    } catch (e) {
      payload = {}
    }
    const updatedAct: ProposedAction = { id: selectedActionObj.id, type: editedType || 'manual', description: editedDesc || selectedActionObj.description, payload }
    const actions = local.proposedActions.map((a) => (a.id === selectedActionObj.id ? updatedAct : a))
    const updated = { ...local, proposedActions: actions, selectedAction: updatedAct.id }
    setLocal(updated)
    setEditedActionCandidateState(updatedAct)
    setShowEdit(false)
    setShowFab(false)
    onSave(updated).catch(() => {})
    setToast({ type: 'success', message: 'Edited action saved (select Approve to send)' })
    setTimeout(() => setToast({ type: null, message: null }), 3000)
  }

  // Paste 2nd Opinion result save
  function handlePasteSave() {
    const txt = pasteText.trim()
    if (!txt) return
    let act: ProposedAction | null = null
    try {
      const parsed = JSON.parse(txt)
      if (parsed && (parsed.type || parsed.description)) {
        act = { id: uuid('act-'), type: parsed.type || 'manual', description: parsed.description || '', payload: parsed.payload || {} }
      }
    } catch (e) {
      // not JSON, treat as plain text
      act = { id: uuid('act-'), type: 'manual', description: txt, payload: {} }
    }
    if (act) {
      const updated = { ...local, proposedActions: [...local.proposedActions, act], selectedAction: act.id }
      setLocal(updated)
      setNewActionCandidate(act)
      setShowPaste(false)
      setShowFab(false)
      onSave(updated).catch(() => {})
      setToast({ type: 'success', message: 'Pasted action created (select Approve to send)' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
    }
  }

  return (
    <div className="task-detail">
      <h2>{local.title}</h2>
      <div className="muted">{local.taskId}</div>

      {/* connection/info */}
      <div style={{ marginBottom: 8 }}>
        <strong>Connection:</strong> {widgetInfo.connected ? 'Matrix Connected' : 'Local Mode'}
      </div>

      {/* brief developer info shown only when requested */}
      {showDev ? (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          <div>Widget ID: {widgetInfo.widgetId || '(none)'}</div>
          <div>Parent URL: {widgetInfo.parentUrl || '(none)'}</div>
          <div>Room ID: {widgetInfo.roomId || '(none)'}</div>
          <div>Capabilities Granted: {widgetInfo.capabilitiesGranted ? 'yes' : 'no'}</div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          <div>Capabilities: {widgetInfo.capabilitiesGranted ? 'yes' : 'no'}</div>
        </div>
      )}

      {/* toast */}
      {toast.message ? (
        <div className={`toast ${toast.type ? `toast-${toast.type}` : ''}`}>{toast.message}</div>
      ) : null}

      <div className="panel">
        <h4>OpenHands output</h4>
        <pre>{local.openhandsResponse}</pre>
        <div style={{ marginTop: 8 }}>
          <button className="small" onClick={copyOutput} style={{ marginRight: 8 }}>Copy Output</button>
          <button className="small" onClick={copyFor2ndOpinion}>Copy for 2nd Opinion</button>
        </div>
      </div>

      <div className="panel">
        <h4>Reviewer summary</h4>
        <pre>{local.reviewerSummary}</pre>
        <div style={{ marginTop: 8 }}>
          <button className="small" onClick={copySummary}>Copy Summary</button>
        </div>
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
        {local.proposedActions.map((a) =>
          isMobile ? (
            <label
              key={a.id}
              className={`action action-mobile${local.selectedAction === a.id ? ' selected-action' : ''}`}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <input
                type="radio"
                name={`selected-${local.taskId}`}
                checked={local.selectedAction === a.id}
                onChange={() => update({ selectedAction: a.id })}
              />
              <div style={{ marginLeft: 8 }}>
                <div style={{ fontWeight: 600 }}>{a.description}</div>
                <div className="muted" style={{ fontSize: 12 }}>{a.type}</div>
              </div>
            </label>
          ) : (
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
          )
        )}
      </div>

      <div className="panel">
        <h4>Notes</h4>
        <textarea value={local.notes} onChange={(e) => update({ notes: e.target.value })} />
      </div>

      {/* Mobile FAB + Bottom Sheet */}
      {isMobile ? (
        <>
          <button className="fab" onClick={() => setShowFab(true)}>+ Action</button>

          {showFab ? (
            <div className="bottom-sheet-overlay" onClick={() => setShowFab(false)}>
              <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
                <h4>Action Tools</h4>
                <div className="sheet-option" onClick={() => { setShowCreate(true); setShowFab(false) }}>Create New Action</div>
                <div className={`sheet-option ${!selectedActionObj ? 'disabled' : ''}`} onClick={() => {
                  if (selectedActionObj) {
                    setEditedType(selectedActionObj.type)
                    setEditedDesc(selectedActionObj.description)
                    try { setEditedPayloadText(JSON.stringify(selectedActionObj.payload || {}, null, 2)) } catch (e) { setEditedPayloadText(String(selectedActionObj.payload || '')) }
                    setShowEdit(true)
                    setShowFab(false)
                  }
                }}>
                  Edit Selected Action
                </div>
                <div className="sheet-option" onClick={() => { setShowPaste(true); setShowFab(false) }}>Paste 2nd Opinion</div>
                <div className="sheet-option" onClick={() => setShowFab(false)}>Cancel</div>
              </div>
            </div>
          ) : null}

          {/* Create Sheet */}
          {showCreate ? (
            <div className="modal-overlay" onClick={() => setShowCreate(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Create New Action</h3>
                <div className="form-row">
                  <label>Type</label>
                  <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                    <option value="manual">manual</option>
                    <option value="test">test</option>
                    <option value="docs">docs</option>
                    <option value="push">push</option>
                    <option value="commit">commit</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Description</label>
                  <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Payload (JSON, optional)</label>
                  <textarea value={newPayloadText} onChange={(e) => setNewPayloadText(e.target.value)} placeholder='{"key": "value"}' />
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowCreate(false)}>Cancel</button>
                  <button onClick={handleCreateSave}>Save</button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Edit Sheet */}
          {showEdit ? (
            <div className="modal-overlay" onClick={() => setShowEdit(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Edit Selected Action</h3>
                <div className="form-row">
                  <label>Type</label>
                  <select value={editedType} onChange={(e) => setEditedType(e.target.value)}>
                    <option value="manual">manual</option>
                    <option value="test">test</option>
                    <option value="docs">docs</option>
                    <option value="push">push</option>
                    <option value="commit">commit</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Description</label>
                  <textarea value={editedDesc} onChange={(e) => setEditedDesc(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Payload (JSON)</label>
                  <textarea value={editedPayloadText} onChange={(e) => setEditedPayloadText(e.target.value)} />
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowEdit(false)}>Cancel</button>
                  <button onClick={handleEditSave}>Save</button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Paste Sheet */}
          {showPaste ? (
            <div className="modal-overlay" onClick={() => setShowPaste(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Paste 2nd Opinion</h3>
                <div className="form-row">
                  <label>Paste JSON or plain text</label>
                  <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder='{"type":"manual","description":"...","payload":{}}' />
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowPaste(false)}>Cancel</button>
                  <button onClick={handlePasteSave}>Save</button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Copy fallback modal */}
          {showCopyModal ? (
            <div className="modal-overlay" onClick={() => setShowCopyModal(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Copy text</h3>
                <textarea value={pasteText} readOnly />
                <div className="form-actions">
                  <button onClick={() => setShowCopyModal(false)}>Close</button>
                </div>
              </div>
            </div>
          ) : null}

        </>
      ) : null}

      {!isMobile ? (
        <div className="buttons">
          <button onClick={handleSave}>Save</button>
          <button onClick={() => doDecision('approved')} disabled={!local.selectedAction}>
            Approve Selected Action
          </button>
          <button onClick={() => doDecision('denied')}>Deny</button>
          <button onClick={() => doDecision('deferred')}>Defer</button>
        </div>
      ) : (
        <div className="mobile-action-bar">
          <button onClick={handleSave}>Save</button>
          <button onClick={() => doDecision('approved')} disabled={!local.selectedAction}>Approve</button>
          <button onClick={() => doDecision('denied')}>Deny</button>
          <button onClick={() => doDecision('deferred')}>Defer</button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const widgetRef = useRef<any>(null)
  const [widgetInfo, setWidgetInfo] = useState<{ widgetId: string | null; parentUrl: string | null; roomId: string | null; connected: boolean; capabilitiesGranted: boolean }>({
    widgetId: null,
    parentUrl: null,
    roomId: null,
    connected: false,
    capabilitiesGranted: false,
  })
  const [devOpen, setDevOpen] = useState(false)

  // diagnostics pushed by sendMatrixEvent attempts
  const [diags, setDiags] = useState<string[]>([])
  function pushDiag(msg: string) {
    const m = `${new Date().toISOString()} ${String(msg)}`
    try {
      setDiags((prev) => {
        const next = prev.concat(m)
        if (next.length > 40) return next.slice(next.length - 40)
        return next
      })
    } catch (e) {
      // ignore
    }
    try {
      console.debug('[taskboard diag]', m)
    } catch (e) {}
  }

  async function initWidgetApi() {
    try {
      // Parse both search and fragment parameters (Element commonly uses fragment)
      const searchParams = new URLSearchParams(window.location.search || '')
      let hash = window.location.hash || ''
      if (hash.startsWith('#')) hash = hash.slice(1)
      if (hash.startsWith('/')) hash = hash.slice(1)
      const hashParams = new URLSearchParams(hash)

      const pick = (names: string[]) => {
        for (const n of names) {
          const v = searchParams.get(n) || hashParams.get(n)
          if (v) return v
        }
        return null
      }

      let widgetId = pick(['widgetId', 'widget_id', 'widgetid', 'matrix_widget_id'])
      let parentUrl = pick(['parentUrl', 'parent_url', 'parenturl'])
      let roomId = pick(['roomId', 'room_id', 'roomid'])

      const isPlaceholder = (v: string | null) => typeof v === 'string' && (v.startsWith('$') || /\$\{.+\}/.test(v))

      if (isPlaceholder(widgetId)) widgetId = null
      if (isPlaceholder(parentUrl)) parentUrl = null
      if (isPlaceholder(roomId)) roomId = null

      const parentOrigin = parentUrl || document.referrer || window.location.origin

      let apiInstance: any = null
      const win: any = window as any

      // Prefer client-injected API (older clients)
      if (win.matrixWidgetApi) {
        apiInstance = win.matrixWidgetApi
        // don't trust URL placeholders; update real values after negotiation
        setWidgetInfo({ widgetId: null, parentUrl, roomId: null, connected: true, capabilitiesGranted: false })

        // try to request capability via injected API if available
        try {
          if (typeof apiInstance.requestCapabilityToSendEvent === 'function') {
            apiInstance.requestCapabilityToSendEvent('ai.dev.taskboard.action')
          } else if (typeof apiInstance.requestSendEvent === 'function') {
            try { await apiInstance.requestSendEvent('ai.dev.taskboard.action') } catch (e) {/* ignore */}
          }
        } catch (e) {
          // ignore
        }

        try {
          if (typeof apiInstance.start === 'function') await apiInstance.start()
        } catch (e) {
          // ignore
        }

        try {
          if (typeof apiInstance.sendContentLoaded === 'function') apiInstance.sendContentLoaded()
        } catch (e) {}
      } else {
        // try global MatrixWidgetApi constructor (some clients expose this)
        if (win.MatrixWidgetApi) {
          try {
            const AnyApi: any = (win.MatrixWidgetApi as any).default || win.MatrixWidgetApi
            apiInstance = new AnyApi(null, parentOrigin)
          } catch (e) {
            console.warn('Failed to construct injected MatrixWidgetApi', e)
          }
        }

        // Use bundled library (matrix-widget-api) if not obtained above
        if (!apiInstance) {
          try {
            apiInstance = new WidgetApi(widgetId, parentOrigin)
          } catch (e) {
            // try fallback if default export
            try {
              const AnyApi: any = (WidgetApi as any).default || WidgetApi
              apiInstance = new AnyApi(widgetId, parentOrigin)
            } catch (e2) {
              console.warn('Failed to construct WidgetApi', e2)
            }
          }
        }

        if (apiInstance) {
          // Request capability to send our custom event (include in negotiation)
          try {
            if (typeof apiInstance.requestCapabilityToSendEvent === 'function') {
              apiInstance.requestCapabilityToSendEvent('ai.dev.taskboard.action')
            } else if (typeof apiInstance.requestSendEvent === 'function') {
              try { await apiInstance.requestSendEvent('ai.dev.taskboard.action') } catch (e) {/* ignore */}
            }
          } catch (e) {
            console.warn('requesting capability failed', e)
          }

          // attach ready listener before starting
          let readyResolved = false
          const readyPromise = new Promise<void>((resolve) => {
            const onReady = () => {
              if (!readyResolved) {
                readyResolved = true
                resolve()
              }
            }
            if (typeof apiInstance.on === 'function') apiInstance.on('ready', onReady)
            // fallback timeout if client does not notify
            setTimeout(() => {
              if (!readyResolved) {
                readyResolved = true
                resolve()
              }
            }, 1500)
          })

          // Start the API (some implementations require start())
          try {
            if (typeof apiInstance.start === 'function') await apiInstance.start()
          } catch (e) {
            console.warn('widget api start failed', e)
          }

          try {
            if (typeof apiInstance.sendContentLoaded === 'function') apiInstance.sendContentLoaded()
          } catch (e) {}

          // wait for ready (or timeout)
          try { await readyPromise } catch (e) {}
        }
      }

      // register listeners to pick up runtime values (widget id, room, capabilities)
      if (apiInstance && typeof apiInstance.on === 'function') {
        try {
          apiInstance.on('action:widget_config', (ev: any) => {
            try {
              const data = ev && ev.detail && ev.detail.data ? ev.detail.data : ev && ev.data ? ev.data : null
              const maybeRoom = data && (data.room_id || data.roomId || data.room)
              if (maybeRoom && !isPlaceholder(maybeRoom)) {
                setWidgetInfo((prev) => ({ ...prev, roomId: maybeRoom }))
              }
            } catch (e) {}
          })
        } catch (e) {}

        // determine actual widget id and capability state
        let actualWidgetId: string | null = null
        try {
          if (apiInstance.transport && apiInstance.transport.widgetId) actualWidgetId = apiInstance.transport.widgetId
          else if (apiInstance.widgetId) actualWidgetId = apiInstance.widgetId
          else if (widgetId) actualWidgetId = widgetId
        } catch (e) {}

        let capGranted = false
        try {
          if (typeof apiInstance.hasCapability === 'function') {
            capGranted = apiInstance.hasCapability('org.matrix.msc2762.send.event:ai.dev.taskboard.action')
          }
        } catch (e) {}

        setWidgetInfo({ widgetId: actualWidgetId, parentUrl, roomId, connected: true, capabilitiesGranted: capGranted })
      }

      widgetRef.current = apiInstance
    } catch (e) {
      console.error('initWidgetApi failed', e)
    }
  }

  useEffect(() => {
    initWidgetApi()
    load()
    // cleanup on unmount
    return () => {
      const api = widgetRef.current
      if (api && typeof api.stop === 'function') {
        try { api.stop() } catch (e) {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendMatrixEvent(content: any): Promise<{ ok: boolean; error?: string }> {
    const pushDiagLocal = (m: string) => {
      try {
        pushDiag(m)
      } catch (e) {}
      try {
        console.debug('[taskboard diag]', m)
      } catch (e) {}
    }

    try {
      const win: any = window as any
      const errors: string[] = []

      // legacy injected API
      if (win.matrixWidgetApi) {
        const mw = win.matrixWidgetApi
        if (typeof mw.requestSendEvent === 'function') {
          pushDiagLocal('matrixWidgetApi.requestSendEvent')
          try {
            await mw.requestSendEvent('ai.dev.taskboard.action', content)
            pushDiagLocal('matrixWidgetApi.requestSendEvent ok')
            return { ok: true }
          } catch (e) {
            const err = 'matrixWidgetApi.requestSendEvent error: ' + safeStringify(e)
            pushDiagLocal(err)
            errors.push(err)
          }
        }
        if (typeof mw.sendEvent === 'function') {
          pushDiagLocal('matrixWidgetApi.sendEvent')
          try {
            await mw.sendEvent('ai.dev.taskboard.action', content)
            pushDiagLocal('matrixWidgetApi.sendEvent ok')
            return { ok: true }
          } catch (e) {
            const err = 'matrixWidgetApi.sendEvent error: ' + safeStringify(e)
            pushDiagLocal(err)
            errors.push(err)
          }
        }
      }

      // use our constructed API
      const api = widgetRef.current
      if (api) {
        if (api.transport && typeof api.transport.send === 'function') {
          pushDiagLocal('api.transport.send("send_event", { type, content })')
          try {
            // Preferred format: send_event with an event object
            await api.transport.send('send_event', { type: 'ai.dev.taskboard.action', content })
            pushDiagLocal('api.transport.send send_event ok')
            return { ok: true }
          } catch (e) {
            const err = 'api.transport.send send_event error: ' + safeStringify(e)
            pushDiagLocal(err)
            errors.push(err)
            // try legacy signature
            pushDiagLocal('api.transport.send(eventType, content) legacy fallback')
            try {
              await api.transport.send('ai.dev.taskboard.action', content)
              pushDiagLocal('api.transport.send legacy ok')
              return { ok: true }
            } catch (e2) {
              const err2 = 'api.transport.send legacy error: ' + safeStringify(e2)
              pushDiagLocal(err2)
              errors.push(err2)
            }
          }
        }

        if (typeof api.requestSendEvent === 'function') {
          pushDiagLocal('api.requestSendEvent')
          try {
            await api.requestSendEvent('ai.dev.taskboard.action', content)
            pushDiagLocal('api.requestSendEvent ok')
            return { ok: true }
          } catch (e) {
            const err = 'api.requestSendEvent error: ' + safeStringify(e)
            pushDiagLocal(err)
            errors.push(err)
          }
        }

        if (typeof api.sendEvent === 'function') {
          pushDiagLocal('api.sendEvent')
          try {
            await api.sendEvent('ai.dev.taskboard.action', content)
            pushDiagLocal('api.sendEvent ok')
            return { ok: true }
          } catch (e) {
            const err = 'api.sendEvent error: ' + safeStringify(e)
            pushDiagLocal(err)
            errors.push(err)
          }
        }
      }

      // last-resort: postMessage to parent (some wrappers may proxy)
      try {
        pushDiagLocal('window.parent.postMessage')
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'ai.dev.taskboard.action', content }, '*')
          pushDiagLocal('window.parent.postMessage ok')
          return { ok: true }
        } else {
          const err = 'no parent to postMessage to'
          pushDiagLocal(err)
          errors.push(err)
        }
      } catch (e) {
        const err = 'postMessage error: ' + safeStringify(e)
        pushDiagLocal(err)
        errors.push(err)
      }

      return { ok: false, error: errors.join(' | ') || 'unknown error' }
    } catch (e) {
      const err = 'sendMatrixEvent fatal: ' + safeStringify(e)
      try { pushDiag(err) } catch (e) {}
      console.error(err)
      return { ok: false, error: err }
    }
  }

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
      <header className="app-header">
        <div className="header-left">
          <h1>Taskboard</h1>
        </div>
        <div className="header-right">
          <span className={`connection-status ${widgetInfo.connected ? 'online' : 'offline'}`}>
            {widgetInfo.connected ? 'Connected' : 'Local'}{widgetInfo.capabilitiesGranted ? ' · Capabilities granted' : ''}
          </span>
          <div className="task-summary" style={{ display: 'inline-block', marginLeft: 12 }}>
            <span className="summary-item">Pending: {pending.length}</span>{' '}
            <span className="summary-item">Approved: {approved.length}</span>{' '}
            <span className="summary-item">Completed: {completed.length}</span>
          </div>
          <button className="small" onClick={() => setDevOpen((v) => !v)} style={{ marginLeft: 12 }}>
            {devOpen ? 'Hide Developer Info' : 'Developer Info'}
          </button>
        </div>
      </header>
      {devOpen ? (
        <div className="developer-info panel" style={{ marginBottom: 12 }}>
          <h4>Developer Info</h4>
          <div><strong>Widget Info</strong></div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{safeStringify(widgetInfo)}</pre>
          <div><strong>Diagnostics (recent)</strong></div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{diags.slice(-40).join('\n')}</pre>
        </div>
      ) : null}
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
                <div className="card-sub">
                  <span className="card-status">{t.status}</span>
                  <span className="card-reviewer">{(t.reviewerSummary || '').split('\n')[0]}</span>
                  <span className="card-action">{(t.proposedActions.find(a => a.id === t.selectedAction)?.description) || (t.proposedActions[0]?.description) || ''}</span>
                </div>
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
                <div className="card-sub">
                  <span className="card-status">{t.status}</span>
                  <span className="card-reviewer">{(t.reviewerSummary || '').split('\n')[0]}</span>
                  <span className="card-action">{(t.proposedActions.find(a => a.id === t.selectedAction)?.description) || (t.proposedActions[0]?.description) || ''}</span>
                </div>
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
                <div className="card-sub">
                  <span className="card-status">{t.status}</span>
                  <span className="card-reviewer">{(t.reviewerSummary || '').split('\n')[0]}</span>
                  <span className="card-action">{(t.proposedActions.find(a => a.id === t.selectedAction)?.description) || (t.proposedActions[0]?.description) || ''}</span>
                </div>
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
              sendMatrixEvent={sendMatrixEvent}
              widgetInfo={widgetInfo}
              showDev={devOpen}
            />
          ) : (
            <div>Select a task to view details</div>
          )}
        </div>
      </div>
    </div>
  )
}
