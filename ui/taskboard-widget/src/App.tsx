import React, { useEffect, useState, useRef } from 'react'
import { Task, ProposedAction, Agent } from './types'
import { WidgetApi } from 'matrix-widget-api'

declare global { interface Window { matrixWidgetApi?: any; MatrixWidgetApi?: any } }

function uuid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}


function generateTaskId(preferPwa = true) {
  const now = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  if (preferPwa) {
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `PWA-${y}${m}${d}-${hh}${mm}${ss}`;
  }
  return `TASK-${now.getTime()}`;
}

function generateFollowUpId() {
  const now = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `PWA-FOLLOWUP-${y}${m}${d}-${hh}${mm}${ss}`;
}

// Static agent options (used when live registry is not available)
const STATIC_AGENTS: Agent[] = [
  {
    agentId: 'ofbiz-dev-01',
    id: 'ofbiz-dev-01',
    hostname: 'ubuntu-16gb-sin-1',
    roles: ['ofbiz'],
    status: 'idle',
    cpuCount: 8,
    memoryGb: 15.2425,
    diskFreeGb: 272.77,
    loadAverage: 3.36,
    lastSeen: new Date().toISOString(),
    freshnessSeconds: 0,
    isFresh: true,
  },
  {
    agentId: 'future-agent-placeholder',
    id: 'future-agent-placeholder',
    hostname: 'another-server',
    roles: ['general'],
    status: 'idle',
    cpuCount: 2,
    memoryGb: 4,
    diskFreeGb: 50,
    loadAverage: 0.1,
    lastSeen: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    freshnessSeconds: Math.floor((Date.now() - (Date.now() - 1000 * 60 * 60)) / 1000),
    isFresh: false,
  },
]

let AGENTS = STATIC_AGENTS

function timeAgo(iso?: string | number | Date) {
  if (!iso) return 'unknown'
  const then = new Date(iso).getTime()
  const sec = Math.floor((Date.now() - then) / 1000)
  if (sec < 60) return `${sec} sec ago`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  return new Date(then).toLocaleString()
}

