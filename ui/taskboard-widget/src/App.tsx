import React, { useEffect, useState, useRef } from 'react'
import { Task, ProposedAction, Agent, AgentRecommendation, Notification, NotificationType } from './types'
import { WidgetApi } from 'matrix-widget-api'
import { recommendAgent } from './agentRecommendation'


import ConversationWorkspace from './components/ConversationWorkspace'

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

// recommendAgent moved to src/agentRecommendation.ts


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

const TaskCard = ({ t, onClick, hasNewResult = false }: { t: any; onClick?: () => void; hasNewResult?: boolean }) => {
  const agentId = t?.routing?.selectedAgentId || AGENTS[0].id
  const hostname = t?.routing?.selectedHostname || AGENTS[0].hostname
  const role = t?.routing?.selectedRole || (t?.routing?.role) || (AGENTS.find(a => a.id === agentId)?.roles?.[0]) || 'general'
  const last = (t && Array.isArray(t.messages) && t.messages.length) ? t.messages[t.messages.length - 1].createdAt : t && t.updatedAt
  const summary = t.openhandsResponse ? (String(t.openhandsResponse).split('\n')[0]) : 'Result: (pending)'

  const agentObj = AGENTS.find(a => (a.id === agentId) || (a.agentId === agentId)) || null
  const isStale = agentObj ? !agentObj.isFresh : true

  return (
    <div className={'card'} onClick={onClick} style={{ padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="card-title" style={{ flex: 1 }}>{t.title || t.taskId}</div>
        {hasNewResult ? <div className="badge-new">New</div> : null}
      </div>
      <div className="card-sub" style={{ marginTop: 6 }}>
        <span className="card-status">{t.status}</span>
        <span style={{ marginLeft: 8 }}>{agentId} · {hostname}</span>
        {agentObj && isStale ? (<span style={{ marginLeft: 8, color: '#b45309', fontSize: 12 }}>⚠️ stale</span>) : null}
        <span style={{ marginLeft: 8 }}>{role}</span>
        <span style={{ marginLeft: 8 }}>{timeAgo(last)}</span>
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
  agents,
  onResultSeen,
  tasks,
}: {
  task: Task
  onSave: (t: Task) => Promise<any>
  sendMatrixEvent: (content: any) => Promise<{ ok: boolean; error?: string }>
  widgetInfo: { widgetId: string | null; parentUrl: string | null; roomId: string | null; connected: boolean; capabilitiesGranted: boolean }
  showDev?: boolean
  // frontend standalone props
  standaloneMode?: boolean
  standaloneToken?: string | null
  chatMode?: boolean
  openTask?: (id: string) => void
  agents: Agent[]
  onResultSeen?: (taskId: string, signature: string) => void
  tasks: Task[]
}) {
  const [local, setLocal] = useState<Task>(task)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error' | null; message: string | null }>({ type: null, message: null })
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 600 : false)

  // Compute recommendation for the currently selected role (pure, re-run each render)
  const selectedRoleForRec = (local && local.routing && (local.routing.selectedRole || local.routing.role)) || 'general'
  const taskContext = {
    conversationId: (local && local.conversationId) || undefined,
    rootTaskId: (local && local.rootTaskId) || undefined,
    parentTaskId: (local && local.parentTaskId) || undefined,
    selectedAgentId: (local && local.routing && local.routing.selectedAgentId) || undefined,
    selectedHostname: (local && local.routing && local.routing.selectedHostname) || undefined,
  }
  const recommendation = recommendAgent(selectedRoleForRec, agents || [], taskContext)
  const recommendationApplied = !!(recommendation && local && local.routing && local.routing.selectedAgentId === recommendation.agentId)

  // Helper: build session chain data and render UI
  function buildSessionTree(rootId: string) {
    const all = Array.isArray(tasks) ? tasks : []
    const byId: { [k: string]: Task } = {}
    const byParent: { [k: string]: Task[] } = {}
    all.forEach((t) => { byId[t.taskId] = t; const p = t.parentTaskId || null; if (!byParent[p]) byParent[p] = []; byParent[p].push(t) })

    function buildNode(id: string) {
      const nodeTask = byId[id] || null
      const children = (byParent[id] || []).map((c) => buildNode(c.taskId))
      return { task: nodeTask, children }
    }

    return buildNode(rootId)
  }

  function renderSessionChainCard() {
    try {
      const rootId = (local && local.rootTaskId) ? local.rootTaskId : local.taskId
      const rootTask = (Array.isArray(tasks) ? tasks.find((t) => t.taskId === rootId) : null) || local
      const tree = buildSessionTree(rootId)

      function renderNode(node: any, depth = 0, parentTask: Task | null = null) {
        if (!node || !node.task) return null
        const t: Task = node.task
        const convMissing = !t.conversationId && parentTask && !!parentTask.conversationId
        const agentMismatch = parentTask && parentTask.routing && t.routing && (parentTask.routing.selectedAgentId !== t.routing.selectedAgentId)
        return (
          <div key={t.taskId} className="session-node" style={{ marginLeft: depth * 12, padding: '6px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: depth === 0 ? 700 : 600, fontSize: depth === 0 ? 14 : 13, cursor: openTask ? 'pointer' : 'default' }} onClick={() => { if (openTask) openTask(t.taskId) }}>{depth === 0 ? 'ROOT: ' : ''}{t.taskId}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{t.routing && t.routing.selectedAgentId ? formatAgentDisplay({ agentId: t.routing.selectedAgentId, hostname: t.routing.selectedHostname || '' } as any) : ''}</div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              <div>Conversation: {t.conversationId || (convMissing ? <span style={{ color: '#b45309' }}>Missing OpenHands conversation context</span> : '(none)')}</div>
              <div>Hostname: {t.routing && t.routing.selectedHostname ? t.routing.selectedHostname : '-'}</div>
              <div>Previous run dir: {(t.context && t.context.previousRunDirectory) ? t.context.previousRunDirectory : '-'}</div>
              {agentMismatch ? <div style={{ color: '#b45309', marginTop: 6 }}>Agent changed from parent task</div> : null}
            </div>
            {(node.children || []).map((c: any) => renderNode(c, depth + 1, t))}
          </div>
        )
      }

      return (
        <div className="session-chain" style={{ padding: 8, borderRadius: 6, border: '1px solid #eef2ff', background: '#fbfbff', maxWidth: 520 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Session Chain</div>
          {renderNode(tree, 0, null)}
        </div>
      )
    } catch (e) {
      return null
    }
  }


  useEffect(() => setLocal(task), [task])

  // Normalize messages helper (ensures consistent message types and lifecycle messages)
  function normalizeMessages(rawMessages: any[] | undefined) {
    const raw = (Array.isArray(rawMessages) ? rawMessages : [])
    const normalized: any[] = raw.map((m: any) => {
      const authorRaw = (m && m.author) ? m.author : 'system'
      let author: any = authorRaw
      if (authorRaw === 'openhands') author = 'result'
      if (authorRaw === 'second_opinion') author = 'second_opinion'
      if (authorRaw === 'follow_up') author = 'follow_up'
      if (authorRaw === 'system') {
        if (m && m.data && m.data.followUpTask) author = 'follow_up'
        else if (m && typeof m.text === 'string' && /follow-?up task created/i.test(m.text)) author = 'follow_up'
      }
      return { ...m, author }
    })

    // Determine earliest raw message timestamp (ms)
    let earliestRawTs: number | null = null
    for (const m of raw) {
      if (m && m.createdAt) {
        const t = Date.parse(m.createdAt)
        if (!isNaN(t)) {
          if (earliestRawTs === null || t < earliestRawTs) earliestRawTs = t
        }
      }
    }

    const taskUpdatedTs = task && (task as any).updatedAt ? (() => { const t = Date.parse((task as any).updatedAt); return isNaN(t) ? null : t })() : null
    const now = Date.now()

    // Base timestamp for synthetic Task Created: prefer earliestRawTs - 10s, else task.updatedAt - 10s, else now - 20s
    let baseTaskCreated: number
    if (earliestRawTs !== null) baseTaskCreated = earliestRawTs - 10000
    else if (taskUpdatedTs !== null) baseTaskCreated = taskUpdatedTs - 10000
    else baseTaskCreated = now - 20000

    if (baseTaskCreated > now) baseTaskCreated = now - 20000

    const augmented: any[] = []

    // Ensure Task Created system message exists (strict match to avoid counting follow-up created)
    const hasCreated = normalized.find((m: any) => m.author === 'system' && m.text && /task created/i.test(String(m.text)))
    if (!hasCreated) {
      augmented.push({ id: uuid('msg-'), author: 'system', text: 'Task Created', createdAt: new Date(baseTaskCreated).toISOString() })
    }

    // Ensure user notes present if task.notes exists and no explicit user message
    if (task && (task as any).notes) {
      const hasUser = normalized.find((m: any) => m.author === 'user' && m.text && String(m.text).trim())
      if (!hasUser) {
        augmented.push({ id: uuid('msg-'), author: 'user', text: (task as any).notes, createdAt: new Date(baseTaskCreated + 1000).toISOString() })
      }
    }

    // Ensure reviewer message present when reviewerSummary exists
    if (task && task.reviewerSummary) {
      const hasReviewer = normalized.find((m: any) => m.author === 'reviewer')
      if (!hasReviewer) {
        augmented.push({ id: uuid('msg-'), author: 'reviewer', text: task.reviewerSummary, createdAt: new Date(baseTaskCreated + 2000).toISOString() })
      }
    }

    // Synthesize Runner Started and Runner Result Available messages around result messages
    normalized.forEach((m: any) => {
      if (m.author === 'result') {
        const resultTsRaw = m.createdAt ? Date.parse(m.createdAt) : NaN
        const rTs = (!isNaN(resultTsRaw)) ? resultTsRaw : (baseTaskCreated + 3000)
        const startTs = rTs - 2000 // Runner Started ~2s before result
        const availableTs = rTs + 1000 // Runner Result Available ~1s after result

        const startExists = normalized.find((x: any) => x.author === 'system' && /Runner Started/i.test(String(x.text)) && Math.abs((Date.parse(x.createdAt || '') || rTs) - rTs) < 300000)
        if (!startExists) augmented.push({ id: uuid('msg-'), author: 'system', text: 'Runner Started', createdAt: new Date(startTs).toISOString() })

        const availableExists = normalized.find((x: any) => x.author === 'system' && /Runner Result Available/i.test(String(x.text)) && Math.abs((Date.parse(x.createdAt || '') || rTs) - rTs) < 300000)
        if (!availableExists) augmented.push({ id: uuid('msg-'), author: 'system', text: 'Runner Result Available', createdAt: new Date(availableTs).toISOString() })
      }
    })

    // Add augmented synthetic messages to the list and sort
    const all = [...normalized, ...augmented]
    all.sort((A, B) => {
      const aT = Date.parse(A.createdAt || '') || 0
      const bT = Date.parse(B.createdAt || '') || 0
      if (aT === bT) return (A.id || '').localeCompare(B.id || '')
      return aT - bT
    })

    // Adjust duplicates to ensure strictly increasing timestamps (1ms increments)
    for (let i = 1; i < all.length; i++) {
      const prevT = Date.parse(all[i - 1].createdAt || '') || 0
      let curT = Date.parse(all[i].createdAt || '') || 0
      if (curT <= prevT) {
        curT = prevT + 1
        all[i].createdAt = new Date(curT).toISOString()
      }
    }

    return all
  }

  // Chat/thread state for chat-mode
  const [messages, setMessages] = useState<any[]>(() => {
    try {
      if (task && Array.isArray((task as any).messages) && (task as any).messages.length) return normalizeMessages((task as any).messages)
    } catch (e) {}
    const init: any[] = []
    init.push({ id: uuid('msg-'), author: 'system', text: 'Task Created', createdAt: new Date().toISOString() })
    if (task && (task as any).notes) init.push({ id: uuid('msg-'), author: 'user', text: (task as any).notes, createdAt: new Date().toISOString() })
    if (task && task.reviewerSummary) init.push({ id: uuid('msg-'), author: 'reviewer', text: task.reviewerSummary, createdAt: new Date().toISOString() })
    if (task && task.openhandsResponse) init.push({ id: uuid('msg-'), author: 'result', text: task.openhandsResponse, createdAt: new Date().toISOString() })
    return normalizeMessages(init)
  })


  const [headerUpdated, setHeaderUpdated] = useState<boolean>(false)
  const [highlightedResultId, setHighlightedResultId] = useState<string | null>(null)

  useEffect(() => {
    // sync when underlying task messages change
    try {
      if (local && Array.isArray((local as any).messages) && (local as any).messages.length) setMessages(normalizeMessages((local as any).messages))
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
    try {
      await copyFor2ndOpinion()
    } catch (e) {
      setToast({ type: 'error', message: 'Failed to copy for 2nd Opinion' })
      setTimeout(() => setToast({ type: null, message: null }), 2500)
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
            {/* Agent Capacity panel (mobile) */}
            <div className="panel" style={{ margin: '8px 12px' }}>
              <h4 style={{ margin: 0 }}>Agent Capacity</h4>
              <div className="agent-list">
                {agentsState.map((a) => (
                  <div key={a.id || a.agentId} className="agent-item" style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#fff', marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{a.agentId}</div>
                      <div style={{ fontSize: 16 }}>{!a.isFresh ? '🔴' : (a.status === 'idle' ? '🟢' : '🟡')}</div>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{a.hostname} · {(a.roles || []).join(', ')}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <div>CPU: {a.cpuCount ?? '-'}</div>
                      <div>Mem: {a.memoryGb != null ? a.memoryGb.toFixed(1) + ' GB' : '-'}</div>
                      <div>Disk: {a.diskFreeGb != null ? a.diskFreeGb.toFixed(1) + ' GB' : '-'}</div>
                      <div>Load: {a.loadAverage != null ? a.loadAverage : '-'}</div>
                    </div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{timeAgo(a.lastSeen)} · {a.isFresh ? 'fresh' : 'stale'}</div>
                  </div>
                ))}
              </div>
            </div>

        const submittedMsg = { id: uuid('msg-'), author: 'system', text: 'Task Submitted', createdAt: new Date().toISOString() }
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
  useEffect(() => {
    let cancelled = false
    async function poll() {
      if (!chatMode) return
      if (!local || !local.taskId) return
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/results/${encodeURIComponent(local.taskId)}`)
        if (!res.ok) return
        const r = await res.json()
        if (r && r.status && r.status !== 'waiting') {
          const ts = r.updatedAt || r.createdAt || new Date().toISOString()
          const startedMsg = { id: uuid('msg-'), author: 'system', text: 'Runner Started', createdAt: new Date(new Date(ts).getTime() - 50).toISOString() }
          const resultMsg = { id: uuid('msg-'), author: 'result', text: r.summary || JSON.stringify(r), createdAt: ts, data: r }
          const availableMsg = { id: uuid('msg-'), author: 'system', text: 'Runner Result Available', createdAt: new Date(new Date(ts).getTime() + 50).toISOString() }

          setMessages((prev) => {
            const exists = prev.find((m: any) => m.data && m.data.resultId && r.resultId && m.data.resultId === r.resultId)
            if (exists) return prev
            const hadResultBefore = prev.some((m: any) => m.author === 'result')
            const next = [...prev, startedMsg, resultMsg, availableMsg]
            if (hadResultBefore) {
              next.push({ id: uuid('msg-'), author: 'system', text: 'Runner result updated', createdAt: new Date().toISOString() })
            }
            return next
          })

          // persist result into task for visibility, and capture session/run metadata if present
          const updated: any = { ...local, openhandsResponse: r.summary || local.openhandsResponse, messages: [...(local.messages || []), startedMsg, resultMsg, availableMsg] }
          if (r && r.conversationId) updated.conversationId = r.conversationId
          if (r && r.runDirectory) {
            updated.context = updated.context || {}
            updated.context.previousRunDirectory = r.runDirectory
          }
          setLocal(updated)
          try { await onSave(updated) } catch (e) {}

          // Visual indicators: highlight the new result and notify parent
          try {
            const sig = `${r.status || ''}|${(typeof r.summary === 'string' ? r.summary : safeStringify(r.summary || ''))}|${r.updatedAt || r.createdAt || ''}|${r.resultId || ''}|${typeof r.returnCode !== 'undefined' ? String(r.returnCode) : ''}`
            if (typeof onResultSeen === 'function') {
              onResultSeen(local.taskId, sig)
            }
          } catch (e) {}

          setHighlightedResultId(r.resultId || null)
          setHeaderUpdated(true)
          setTimeout(() => setHeaderUpdated(false), 5000)
          setTimeout(() => setHighlightedResultId(null), 3000)
        }
      } catch (e) {}
    }
    if (chatMode && local && local.taskId) {
      poll()
      const iv = setInterval(poll, 10000)
      return () => { cancelled = true; clearInterval(iv) }
    }
  }, [local.taskId, chatMode, onSave, onResultSeen])


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

    // Prepare action object for sending; ensure routing information is present
    const actionForSend = selectedActionObj ? { ...selectedActionObj, payload: Object.assign({}, selectedActionObj.payload || {}) } : null
    if (actionForSend) {
      actionForSend.payload.routing = actionForSend.payload.routing || local.routing || { selectedAgentId: AGENTS[0].id, selectedHostname: AGENTS[0].hostname, selectedRole: AGENTS[0].roles[0] }

      // If this action appears to be a follow-up creation, inject session continuity metadata
      try {
        const actType = (selectedActionObj && selectedActionObj.type) ? String(selectedActionObj.type).toLowerCase() : ''
        const isFollowUpAction = actType.startsWith('follow') || (actionForSend.payload && (actionForSend.payload.followUpTask || actionForSend.payload.createFollowUp || actionForSend.payload.followup || actionForSend.payload.isFollowUp))
        if (isFollowUpAction) {
          // parent/root identifiers
          actionForSend.payload.parentTaskId = local.taskId
          actionForSend.payload.rootTaskId = (local.rootTaskId && local.rootTaskId.length) ? local.rootTaskId : local.taskId
          // inherit conversation id if available
          if (local.conversationId) actionForSend.payload.conversationId = local.conversationId
          // context carries previous task/run directory
          actionForSend.payload.context = actionForSend.payload.context || {}
          actionForSend.payload.context.previousTaskId = local.taskId
          if (local.context && local.context.previousRunDirectory) actionForSend.payload.context.previousRunDirectory = local.context.previousRunDirectory
        }
      } catch (e) {
        // best-effort only; do not block sending
      }
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
    const ok = await sendActionEvent(decision, { editedAction: editedActionCandidateState, newAction: newActionCandidate })
    if (ok && decision === 'approved') {
      const approvedMsg = { id: uuid('msg-'), author: 'system', text: 'Task Approved', createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, approvedMsg])
      const updatedLocal = { ...local, messages: [...(local.messages || []), approvedMsg] }
      setLocal(updatedLocal)
      try { await onSave(updatedLocal) } catch (e) {}
    }
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
          </div>

          <div style={{ marginLeft: 8 }}>
            <span className={`status-pill status-${local.status || 'pending'}`}>{local.status || 'pending'}</span>
          </div>
        </div>


        {/* Recommendation card (advisory only) */}
        <div style={{ margin: '8px 0 12px 0' }}>
          {recommendation && recommendation.agentId ? (
            <div className="recommend-card" style={{ padding: 8, borderRadius: 6, border: '1px solid #e6fffa', background: '#f0fdf4', maxWidth: 420 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{recommendation.agentId}</div>
                <div style={{ fontSize: 13 }}>{recommendation.score}</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{recommendation.hostname}</div>

              {local && local.conversationId ? (
                <div style={{ marginTop: 6 }}>
                  <div className="mode-badge mode-matrix" style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: '#16a34a', color: '#fff' }}>Session Affinity Active</div>
                </div>
              ) : null}

              <div style={{ marginTop: 6 }}>
                {recommendation.reasons.map((r, i) => <div key={i} style={{ fontSize: 13, lineHeight: '1.25' }}>{'\u2713'} {r}</div>)}
              </div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {recommendationApplied ? (
                  <div className="selected-badge">Recommended agent selected</div>
                ) : (
                  <button className="small" onClick={() => {
                    const currentRole = (local && local.routing && (local.routing.selectedRole || local.routing.role)) || selectedRoleForRec
                    update({ routing: { ...(local.routing || {}), selectedAgentId: recommendation.agentId, selectedHostname: recommendation.hostname, selectedRole: currentRole } })
                    setToast({ type: 'success', message: 'Applied recommended agent (local only)' })
                    setTimeout(() => setToast({ type: null, message: null }), 3000)
                  }} style={{ background: '#065f46', color: '#fff', border: 'none' }}>Use Recommended Agent</button>
                )}
              </div>
            </div>
          ) : null}

          {/* If there is an OpenHands conversation associated with this task, and the recommendation differs from the conversation's agent, show a warning */}
          {local && local.conversationId ? (() => {
            const convTask = Array.isArray(tasks) ? tasks.find(t => t.conversationId && t.conversationId === local.conversationId && t.routing && t.routing.selectedAgentId) : null
            const convAgentId = (local && local.routing && local.routing.selectedAgentId) || (convTask && convTask.routing && convTask.routing.selectedAgentId)
            if (convAgentId && recommendation && recommendation.agentId && convAgentId !== recommendation.agentId) {
              return (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6, border: '1px solid #fde68a', background: '#fff7ed', maxWidth: 420 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Conversation vs Recommendation</div>
                  <div className="muted">
                    <div>Conversation is associated with: <strong>{convAgentId}</strong></div>
                    <div>Recommended: <strong>{recommendation.agentId}</strong></div>
                    <div>Reason: load balancing</div>
                  </div>
                </div>
              )
            }
            return null
          })() : null}
        </div>

        <ConversationWorkspace task={local} tasks={tasks} messages={messages} openTask={openTask} />
      </div>
    )
  }

    return (

    <div className="task-detail">
      <h2>{local.title}</h2>
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

      {/* Session chain (read-only) */}
      <div style={{ margin: '8px 0 12px 0' }}>{renderSessionChainCard()}</div>


      {/* brief developer info shown only when requested */}
      {showDev ? (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          <div>Widget ID: {widgetInfo.widgetId || '(none)'}</div>
          <div>Parent URL: {widgetInfo.parentUrl || '(none)'}</div>
          <div>Room ID: {widgetInfo.roomId || '(none)'}</div>
          <div>Capabilities Granted: {widgetInfo.capabilitiesGranted ? 'yes' : 'no'}</div>
          <div style={{ marginTop: 6 }}><strong>Session / Runner</strong></div>
          <div>Root Task: {local.rootTaskId || '(none)'}</div>
          <div>Parent Task: {(local as any).parentTaskId || '(none)'}</div>
          <div>OpenHands Conversation: {(local as any).conversationId || '(none)'}</div>
          <div>Previous Run Directory: {local.context && (local.context as any).previousRunDirectory ? (local.context as any).previousRunDirectory : '(none)'}</div>
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
        <h4>OpenHands output {headerUpdated ? <span className="badge-updated">Updated</span> : null}</h4>
        <pre className={highlightedResultId ? 'result-highlight' : ''}>{local.openhandsResponse}</pre>
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

  // Notification state: unread results and last-seen signatures
  const [unreadResults, setUnreadResults] = useState<Record<string, boolean>>({});
  const lastSeenResultRef = useRef<Record<string, string>>({});

  // Notification Center state (local UI-only persistence)
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const raw = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem('taskboard-notifications') : null
      return raw ? JSON.parse(raw) : []
    } catch (e) { return [] }
  })

  const prevAgentsRef = useRef<Record<string, boolean>>({})
  const prevTasksRef = useRef<Record<string, boolean>>({})

  function persistNotifications(notifs: Notification[]) {
    try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('taskboard-notifications', JSON.stringify(notifs)) } catch (e) {}
  }

  function addNotificationIfMissing(n: Notification) {
    setNotifications(prev => {
      if (prev.find(x => x.id === n.id)) return prev
      const next = [n, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      persistNotifications(next)
      return next
    })
  }

  useEffect(() => {
    // Generate notifications from tasks and agents whenever these change
    const existingIds = new Set((notifications || []).map(n => n.id))
    const newNotifs: Notification[] = []
    const nowIso = new Date().toISOString()

    // Tasks-derived notifications
    for (const t of (tasks || [])) {
      try {
        const msgs = Array.isArray(t.messages) ? t.messages : []

        // Task created: synthesize if we haven't seen this task before
        const taskCreatedId = `task_created:${t.taskId}`
        if (!prevTasksRef.current[t.taskId]) {
          if (!existingIds.has(taskCreatedId)) {
            const createdAt = (t as any).createdAt || t.updatedAt || (msgs[0] && msgs[0].createdAt) || nowIso
            newNotifs.push({ id: taskCreatedId, taskId: t.taskId, type: 'task_created', title: 'Task created', message: t.title || '', createdAt, read: selected === t.taskId })
            existingIds.add(taskCreatedId)
          }
          prevTasksRef.current[t.taskId] = true
        }

        // Reviewer approved
        if (t.status === 'approved') {
          const id = `reviewer_approved:${t.taskId}`
          if (!existingIds.has(id)) {
            newNotifs.push({ id, taskId: t.taskId, type: 'reviewer_approved', title: 'Reviewer approved', message: t.reviewerSummary || '', createdAt: t.updatedAt || nowIso, read: selected === t.taskId })
            existingIds.add(id)
          }
        }

        for (const m of msgs) {
          if (!m) continue
          const author = m.author || ''

          // Result updated
          const isResult = author === 'result' || author === 'openhands' || (m.data && m.data._runner_marker)
          if (isResult) {
            const id = `result_updated:${t.taskId}:${m.id || m.createdAt || Math.random().toString(36).slice(2, 8)}`
            if (!existingIds.has(id)) {
              newNotifs.push({ id, taskId: t.taskId, type: 'result_updated', title: 'Result updated', message: (m.text || '').slice(0, 200), createdAt: m.createdAt || t.updatedAt || nowIso, read: selected === t.taskId })
              existingIds.add(id)
            }
          }

          // Follow-up created
          const isFollowUp = (author === 'follow_up') || (m.data && m.data.followUpTask) || (typeof m.text === 'string' && /follow-?up task created/i.test(String(m.text)))
          if (isFollowUp) {
            const followUpId = (m.data && m.data.followUpTask && m.data.followUpTask.taskId) ? m.data.followUpTask.taskId : (m.id || m.createdAt)
            const id = `follow_up:${t.taskId}:${followUpId}`
            if (!existingIds.has(id)) {
              const msgText = (m.data && m.data.followUpTask && m.data.followUpTask.title) ? `Follow-up: ${(m.data.followUpTask.title)}` : (m.text || '')
              newNotifs.push({ id, taskId: t.taskId, type: 'follow_up_created', title: 'Follow-up task created', message: msgText, createdAt: m.createdAt || t.updatedAt || nowIso, read: selected === t.taskId })
              existingIds.add(id)
            }
          }

          // 2nd opinion added
          if (author === 'second_opinion') {
            const id = `opinion:${t.taskId}:${m.id || m.createdAt}`
            if (!existingIds.has(id)) {
              newNotifs.push({ id, taskId: t.taskId, type: 'opinion_added', title: '2nd opinion added', message: (m.text || ''), createdAt: m.createdAt || t.updatedAt || nowIso, read: selected === t.taskId })
              existingIds.add(id)
            }
          }
        }
      } catch (e) {
        // ignore per-task errors
      }
    }

    // Agent stale detection: fire notification when an agent transitions from fresh->stale
    for (const a of (agentsState || [])) {
      const prevFresh = prevAgentsRef.current[a.agentId]
      const isFresh = !!a.isFresh
      const id = `agent_stale:${a.agentId}:${a.lastSeen || nowIso}`
      if (prevFresh === undefined) {
        prevAgentsRef.current[a.agentId] = isFresh
      } else if (prevFresh && !isFresh) {
        if (!existingIds.has(id)) {
          newNotifs.push({ id, taskId: '', type: 'agent_stale', title: 'Agent became stale', message: `${a.agentId} is stale`, createdAt: a.lastSeen || nowIso, read: false })
          existingIds.add(id)
        }
        prevAgentsRef.current[a.agentId] = isFresh
      } else {
        prevAgentsRef.current[a.agentId] = isFresh
      }
    }

    if (newNotifs.length > 0) {
      setNotifications(prev => {
        const merged = [...newNotifs, ...prev].sort((A, B) => B.createdAt.localeCompare(A.createdAt))
        persistNotifications(merged)
        return merged
      })
    }
  }, [tasks, agentsState, selected])

  // Mark notifications for a task as read when the thread is opened
  useEffect(() => {
    if (!selected) return
    setNotifications(prev => {
      const next = (prev || []).map(n => (n.taskId === selected ? { ...n, read: true } : n))
      persistNotifications(next)
      return next
    })
    setUnreadResults(prev => ({ ...(prev || {}), [selected]: false }))
  }, [selected])

  function handleNotificationClick(n: Notification) {
    if (n.taskId) setSelected(n.taskId)
    setNotifications(prev => {
      const next = (prev || []).map(x => x.id === n.id ? { ...x, read: true } : x)
      persistNotifications(next)
      return next
    })
    if (n.taskId) setUnreadResults(prev => ({ ...(prev || {}), [n.taskId]: false }))
  }


  function computeResultSignature(r: any) {
    if (!r) return ''
    const status = r.status || ''
    const summary = (typeof r.summary === 'string') ? r.summary : safeStringify(r.summary || '')
    const updatedAt = r.updatedAt || r.createdAt || ''
    const resultId = r.resultId || r.id || ''
    const returnCode = (typeof r.returnCode === 'number' || typeof r.returnCode === 'string') ? String(r.returnCode) : ''
    return `${status}|${summary}|${updatedAt}|${resultId}|${returnCode}`
  }

  function computeSignatureFromTask(t: any) {
    if (!t) return ''
    let r = null
    if (Array.isArray(t.messages)) {
      for (let i = t.messages.length - 1; i >= 0; i--) {
        const m = t.messages[i]
        if (m && m.author === 'result' && m.data) { r = m.data; break }
        if (m && m.author === 'result' && (m.text || m.createdAt)) { r = { summary: m.text, updatedAt: m.createdAt }; break }
      }
    }
    if (!r) {
      if (t.openhandsResponse) r = { summary: t.openhandsResponse, updatedAt: t.updatedAt || '' }
      else r = null
    }
    return computeResultSignature(r)
  }




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
      // session continuity: new root tasks default rootTaskId to their own id
      rootTaskId: id,
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
      // initialize lastSeen signatures for notification tracking
      try {
        const sigs: Record<string, string> = {}
        for (const t of data) {
          sigs[t.taskId] = computeSignatureFromTask(t)
        }
        lastSeenResultRef.current = sigs
        setUnreadResults({})
      } catch (e) {}
      if (!selected && data.length > 0) setSelected(data[0].taskId)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  // Background poll for results across all tasks to surface unread badges
  useEffect(() => {
    let iv: any = null
    let cancelled = false
    async function pollAllResults() {
      if (!tasks || tasks.length === 0) return
      for (const t of tasks) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}api/results/${encodeURIComponent(t.taskId)}`)
          if (!res.ok) continue
          const r = await res.json()
          const sig = computeResultSignature(r)
          const last = lastSeenResultRef.current[t.taskId] || ''
          if (!last) { lastSeenResultRef.current[t.taskId] = sig; continue }
          if (sig !== last) {
            lastSeenResultRef.current[t.taskId] = sig
            if (selected === t.taskId) {
              // thread is open — mark read locally
              setUnreadResults(prev => {
                if (!prev[t.taskId]) return prev
                const copy = { ...prev }
                copy[t.taskId] = false
                return copy
              })
            } else {
              // mark as unread in inbox
              setUnreadResults(prev => ({ ...prev, [t.taskId]: true }))
            }
          }
        } catch (e) {
          // ignore per-task error
        }
        if (cancelled) break
      }
    }
    pollAllResults()
    iv = setInterval(pollAllResults, 10000)
    return () => { cancelled = true; if (iv) clearInterval(iv) }
  }, [tasks, selected])


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

  // Agent Queue grouping logic
  const runningStates = new Set(['running', 'submitted'])
  const queuedStates = new Set(['pending_review', 'approved'])
  const completedStates = new Set(['completed', 'dry_run_completed', 'executed', 'prepared'])
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({})
  function toggleAgentExpand(id: string) {
    setExpandedAgents(prev => ({ ...(prev || {}), [id]: !prev?.[id] }))
  }

  const groups: Record<string, { agent: Agent | null; tasks: Task[]; runningCount: number; queuedCount: number; completedCount: number; otherCount: number }> = {}
  for (const a of (agentsState || [])) {
    groups[a.agentId] = { agent: a, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }
  }
  groups['__unassigned__'] = groups['__unassigned__'] || { agent: null, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }

  for (const t of (tasks || [])) {
    try {
      const aid = (t && t.routing && (t.routing.selectedAgentId || t.routing.selectedAgentId)) || '__unassigned__'
      if (!groups[aid]) groups[aid] = { agent: null, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }
      groups[aid].tasks.push(t)
      const s = (t && t.status) ? t.status : ''
      if (runningStates.has(s)) groups[aid].runningCount++
      else if (queuedStates.has(s)) groups[aid].queuedCount++
      else if (completedStates.has(s)) groups[aid].completedCount++
      else groups[aid].otherCount++
    } catch (e) {}
  }

  const agentOrder = (agentsState || []).map(a => a.agentId).concat(['__unassigned__'])




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
            <div style={{ padding: '8px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>🔔 Notifications</h3>
                <div className="selected-badge" style={{ background: '#ef4444' }}>{(notifications || []).filter(n => !n.read).length || 0}</div>
              </div>
              <div style={{ maxHeight: 140, overflow: 'auto', marginTop: 8 }}>
                {(notifications || []).length === 0 ? (
                  <div className="muted">No notifications</div>
                ) : (
                  (notifications || []).slice(0, 5).map(n => (
                    <div key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => handleNotificationClick(n)} style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#fff', marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>{n.title}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{timeAgo(n.createdAt)}</div>
                      </div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{n.message}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="threads-list">
              <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Active Tasks</h3>
                <button className="small" onClick={() => { createNewTask(); }} style={{ padding: '6px 10px' }}>+ New Task</button>
              </div>
              {tasks.filter((t) => t.status !== 'completed').map((t) => (
                <div key={t.taskId} className={'thread-item' + (selected === t.taskId ? ' selected' : '')} onClick={() => setSelected(t.taskId)}>
                  <TaskCard t={t} onClick={() => setSelected(t.taskId)} hasNewResult={!!unreadResults[t.taskId]} />
                </div>
              ))}

              <div className="panel" style={{ margin: '8px 12px' }}>
                <h4 style={{ margin: 0 }}>Agent Queue</h4>
                <div className="agent-queue">
                  {agentOrder.map((aid) => {
                    const g = groups[aid]; if (!g) return null
                    const a = g.agent
                    const label = a ? a.agentId : 'Unassigned'
                    return (
                      <div key={aid} className="agent-item" style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#fff', marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: 700 }}>{label}</div>
                          <div style={{ fontSize: 14 }}>{a ? (a.isFresh ? '🟢' : '🔴') : ''}</div>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>{a ? `${a.hostname} · ${(a.roles || []).join(', ')}` : ''}</div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                          <div>Running: {g.runningCount}</div>
                          <div>Queued: {g.queuedCount}</div>
                          <div>Completed: {g.completedCount}</div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <button className="small" onClick={() => toggleAgentExpand(aid)}>{expandedAgents[aid] ? 'Collapse' : 'Expand'}</button>
                        </div>
                        {expandedAgents[aid] ? (
                          <div style={{ marginTop: 8 }}>
                            {(g.tasks || []).slice(0, 50).map(t => (
                              <div key={t.taskId} onClick={() => setSelected(t.taskId)} style={{ padding: '6px 0', cursor: 'pointer' }}>
                                <div style={{ fontWeight: 600 }}>{t.taskId} {t.title ? `— ${t.title}` : ''}</div>
                                <div className="muted">{t.status}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>


              <div style={{ padding: '8px 12px', marginTop: 8 }}>
                <h3 style={{ margin: 0 }}>Recent Tasks</h3>
              </div>

              {tasks.filter((t) => t.status === 'completed').slice(0, 10).map((t) => (
                <div key={t.taskId} onClick={() => setSelected(t.taskId)}>
                  <TaskCard t={t} onClick={() => setSelected(t.taskId)} hasNewResult={!!unreadResults[t.taskId]} />
                </div>
              ))}
            </div>
            {/* Agent Capacity panel (mobile) */}
            <div className="panel" style={{ margin: '8px 12px' }}>
              <h4 style={{ margin: 0 }}>Agent Capacity</h4>
              <div className="agent-list">
                {agentsState.map((a) => (
                  <div key={a.id || a.agentId} className="agent-item" style={{ padding: 8, borderRadius: 6, border: '1px solid #f1f5f9', background: '#fff', marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{a.agentId}</div>
                      <div style={{ fontSize: 16 }}>{!a.isFresh ? '🔴' : (a.status === 'idle' ? '🟢' : '🟡')}</div>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{a.hostname} · {(a.roles || []).join(', ')}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <div>CPU: {a.cpuCount ?? '-'}</div>
                      <div>Mem: {a.memoryGb != null ? a.memoryGb.toFixed(1) + ' GB' : '-'}</div>
                      <div>Disk: {a.diskFreeGb != null ? a.diskFreeGb.toFixed(1) + ' GB' : '-'}</div>
                      <div>Load: {a.loadAverage != null ? a.loadAverage : '-'}</div>
                    </div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{timeAgo(a.lastSeen)} · {a.isFresh ? 'fresh' : 'stale'}</div>
                  </div>
                ))}
              </div>
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
                  agents={agentsState}
                  tasks={tasks}

                  onResultSeen={(taskId: string, signature: string) => {
                    lastSeenResultRef.current = { ...lastSeenResultRef.current, [taskId]: signature }
                    try { localStorage.setItem('taskboard-last-seen', JSON.stringify(lastSeenResultRef.current)) } catch (e) {}
                    setUnreadResults((prev) => ({ ...(prev || {}), [taskId]: false }))
                    setNotifications(prev => {
                      const next = (prev || []).map(n => n.taskId === taskId ? { ...n, read: true } : n)
                      persistNotifications(next)
                      return next
                    })
                  }}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="card-title" style={{ flex: 1 }}>{t.title}</div>
                      {unreadResults[t.taskId] ? <div className="badge-new">New</div> : null}
                    </div>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="card-title" style={{ flex: 1 }}>{t.title}</div>
                      {unreadResults[t.taskId] ? <div className="badge-new">New</div> : null}
                    </div>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="card-title" style={{ flex: 1 }}>{t.title}</div>
                      {unreadResults[t.taskId] ? <div className="badge-new">New</div> : null}
                    </div>
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
                  chatMode={isChatView && isMobileApp}
                  tasks={tasks}

                  openTask={(id: string) => setSelected(id)}
                  agents={agentsState}
                  onResultSeen={(taskId: string, signature: string) => {
                    lastSeenResultRef.current = { ...lastSeenResultRef.current, [taskId]: signature }
                    try { localStorage.setItem('taskboard-last-seen', JSON.stringify(lastSeenResultRef.current)) } catch (e) {}
                    setUnreadResults((prev) => ({ ...(prev || {}), [taskId]: false }))
                    setNotifications(prev => {
                      const next = (prev || []).map(n => n.taskId === taskId ? { ...n, read: true } : n)
                      persistNotifications(next)
                      return next
                    })
                  }}
                />
              ) : (
                <div>Select a task to view details</div>
              )}
            </div>
            <div className="sidebar">
              <div className="sidebar-section">
                <div className="section-header"><h3>🔔 Notifications <span className="muted" style={{ fontSize: 12 }}> {(notifications || []).filter(n => !n.read).length || 0} unread</span></h3></div>
                <div className="section-list">
                  {(notifications || []).length === 0 ? (
                    <div className="muted">No notifications</div>
                  ) : (
                    (notifications || []).slice(0, 8).map(n => (
                      <div key={n.id} className="card" style={{ padding: 8, cursor: 'pointer', borderLeft: n.read ? '4px solid transparent' : '4px solid #ef4444' }} onClick={() => handleNotificationClick(n)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: 700 }}>{n.title}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{timeAgo(n.createdAt)}</div>
                        </div>
                        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{n.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="sidebar-section">
                <div className="section-header"><h3>Agent Capacity</h3></div>
                <div className="section-list">
                  {agentsState.map((a) => (
                    <div key={a.id || a.agentId} className="card" style={{ padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 700 }}>{a.agentId}</div>
                        <div style={{ fontSize: 14 }}>{!a.isFresh ? '\ud83d\udd34' : (a.status === 'idle' ? '\ud83d\udfe2' : '\ud83d\udfe1')}</div>
                      </div>
                      <div className="muted">{a.hostname} \u00b7 {(a.roles || []).join(', ')}</div>
                      <div style={{ display:'flex', gap:8, marginTop:6, fontSize:13 }}>
                        <div>CPU: {a.cpuCount ?? '-'}</div>
                        <div>Mem: {a.memoryGb != null ? a.memoryGb.toFixed(1) + ' GB' : '-'}</div>
                        <div>Disk: {a.diskFreeGb != null ? a.diskFreeGb.toFixed(1) + ' GB' : '-'}</div>
                        <div>Load: {a.loadAverage != null ? a.loadAverage : '-'}</div>
                      </div>
                      <div className='muted' style={{ marginTop:6, fontSize:12 }}>Last: {timeAgo(a.lastSeen)} \u00b7 {a.isFresh ? 'fresh' : 'stale'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  )
}