function formatAgentDisplay(a: any) {
  if (!a) return '(none)'
  const id = a.id || a.agentId || '(unknown)'
  const host = a.hostname || a.host || ''
  const status = a.status || 'unknown'
  const isFresh = (typeof a.isFresh === 'boolean') ? a.isFresh : (typeof a.freshnessSeconds === 'number' ? (a.freshnessSeconds <= 300) : true)
  const freshLabel = isFresh ? 'fresh' : 'stale'
  return `${id} · ${host} · ${status} · ${freshLabel}`
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

const TaskCard = ({ t, onClick }: { t: any; onClick?: () => void }) => {
  const agentId = t?.routing?.selectedAgentId || AGENTS[0].id
  const hostname = t?.routing?.selectedHostname || AGENTS[0].hostname
  const role = t?.routing?.selectedRole || (t?.routing?.role) || (AGENTS.find(a => a.id === agentId)?.roles?.[0]) || 'general'
  const last = (t && Array.isArray(t.messages) && t.messages.length) ? t.messages[t.messages.length - 1].createdAt : t && t.updatedAt
  const summary = t.openhandsResponse ? (String(t.openhandsResponse).split('\n')[0]) : 'Result: (pending)'

  const agentObj = AGENTS.find(a => (a.id === agentId) || (a.agentId === agentId)) || null
  const isStale = agentObj ? !agentObj.isFresh : true

  return (
    <div className={'card'} onClick={onClick} style={{ padding: 10 }}>
      <div className="card-title">{t.title || t.taskId}</div>
      <div className="card-sub" style={{ marginTop: 6 }}>
        <span className="card-status">{t.status}</span>
        <span style={{ marginLeft: 8 }}>{agentId} · {hostname}</span>
        {agentObj && isStale ? (<span style={{ marginLeft: 8, color: '#b45309', fontSize: 12 }}>⚠️ stale</span>) : null}
        <span style={{ marginLeft: 8 }}>{role}</span>
        <span style={{ marginLeft: 8 }}>{timeAgo(last)}</span>
        {t && t.parentTaskId ? (<span style={{ marginLeft: 8, fontSize: 12, color: '#374151' }}>Parent: {t.parentTaskId}</span>) : null}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>{summary}</div>
    </div>
  )
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
  standaloneMode,
  standaloneToken,
  chatMode,
  openTask,
}: {
  task: Task
  openTask?: (taskId: string) => void
  onSave: (t: Task) => Promise<any>
  sendMatrixEvent: (content: any) => Promise<{ ok: boolean; error?: string }>
  widgetInfo: { widgetId: string | null; parentUrl: string | null; roomId: string | null; connected: boolean; capabilitiesGranted: boolean }
  showDev?: boolean
  // frontend standalone props
  standaloneMode?: boolean
  standaloneToken?: string | null
  chatMode?: boolean
}) {
  const [local, setLocal] = useState<Task>(task)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error' | null; message: string | null }>({ type: null, message: null })
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 600 : false)
  useEffect(() => setLocal(task), [task])

  // Chat/thread state for chat-mode
  const [messages, setMessages] = useState<any[]>(() => {
    try {
      if (task && Array.isArray((task as any).messages) && (task as any).messages.length) return (task as any).messages
    } catch (e) {}
    const init: any[] = []
    init.push({ id: uuid('msg-'), author: 'system', text: 'Task created', createdAt: new Date().toISOString() })
    if (task && (task as any).notes) init.push({ id: uuid('msg-'), author: 'user', text: (task as any).notes, createdAt: new Date().toISOString() })
    if (task && task.reviewerSummary) init.push({ id: uuid('msg-'), author: 'reviewer', text: task.reviewerSummary, createdAt: new Date().toISOString() })
    if (task && task.openhandsResponse) init.push({ id: uuid('msg-'), author: 'openhands', text: task.openhandsResponse, createdAt: new Date().toISOString() })
    return init
  })

  useEffect(() => {
    // sync when underlying task messages change
    try {
      if (local && Array.isArray((local as any).messages) && (local as any).messages.length) setMessages((local as any).messages)
    } catch (e) {}
  }, [local.messages])

  const [composerText, setComposerText] = useState<string>('')
  const messagesRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    try {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    } catch (e) {}
  }, [messages])

  async function handleGetSecondOpinion() {
    // Open the modal to request or paste a 2nd opinion
    // Default title empty (user should type a title). Avoid prefilled prefixes.
    setOpinionTitle('')
    setOpinionBody('')
    setShowSecondOpinionModal(true)
  }

  async function handleOpenFollowUpModal() {
    // Prepare default values for follow-up modal
    const defaultId = generateFollowUpId()
    setFollowUpTaskId(defaultId)
    setFollowUpTitle('')
    setFollowUpDesc('')
    const defaultAgent = (local && local.routing && local.routing.selectedAgentId) ? local.routing.selectedAgentId : (AGENTS[0] && AGENTS[0].id)
    setFollowUpAgent(defaultAgent)
    const agentObj = AGENTS.find(a => a.id === defaultAgent) || AGENTS[0]
    setFollowUpRole((local && local.routing && local.routing.selectedRole) || agentObj.roles[0] || '')
    setShowFollowUpModal(true)
  }

  async function handleSaveFollowUpDraft() {
    const title = (followUpTitle || '').trim()
    const desc = (followUpDesc || '').trim()
    if (!title || !desc) {
      setToast({ type: 'warning', message: 'Enter title and description for follow-up' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }

    let newId = (followUpTaskId || '').trim()
    if (!newId) newId = generateFollowUpId()

    const agentObj = AGENTS.find(a => a.id === followUpAgent) || AGENTS[0]
    const routing = { selectedAgentId: followUpAgent || agentObj.id, selectedHostname: agentObj.hostname, selectedRole: followUpRole || agentObj.roles[0] }
    const act: ProposedAction = { id: uuid('act-'), type: 'manual', description: desc, payload: { parentTaskId: local.taskId, routing } }

    const newTask: any = {
      taskId: newId,
      title,
      status: 'pending_review',
      openhandsResponse: '',
      reviewerSummary: '',
      proposedActions: [act],
      selectedAction: act.id,
      notes: desc,
      routing,
      parentTaskId: local.taskId,
      followUpIds: [],
      updatedAt: new Date().toISOString(),
      messages: [{ id: uuid('msg-'), author: 'system', text: 'Follow-up task created', createdAt: new Date().toISOString() }]
    }

    try {
      await onSave(newTask)
      setShowFollowUpModal(false)
      setToast({ type: 'success', message: `Follow-up saved: ${newId}` })
      setTimeout(() => setToast({ type: null, message: null }), 2000)

      const systemMsg = { id: uuid('msg-'), author: 'system', text: `Follow-up task created: ${newId}`, createdAt: new Date().toISOString(), data: { followUpTask: newTask } }
      const updatedLocal = { ...local, messages: [...(local.messages || []), systemMsg], followUpIds: [...(local.followUpIds || []), newId] }
      setLocal(updatedLocal)
      try { await onSave(updatedLocal) } catch (e) {}
    } catch (e) {
      setToast({ type: 'error', message: 'Failed to save follow-up draft' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
    }
  }

  async function handleSubmitFollowUp() {
    // Save draft first (will persist task and update parent)
    await handleSaveFollowUpDraft()
    // Determine child ID
    const childId = (local.followUpIds && local.followUpIds.length) ? local.followUpIds[local.followUpIds.length - 1] : (followUpTaskId || '').trim()
    if (!childId) {
      setToast({ type: 'error', message: 'No follow-up task found to submit' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }

    // Fetch saved task to get its selectedAction
    let childTask: any = null
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/tasks`)
      if (res.ok) {
        const list = await res.json()
        if (Array.isArray(list)) childTask = list.find((t) => t.taskId === childId)
      }
    } catch (e) {}

    if (!childTask) {
      setToast({ type: 'error', message: 'Could not find saved follow-up task' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }

    const selectedAction = (Array.isArray(childTask.proposedActions) ? childTask.proposedActions.find((a: any) => a.id === childTask.selectedAction) : null) || (childTask.proposedActions && childTask.proposedActions[0]) || null
    if (!selectedAction) {
      setToast({ type: 'error', message: 'Follow-up has no selected action to submit' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }

    selectedAction.payload = selectedAction.payload || {}
    selectedAction.payload.parentTaskId = childTask.parentTaskId || local.taskId
    selectedAction.payload.routing = selectedAction.payload.routing || childTask.routing || local.routing || {}

    const payload = {
      taskId: childId,
      decision: 'approved',
      source: 'taskboard-standalone',
      selectedAction,
      createdAt: new Date().toISOString(),
    }

    const token = standaloneToken || (typeof window !== 'undefined' ? window.localStorage.getItem('taskboard_standalone_token') : null)
    if (!token) {
      setToast({ type: 'error', message: 'Standalone API token required to submit follow-up' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
      return
    }

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/task/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const txt = await res.text()
        setToast({ type: 'error', message: `Submit failed: ${res.status}` })
        console.error('Submit follow-up failed', res.status, txt)
        setTimeout(() => setToast({ type: null, message: null }), 3000)
        return
      }
      const j = await res.json()
      setToast({ type: 'success', message: 'Follow-up submitted to reviewer' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
      const systemMsg = { id: uuid('msg-'), author: 'system', text: `Follow-up task created: ${childId}`, createdAt: new Date().toISOString(), data: { followUpTaskId: childId } }
      const updatedLocal = { ...local, messages: [...(local.messages || []), systemMsg], followUpIds: [...(local.followUpIds || []), childId] }
      setLocal(updatedLocal)
      try { await onSave(updatedLocal) } catch (e) {}
    } catch (e) {
      setToast({ type: 'error', message: 'Failed to submit follow-up' })
      setTimeout(() => setToast({ type: null, message: null }), 3000)
    }
  }

  async function handleSaveDraft() {
    const text = (composerText || '').trim()
    if (!text) {
      setToast({ type: 'warning', message: 'Enter a description first' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }

    const newMsg = { id: uuid('msg-'), author: 'user', text, createdAt: new Date().toISOString() }
    const nextLocal: any = { ...local, messages: [...(local.messages || []), newMsg], notes: text }
    setLocal(nextLocal)
    setMessages((prev) => [...prev, newMsg])
    try {
      await onSave(nextLocal)
      setToast({ type: 'success', message: 'Draft saved' })
    } catch (e) {
      setToast({ type: 'error', message: 'Failed to save draft' })
    }
    setTimeout(() => setToast({ type: null, message: null }), 2000)
    setComposerText('')
  }

  async function handleSubmitTask() {
    let nextLocal: any = { ...local }
    // ensure stable taskId
    if (!nextLocal.taskId || !nextLocal.taskId.trim()) {
      nextLocal.taskId = generateTaskId(true)
    }

    // ensure selectedAction exists; create default if missing
    let actionCreated: any = null
    if (!nextLocal.proposedActions || nextLocal.proposedActions.length === 0) {
      const act = {
        id: uuid('act-'),
        type: 'manual',
        description: nextLocal.title || (composerText || 'Run task'),
        payload: {
          routing: nextLocal.routing || { selectedAgentId: AGENTS[0].id, selectedHostname: AGENTS[0].hostname, selectedRole: AGENTS[0].roles[0] }
        }
      }
      nextLocal.proposedActions = [act]
      nextLocal.selectedAction = act.id
      actionCreated = act
    } else if (!nextLocal.selectedAction) {
      nextLocal.selectedAction = nextLocal.proposedActions[0].id
    }

    // attach user message if composer has text
    if (composerText && composerText.trim()) {
      const userMsg = { id: uuid('msg-'), author: 'user', text: composerText.trim(), createdAt: new Date().toISOString() }
      nextLocal.messages = [...(nextLocal.messages || []), userMsg]
      nextLocal.notes = composerText.trim()
      setMessages((prev) => [...prev, userMsg])
    }

    // Save task locally
    try {
      await onSave(nextLocal)
      setLocal(nextLocal)
    } catch (e) {
      // continue
    }

    // Submit decision via standalone API (approved) - includes selectedAction object
    try {
      const ok = await sendActionEvent('approved', { newAction: actionCreated })
      if (ok) {
        const submittedMsg = { id: uuid('msg-'), author: 'system', text: 'Submitted to reviewer.', createdAt: new Date().toISOString() }
        setMessages((prev) => [...prev, submittedMsg])
        nextLocal.messages = [...(nextLocal.messages || []), submittedMsg]
        nextLocal.status = 'pending_review'
        setLocal(nextLocal)
        try { await onSave(nextLocal) } catch (e) {}
      } else {
        setToast({ type: 'error', message: 'Submission failed' })
        setTimeout(() => setToast({ type: null, message: null }), 4000)
      }
    } catch (e) {
      setToast({ type: 'error', message: 'Submission failed' })
      setTimeout(() => setToast({ type: null, message: null }), 4000)
    }

    setComposerText('')
  }

  // Poll for OpenHands results when in chatMode
  const [runnerResult, setRunnerResult] = useState<any | null>(null)
  const [resultLoading, setResultLoading] = useState<boolean>(false)
  const [resultFound, setResultFound] = useState<boolean | null>(null)
  const fetchRunnerRef = useRef<() => Promise<any> | null>(null)

  useEffect(() => {
    let cancelled = false
    let iv: any = null
    const terminalStatuses = ['completed', 'executed', 'failed', 'dry_run_completed']

    async function fetchOnce() {
      if (!chatMode) return
      if (!local || !local.taskId) return

      setResultLoading(true)
      // show checking message while loading
      setMessages((prev) => {
        const idx = prev.findIndex((m: any) => m.data && m.data._runner_marker && m.data._runner_for === local.taskId)
        const loadingMsg = { id: uuid('msg-'), author: 'openhands', text: 'Checking runner result...', createdAt: new Date().toISOString(), data: { _runner_marker: true, _runner_for: local.taskId, loading: true } }
        if (idx === -1) return [...prev, loadingMsg]
        const copy = [...prev]
        copy[idx] = loadingMsg
        return copy
      })

      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/results/${encodeURIComponent(local.taskId)}`)
        if (!res.ok) { setResultLoading(false); return null }
        const r = await res.json()
        if (cancelled) return r
        setResultLoading(false)
        setRunnerResult(r)
        setResultFound(Boolean(r && r.found))

        const resultMsg = {
          id: uuid('msg-'),
          author: 'openhands',
          text: r && r.found === false ? 'Waiting for OpenHands result...' : (r && r.summary) || (r && r.status) || 'Runner result',
          createdAt: (r && (r.updatedAt || r.createdAt)) ? (r.updatedAt || r.createdAt) : new Date().toISOString(),
          data: Object.assign({ _runner_marker: true, _runner_for: local.taskId }, r),
        }

        setMessages((prev) => {
          const idx = prev.findIndex((m: any) => m.data && m.data._runner_marker && m.data._runner_for === local.taskId)
          if (idx === -1) return [...prev, resultMsg]
          const next = [...prev]
          next[idx] = resultMsg
          return next
        })

        // persist result into task (replace any previous runner message)
        const filtered = (local.messages || []).filter((m: any) => !(m.data && m.data._runner_marker && m.data._runner_for === local.taskId))
        const updated = { ...local, openhandsResponse: r && r.summary ? r.summary : local.openhandsResponse, messages: [...filtered, resultMsg] }
        setLocal(updated)
        try { await onSave(updated) } catch (e) {}

        const status = r && r.status ? String(r.status) : null
        if (status && terminalStatuses.includes(status)) {
          if (iv) clearInterval(iv)
        }

        return r
      } catch (e) {
        setResultLoading(false)
        return null
      }
    }

    // expose fetch for manual Refresh button
    fetchRunnerRef.current = fetchOnce

    if (chatMode && local && local.taskId) {
      // initial fetch and then poll every 10s (start polling only if status not terminal)
      fetchOnce().then((r) => {
        const status = r && r.status ? String(r.status) : null
        if (!status || !terminalStatuses.includes(status)) {
          iv = setInterval(fetchOnce, 10000)
        }
      }).catch(() => {})
      return () => { cancelled = true; if (iv) clearInterval(iv) }
    }
    return () => { fetchRunnerRef.current = null }
  }, [local.taskId, chatMode])



  // Fetch opinions when thread overlay opens
  useEffect(() => {
    if (chatMode && local && local.taskId) {
      fetchOpinionsForTask().catch(() => {})
    }
  }, [local.taskId, chatMode])


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

  // second opinion modal state
  const [showSecondOpinionModal, setShowSecondOpinionModal] = useState(false)
  const [opinionTitle, setOpinionTitle] = useState<string>('')
  const [opinionBody, setOpinionBody] = useState<string>('')
  const [opinionsLoading, setOpinionsLoading] = useState<boolean>(false)

  // follow-up modal state
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)
  const [followUpTaskId, setFollowUpTaskId] = useState<string>('')
  const [followUpTitle, setFollowUpTitle] = useState<string>('')
  const [followUpDesc, setFollowUpDesc] = useState<string>('')
  const [followUpAgent, setFollowUpAgent] = useState<string>('')
  const [followUpRole, setFollowUpRole] = useState<string>('')


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

    // Prepare action object for sending; ensure routing information is present
    const actionForSend = selectedActionObj ? { ...selectedActionObj, payload: Object.assign({}, selectedActionObj.payload || {}) } : null
    if (actionForSend) {
      actionForSend.payload.routing = actionForSend.payload.routing || local.routing || { selectedAgentId: AGENTS[0].id, selectedHostname: AGENTS[0].hostname, selectedRole: AGENTS[0].roles[0] }
    }

    // If running in Standalone Mode, send explicit decisions to the standalone API
    if (standaloneMode && ['approved', 'denied', 'deferred'].includes(decision)) {
      const selectedActionToSend = actionForSend || opts.newAction || null
      const payload = {
        taskId: local.taskId,
        decision,
        policy,
        // ensure standalone POST includes the full action object (prefer already-prepared action, otherwise the newAction)
        selectedAction: selectedActionToSend,
        editedAction: opts.editedAction || null,
        newAction: opts.newAction || null,
        notes: local.notes || null,
        source: 'taskboard-standalone',
        createdAt: new Date().toISOString(),
      }

      const token = standaloneToken || (typeof window !== 'undefined' ? window.localStorage.getItem('taskboard_standalone_token') : null)
      if (!token) {
        setToast({ type: 'error', message: 'Standalone API token required' })
        setTimeout(() => setToast({ type: null, message: null }), 4000)
        return false
      }

      setToast({ type: 'warning', message: 'Sending via standalone API...' })
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/task/decision`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const txt = await res.text()
          setToast({ type: 'error', message: `Standalone API failed: ${res.status} ${res.statusText}` })
          setTimeout(() => setToast({ type: null, message: null }), 6000)
          console.error('Standalone API failure', res.status, txt)
          return false
        }
        setToast({ type: 'success', message: 'Sent via standalone API' })
        setTimeout(() => setToast({ type: null, message: null }), 3000)

        // Update local status for explicit decisions
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
        return true
      } catch (e) {
        console.error('Standalone API send error', e)
        setToast({ type: 'error', message: 'Standalone API send error' })
        setTimeout(() => setToast({ type: null, message: null }), 6000)
        return false
      }
    }

    // Fallback: original Matrix send behavior (unchanged)
    const content = {
      taskId: local.taskId,
      decision,
      policy,
      selectedAction: actionForSend,
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


  // Fetch stored 2nd opinions for the current task and attach to messages
  async function fetchOpinionsForTask() {
    if (!chatMode) return
    if (!local || !local.taskId) return
    try {
      setOpinionsLoading(true)
      const res = await fetch(`${import.meta.env.BASE_URL}api/opinions/${encodeURIComponent(local.taskId)}`)
      if (!res.ok) { setOpinionsLoading(false); return }
      const arr = await res.json()
      if (!Array.isArray(arr)) { setOpinionsLoading(false); return }

      // Deduplicate opinions from server before mapping
      const unique: any[] = []
      const seen = new Set<string>()
      for (const op of arr) {
        const title = (op && op.title) ? String(op.title) : ''
        const body = (op && (op.body || op.content)) ? String(op.body || op.content) : ''
        const createdAt = (op && op.createdAt) ? String(op.createdAt) : ''
        const key = op && op.id ? `id:${op.id}` : `kb:${title}\u0001${body}\u0001${createdAt}`
        if (!seen.has(key)) {
          seen.add(key)
          unique.push(op)
        }
      }

      const mapped = unique.map((op: any) => ({ id: op && op.id ? `op-${op.id}` : uuid('op-'), author: 'second_opinion' as any, text: op && op.title ? op.title : (op && (op.body || '').slice(0, 200)) || '', createdAt: (op && op.createdAt) || new Date().toISOString(), data: { opinion: op } }))

      // Replace existing second_opinion messages with the fresh set (avoid duplicate uuids)
      setMessages((prev) => {
        const filteredPrev = (prev || []).filter((m: any) => m.author !== 'second_opinion')
        return [...filteredPrev, ...mapped]
      })

      // persist into local task messages (replace previous second_opinion messages)
      try {
        const filtered = (local.messages || []).filter((m: any) => !(m.author === 'second_opinion'))
        const updated = { ...local, messages: [...filtered, ...mapped] }
        setLocal(updated)
        await onSave(updated)
      } catch (e) {}
      setOpinionsLoading(false)
    } catch (e) {
      setOpinionsLoading(false)
    }
  }

  // Submit a new 2nd Opinion (saves to server storage). Server may optionally call ChatGPT.
  async function handleSubmitOpinion() {
    const title = (opinionTitle || '').trim()
    const body = (opinionBody || '').trim()
    if (!title || !body) {
      setToast({ type: 'warning', message: 'Enter title and content for 2nd Opinion' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }
    if (!local || !local.taskId) {
      setToast({ type: 'error', message: 'Missing taskId' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      return
    }
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/opinions/${encodeURIComponent(local.taskId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body })
      })
      if (!res.ok) {
        setToast({ type: 'error', message: 'Failed to save 2nd Opinion' })
        setTimeout(() => setToast({ type: null, message: null }), 2500)
        return
      }
      const saved = await res.json()
      setShowSecondOpinionModal(false)
      setOpinionBody('')
      setOpinionTitle('')
      setToast({ type: 'success', message: '2nd Opinion saved' })
      setTimeout(() => setToast({ type: null, message: null }), 2000)
      // refresh opinions and attach to thread
      await fetchOpinionsForTask()
    } catch (e) {
      setToast({ type: 'error', message: 'Failed to save 2nd Opinion' })
      setTimeout(() => setToast({ type: null, message: null }), 2500)
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

  if (chatMode) {
    return (
      <div className="task-detail chat-mode">
        <div className="chat-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={local.title || ''}
            onChange={(e) => update({ title: (e.target as HTMLInputElement).value })}
            placeholder="Task title"
            style={{ flex: 1, fontSize: 18, padding: 8 }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 160 }}>
            <label style={{ fontSize: 12 }}>Agent</label>
            <select
              value={(local.routing && local.routing.selectedAgentId) || AGENTS[0].id}
              onChange={(e) => {
                const sel = AGENTS.find(a => a.id === (e.target as HTMLSelectElement).value) || AGENTS[0]
                update({ routing: { selectedAgentId: sel.id, selectedHostname: sel.hostname, selectedRole: sel.roles[0] } })
              }}
              style={{ padding: 6 }}
            >
              {AGENTS.map((a) => <option key={a.id} value={a.id}>{formatAgentDisplay(a)}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: 12 }}>Role</label>
            <select
              value={(local.routing && local.routing.selectedRole) || (AGENTS.find(a => a.id === ((local.routing && local.routing.selectedAgentId) || AGENTS[0].id))?.roles?.[0])}
              onChange={(e) => { update({ routing: { ...(local.routing || {}), selectedRole: (e.target as HTMLSelectElement).value } }) }}
              style={{ padding: 6 }}
            >
              {(AGENTS.find(a => a.id === ((local.routing && local.routing.selectedAgentId) || AGENTS[0].id)) || AGENTS[0]).roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

          {showSecondOpinionModal ? (
            <div className="modal-overlay" onClick={() => setShowSecondOpinionModal(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Get 2nd Opinion</h3>
                <div className="form-row">
                  <label>Title</label>
                  <input value={opinionTitle} onChange={(e) => setOpinionTitle((e.target as HTMLInputElement).value)} />
                </div>
                <div className="form-row">
                  <label>Content</label>
                  <textarea value={opinionBody} onChange={(e) => setOpinionBody((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 160 }} />
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowSecondOpinionModal(false)}>Cancel</button>
                  <button onClick={handleSubmitOpinion}>Save Opinion</button>
                </div>
              </div>
            </div>
          ) : null}

          {showFollowUpModal ? (
            <div className="modal-overlay" onClick={() => setShowFollowUpModal(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>New Follow-up Task</h3>
                <div className="form-row">
                  <label>Task ID (optional)</label>
                  <input value={followUpTaskId} onChange={(e) => setFollowUpTaskId((e.target as HTMLInputElement).value)} />
                </div>
                <div className="form-row">
                  <label>Title</label>
                  <input value={followUpTitle} onChange={(e) => setFollowUpTitle((e.target as HTMLInputElement).value)} />
                </div>
                <div className="form-row">
                  <label>Description</label>
                  <textarea value={followUpDesc} onChange={(e) => setFollowUpDesc((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 120 }} />
                </div>
                <div className="form-row">
                  <label>Agent</label>
                  <select value={followUpAgent} onChange={(e) => setFollowUpAgent((e.target as HTMLSelectElement).value)}>
                    {AGENTS.map((a) => <option key={a.id} value={a.id}>{formatAgentDisplay(a)}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <label>Role</label>
                  <select value={followUpRole} onChange={(e) => setFollowUpRole((e.target as HTMLSelectElement).value)}>
                    {(AGENTS.find(a => a.id === followUpAgent) || AGENTS[0]).roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowFollowUpModal(false)}>Cancel</button>
                  <button onClick={handleSaveFollowUpDraft}>Save Draft</button>
                  <button onClick={handleSubmitFollowUp}>Submit Follow-up</button>
                </div>
              </div>
            </div>
          ) : null}

          </div>

          <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center' }}>
            <span className={`status-pill status-${local.status || 'pending'}`}>{local.status || 'pending'}</span>
            <button className="small" onClick={() => { if (fetchRunnerRef.current) fetchRunnerRef.current(); }} style={{ marginLeft: 8 }}>Refresh</button>
          </div>
        </div>

        {/* Parent link and Follow-up list */}
        {local && local.parentTaskId ? (
          <div className="panel" style={{ marginBottom: 8 }}>
            <strong>Parent Task:</strong> <button className="small" onClick={() => { try { if (openTask) openTask(local.parentTaskId as string) } catch (e) {} }} style={{ marginLeft: 8 }}>{local.parentTaskId}</button>
          </div>
        ) : null}

        {local && Array.isArray(local.followUpIds) && local.followUpIds.length > 0 ? (
          <div className="panel" style={{ marginBottom: 8 }}>
            <strong>Follow-up Tasks</strong>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {local.followUpIds.map((id) => (
                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14 }}>{id}</div>
                  <div>
                    <button className="small" onClick={() => { try { if (openTask) openTask(id) } catch (e) {} }}>Open</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="messages" ref={messagesRef} style={{ overflowY: 'auto', maxHeight: '60vh', padding: 12 }}>
          {messages.map((m) => {
            const isRunner = m.data && m.data._runner_marker
            const isOpinion = m.author === 'second_opinion' || (m.data && m.data.opinion)
            return (
              <div key={m.id} className={`message-bubble ${m.author}`} style={{ marginBottom: 12 }}>
                <div className="message-meta" style={{ fontSize: 12, color: '#666' }}>{isOpinion ? 'ChatGPT' : (m.author === 'openhands' ? 'OpenHands' : m.author)} · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</div>
                {isOpinion ? (
                  <>
                    <div className="message-text" style={{ marginTop: 6 }}>
                      {m.data && m.data.opinion && (m.data.opinion.title || m.data.opinion.body) ? (
                        <>
                          {m.data.opinion.title ? <div style={{ fontWeight: 600 }}>{m.data.opinion.title}</div> : null}
                          {m.data.opinion.body ? <div style={{ marginTop: 6 }}>{m.data.opinion.body}</div> : null}
                        </>
                      ) : (m.text || '')}
                    </div>
                    <details style={{ marginTop: 8 }}>
                      <summary>Developer info</summary>
                      <pre className="message-data" style={{ background: '#f7fafc', padding: 8, marginTop: 8, borderRadius: 6 }}>{JSON.stringify(m.data, null, 2)}</pre>
                    </details>
                  </>
                ) : isRunner ? (
                  <>
                    <div className="message-text" style={{ marginTop: 6 }}>{m.data && m.data.loading ? 'Checking runner result...' : (m.data && m.data.found === false ? 'Waiting for OpenHands result...' : (m.data && m.data.summary ? m.data.summary : m.text))}</div>
                    <div className="runner-details" style={{ marginTop: 8 }}>
                      {m.data && m.data.status ? <div><strong>status:</strong> {m.data.status}</div> : null}
                      {m.data && m.data.runDirectory ? <div><strong>runDirectory:</strong> {m.data.runDirectory}</div> : null}
                      {m.data && (m.data.updatedAt || m.data.createdAt) ? <div><strong>updatedAt:</strong> {m.data.updatedAt || m.data.createdAt}</div> : null}
                      {m.data && m.data.resultId ? <div><strong>resultId:</strong> {m.data.resultId}</div> : null}
                      {m.data && (typeof m.data.returnCode !== 'undefined') ? <div><strong>returnCode:</strong> {String(m.data.returnCode)}</div> : null}
                    </div>
                    <details style={{ marginTop: 8 }}>
                      <summary>Developer info</summary>
                      <pre className="message-data" style={{ background: '#f7fafc', padding: 8, marginTop: 8, borderRadius: 6 }}>{JSON.stringify(m.data, null, 2)}</pre>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="message-text" style={{ marginTop: 6 }}>
                        {m.data && m.data.followUpTask ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>{m.text}</div>
                            <div style={{ marginLeft: 8 }}>
                              <button className="small" onClick={() => { try { if (openTask && m && m.data && m.data.followUpTask) openTask(m.data.followUpTask.taskId) } catch (e) {} }}>
                                Open follow-up
                              </button>
                            </div>
                          </div>
                        ) : (
                          m.text
                        )}
                      </div>
                    {m.data ? <pre className="message-data" style={{ background: '#f7fafc', padding: 8, marginTop: 8, borderRadius: 6 }}>{JSON.stringify(m.data, null, 2)}</pre> : null}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="composer" style={{ position: 'sticky', bottom: 0, background: '#fff', padding: 8, borderTop: '1px solid #eee' }}>
          <textarea
            value={composerText}
            onChange={(e) => setComposerText((e.target as HTMLTextAreaElement).value)}
            placeholder="Describe the task..."
            style={{ width: '100%', height: 96, padding: 8, fontSize: 15 }}
          />

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12 }}>Agent</label>
            <select
              value={(local.routing && local.routing.selectedAgentId) || AGENTS[0].id}
              onChange={(e) => {
                const sel = AGENTS.find(a => a.id === (e.target as HTMLSelectElement).value) || AGENTS[0]
                update({ routing: { selectedAgentId: sel.id, selectedHostname: sel.hostname, selectedRole: sel.roles[0] } })
              }}
              style={{ width: '100%', padding: 6 }}
            >
              {AGENTS.map((a) => <option key={a.id} value={a.id}>{formatAgentDisplay(a)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12 }}>Role</label>
            <select value={(local.routing && local.routing.selectedRole) || (AGENTS.find(a => a.id === ((local.routing && local.routing.selectedAgentId) || AGENTS[0].id))?.roles?.[0])}
              onChange={(e) => { update({ routing: { ...(local.routing || {}), selectedRole: (e.target as HTMLSelectElement).value } }) }}
              style={{ width: '100%', padding: 6 }}>
              {(AGENTS.find(a => a.id === ((local.routing && local.routing.selectedAgentId) || AGENTS[0].id)) || AGENTS[0]).roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="small" onClick={handleGetSecondOpinion} style={{ flex: 1 }}>Get 2nd Opinion</button>
            <button className="small" onClick={handleOpenFollowUpModal} style={{ flex: 1 }}>New Follow-up Task</button>
            <button className="small" onClick={handleSaveDraft} style={{ flex: 1 }}>Save Draft</button>
            <button className="small" onClick={handleSubmitTask} style={{ flex: 1, background: '#10b981', color: '#fff', border: 'none' }}>Submit Task</button>
          </div>
        </div>
      </div>
    )
  }

    return (

    <div className="task-detail">
      <h2>{local.title}</h2>
      {local && local.parentTaskId ? (
        <div style={{ marginBottom: 8 }}>
          <strong>Parent Task:</strong> <button className="small" onClick={() => { try { if (openTask) openTask(local.parentTaskId as string) } catch (e) {} }} style={{ marginLeft: 8 }}>{local.parentTaskId}</button>
        </div>
      ) : null}

      {local && Array.isArray(local.followUpIds) && local.followUpIds.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <strong>Follow-up Tasks:</strong>
          <div style={{ marginTop: 6 }}>
            {local.followUpIds.map((id) => (
              <div key={id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
                <div>{id}</div>
                <div><button className="small" onClick={() => { try { if (openTask) openTask(id) } catch (e) {} }}>Open</button></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', fontSize: 12 }}>Task ID</label>
        <input
          type="text"
          value={local.taskId || ''}
          onChange={(e) => update({ taskId: (e.target as HTMLInputElement).value })}
          placeholder="e.g. PWA-DBWRITE-SMOKE-001"
          style={{ width: '100%', padding: 6 }}
        />
        {!local.taskId ? <div style={{ color: '#b45309', marginTop: 6 }}>Task ID is required to approve actions.</div> : null}
      </div>

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
          <button onClick={() => doDecision('approved')} disabled={!local.selectedAction || !local.taskId || !local.taskId.trim()}>
            Approve Selected Action
          </button>
          <button onClick={() => doDecision('denied')}>Deny</button>
          <button onClick={() => doDecision('deferred')}>Defer</button>
        </div>
      ) : (
        <div className="mobile-action-bar">
          <button onClick={handleSave}>Save</button>
          <button onClick={() => doDecision('approved')} disabled={!local.selectedAction || !local.taskId || !local.taskId.trim()}>Approve</button>
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


  // Chat-mode toggle (query param ?v=chat-ui) and mobile-aware layout
  const [isChatView, setIsChatView] = useState<boolean>(typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') === 'chat-ui' : false)
  const [isMobileApp, setIsMobileApp] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 600 : false)
  useEffect(() => {
    function onResizeApp() { setIsMobileApp(window.innerWidth <= 600) }
    try { onResizeApp(); window.addEventListener('resize', onResizeApp) } catch (e) {}
    return () => { try { window.removeEventListener('resize', onResizeApp) } catch (e) {} }
  }, [])

  // Runner status (display as status pill)
  const [runnerStatus, setRunnerStatus] = useState<string>('unknown')
  useEffect(() => {
    let mounted = true
    async function fetchRunner() {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/runner-status`)
        if (!res.ok) return
        const j = await res.json()
        if (mounted && j && j.status) setRunnerStatus(j.status)
      } catch (e) {}
    }
    fetchRunner()
    const iv = setInterval(fetchRunner, 10000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  // Live agent registry: fetch on load and refresh periodically
  const [agentsState, setAgentsState] = useState<Agent[]>(AGENTS)

  useEffect(() => {
    let mounted = true
    async function fetchAgents() {
      try {
        const url = `${import.meta.env.BASE_URL}api/agents`
        const res = await fetch(url)
        if (!res.ok) return
        const body = await res.json()
        let list: any[] = []
        if (Array.isArray(body)) list = body
        else if (Array.isArray(body.agents)) list = body.agents
        else list = []

        const normalized: Agent[] = list.map((a: any) => {
          const agentId = a.agentId || a.id || ''
          const hostname = a.hostname || a.host || ''
          const roles = Array.isArray(a.roles) ? a.roles : (a.roles ? [a.roles] : [])
          const status = a.status || 'unknown'
          const cpuCount = typeof a.cpuCount === 'number' ? a.cpuCount : (typeof a.cpu === 'number' ? a.cpu : 0)
          const memoryGb = typeof a.memoryGb === 'number' ? a.memoryGb : (typeof a.memory_gb === 'number' ? a.memory_gb : null)
          const diskFreeGb = typeof a.diskFreeGb === 'number' ? a.diskFreeGb : (typeof a.disk_free_gb === 'number' ? a.disk_free_gb : null)
          const loadAverage = typeof a.loadAverage === 'number' ? a.loadAverage : (typeof a.load_avg === 'number' ? a.load_avg : null)
          const lastSeen = a.lastSeen || a.last_seen || null
          let freshnessSeconds: number | null = null
          let isFresh = false
          if (lastSeen) {
            const t = new Date(lastSeen).getTime()
            if (!Number.isNaN(t)) {
              freshnessSeconds = Math.floor((Date.now() - t) / 1000)
              isFresh = freshnessSeconds <= 300
            }
          }
          return {
            agentId,
            id: agentId,
            hostname,
            roles,
            status,
            cpuCount,
            memoryGb,
            diskFreeGb,
            loadAverage,
            lastSeen,
            freshnessSeconds,
            isFresh,
            raw: a,
          }
        })

        normalized.sort((A, B) => {
          if ((A.isFresh ? 1 : 0) !== (B.isFresh ? 1 : 0)) return (A.isFresh ? -1 : 1)
          const aIdle = (A.status === 'idle') ? 1 : 0
          const bIdle = (B.status === 'idle') ? 1 : 0
          if (aIdle !== bIdle) return (bIdle - aIdle)
          return String(A.agentId || '').localeCompare(String(B.agentId || ''))
        })

        if (mounted) {
          AGENTS = normalized
          setAgentsState(normalized)
        }
      } catch (e) {
        console.warn('Failed to fetch agents registry', e)
      }
    }
    fetchAgents()
    const iv = setInterval(fetchAgents, 60000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])



  function createNewTask(initialTitle = ''): Task {
    const id = generateTaskId(true)
    const defaultAgent = AGENTS[0]
    const newTask: Task & { messages?: any[]; routing?: any; updatedAt?: string } = {
      taskId: id,
      title: initialTitle || '',
      status: 'pending_review',
      openhandsResponse: '',
      reviewerSummary: '',
      proposedActions: [],
      selectedAction: null,
      notes: '',
      routing: { selectedAgentId: defaultAgent.id, selectedHostname: defaultAgent.hostname, selectedRole: defaultAgent.roles[0] },
      updatedAt: new Date().toISOString(),
      messages: [{ id: uuid('msg-'), author: 'system', text: 'New task created', createdAt: new Date().toISOString() }],
    }
    setTasks((prev) => [newTask as Task, ...prev])
    setSelected(newTask.taskId)
    return newTask as Task
  }


  const widgetRef = useRef<any>(null)
  const [widgetInfo, setWidgetInfo] = useState<{ widgetId: string | null; parentUrl: string | null; roomId: string | null; connected: boolean; capabilitiesGranted: boolean }>({
    widgetId: null,
    parentUrl: null,
    roomId: null,
    connected: false,
    capabilitiesGranted: false,
  })
  const [devOpen, setDevOpen] = useState(false)

  // Standalone API token (stored in localStorage)
  const [standaloneToken, setStandaloneToken] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState<string>('')

  const [rawParams, setRawParams] = useState<{ rawWidgetId: string | null; rawParentUrl: string | null; rawRoomId: string | null }>({
    rawWidgetId: null,
    rawParentUrl: null,
    rawRoomId: null,
  })

  const [transportWidgetId, setTransportWidgetId] = useState<string | null>(null)

  const [gotWidgetConfig, setGotWidgetConfig] = useState(false)

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

      // capture raw values (before placeholder cleanup) for Developer Info
      const rawWidgetId = widgetId
      const rawParentUrl = parentUrl
      const rawRoomId = roomId
      try { setRawParams({ rawWidgetId, rawParentUrl, rawRoomId }) } catch (e) {}


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
              try { setGotWidgetConfig(true) } catch (e) {}
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


				// capture transport.widgetId for Developer Info if available
				try { setTransportWidgetId(apiInstance && apiInstance.transport && apiInstance.transport.widgetId ? apiInstance.transport.widgetId : null) } catch (e) {}


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

  // Load standalone token from localStorage (once)
  useEffect(() => {
    try {
      const t = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem('taskboard_standalone_token') : null
      if (t) {
        setStandaloneToken(t)
        setTokenInput(t)
      }
    } catch (e) {}
  }, [])


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

  const isStandalone = !(widgetInfo.connected && widgetInfo.capabilitiesGranted && (transportWidgetId || widgetInfo.widgetId));


  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1>Taskboard</h1>
          <button className="small" onClick={() => createNewTask()} style={{ marginLeft: 8, background: '#3b82f6', color:'#fff', border: 'none' }}>
            New Task
          </button>
        </div>
        <div className="header-right">
          <span className={`connection-status ${widgetInfo.connected ? 'online' : 'offline'}`}>
            {widgetInfo.connected ? 'Connected' : 'Local'}{widgetInfo.capabilitiesGranted ? ' · Capabilities granted' : ''}
          </span>
          <span className={`connection-status ${runnerStatus === 'dry-run' ? 'offline' : 'online'}`} style={{ marginLeft: 8 }}>
            Runner: {runnerStatus === 'dry-run' ? 'dry-run' : 'connected'}
          </span>
          <span className={`mode-badge ${isStandalone ? 'mode-standalone' : 'mode-matrix'}`} style={{ marginLeft: 8 }}>
            {isStandalone ? 'Standalone Mode' : 'Matrix Mode'}
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

          <div><strong>Location</strong></div>
          <div>href: {typeof window !== 'undefined' ? window.location.href : '(no window)'}</div>
          <div>search: {typeof window !== 'undefined' ? window.location.search : '(no window)'}</div>
          <div>hash: {typeof window !== 'undefined' ? window.location.hash : '(no window)'}</div>

          <div style={{ marginTop: 8 }}><strong>Raw query params (before placeholder cleanup)</strong></div>
          <div>rawWidgetId: {rawParams.rawWidgetId ?? '(none)'}</div>
          <div>rawParentUrl: {rawParams.rawParentUrl ?? '(none)'}</div>
          <div>rawRoomId: {rawParams.rawRoomId ?? '(none)'}</div>

          <div style={{ marginTop: 8 }}><strong>Parsed values after cleanup</strong></div>
          <div>widgetId: {widgetInfo.widgetId ?? '(none)'}</div>
          <div>parentUrl: {widgetInfo.parentUrl ?? '(none)'}</div>
          <div>roomId: {widgetInfo.roomId ?? '(none)'}</div>


          <div style={{ marginTop: 8 }}><strong>Standalone API</strong></div>
          <div style={{ marginTop: 6 }}>
            <div className="form-row">
              <label>Standalone API token (stored in localStorage)</label>
              <input type="password" value={tokenInput} onChange={(e) => setTokenInput((e.target as HTMLInputElement).value)} style={{ width: '100%', padding: 6 }} />
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => { try { window.localStorage.setItem('taskboard_standalone_token', tokenInput); setStandaloneToken(tokenInput); } catch (e) {} }}>Save token</button>
              <button onClick={() => { try { window.localStorage.removeItem('taskboard_standalone_token'); setStandaloneToken(null); setTokenInput(''); } catch (e) {} }} style={{ marginLeft: 8 }}>Clear token</button>
            </div>
            {isStandalone && !standaloneToken ? (<div style={{ marginTop: 8, color: '#b45309' }}>Standalone API token required</div>) : null}
          </div>

          <div style={{ marginTop: 8 }}><strong>Transport</strong></div>
          <div>transport.widgetId: {transportWidgetId ?? '(none)'}</div>
          <div>widget_config received: {gotWidgetConfig ? 'yes' : 'no'}</div>

          <div style={{ marginTop: 8 }}><strong>Widget Info (raw)</strong></div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{safeStringify(widgetInfo)}</pre>
          <div><strong>Diagnostics (recent)</strong></div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{diags.slice(-40).join('\n')}</pre>
        </div>
      ) : null}
      <div className="board">
        {isMobileApp ? (
          <div className="chat-home">
            <div className="threads-list">
              <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Active Tasks</h3>
                <button className="small" onClick={() => { createNewTask(); }} style={{ padding: '6px 10px' }}>+ New Task</button>
              </div>
              {tasks.filter((t) => t.status !== 'completed').map((t) => (
                <div key={t.taskId} className={'thread-item' + (selected === t.taskId ? ' selected' : '')} onClick={() => setSelected(t.taskId)}>
                  <TaskCard t={t} onClick={() => setSelected(t.taskId)} />
                </div>
              ))}

              <div style={{ padding: '8px 12px', marginTop: 8 }}>
                <h3 style={{ margin: 0 }}>Recent Tasks</h3>
              </div>

              {tasks.filter((t) => t.status === 'completed').slice(0, 10).map((t) => (
                <div key={t.taskId} onClick={() => setSelected(t.taskId)}>
                  <TaskCard t={t} onClick={() => setSelected(t.taskId)} />
                </div>
              ))}
            </div>
            <div className="detail-pane">
              {current ? (
                <TaskDetail
                  task={current}
                  onSave={async (t) => { const d = await saveTask(t); await load(); return d }}
                  sendMatrixEvent={sendMatrixEvent}
                  widgetInfo={widgetInfo}
                  showDev={devOpen}
                  standaloneMode={isStandalone}
                  standaloneToken={standaloneToken}
                  chatMode={true}
                  openTask={(id: string) => setSelected(id)}
                />
              ) : (
                <div style={{ padding: 16 }}>Start a new task or select a thread</div>
              )}
            </div>
          </div>
        ) : (
          <>
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
                  standaloneMode={isStandalone}
                  standaloneToken={standaloneToken}
                  openTask={(id: string) => setSelected(id)}

                  chatMode={isChatView && isMobileApp}
                />
              ) : (
                <div>Select a task to view details</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
