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

  // Start Engineering modal state
  const [showStartModal, setShowStartModal] = useState(false)
  const [startEngineerId, setStartEngineerId] = useState<string | null>(null)
  const [startObjective, setStartObjective] = useState('')
  const [startSessionType, setStartSessionType] = useState('conversation')
  const [startConversationMode, setStartConversationMode] = useState('new')
  const [startContinueConversationId, setStartContinueConversationId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Helpers
  function uuid(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  function generateTaskId(preferPwa = true) {
    const now = new Date();
    const pad = (n: any, l = 2) => String(n).padStart(l, '0');
    if (preferPwa) {
      const y = now.getFullYear();
      const m = pad(now.getMonth() + 1);
      const d = pad(now.getDate());
      const hh = pad(now.getHours());
      const mm = pad(now.getMinutes());
      const ss = pad(now.getSeconds());
      return `PWA-${y}${m}${d}-${hh}${mm}${ss}`
    }
    return `TASK-${now.getTime()}`
  }

  function deriveFriendlyProfile(agent: any) {
    const id = (agent && (agent.agentId || agent.id)) || ''
    const lower = id.toLowerCase()
    const profile: any = { name: id, role: (agent.roles && agent.roles[0]) || 'Engineer', description: agent.hostname || '', emoji: '👩\u200D\uD83D\uDCBB' }
    if (lower.includes('ofbiz') || lower.includes('openhands-ofbiz')) {
      profile.name = 'Forge'
      profile.role = 'Senior OFBiz Engineer'
      profile.description = 'Optimized for enterprise ERP development.'
      profile.emoji = '⚙'
    } else if (lower.includes('java')) {
      profile.name = 'Atlas'
      profile.role = 'Platform Engineer'
      profile.description = 'Platform and core services expert.'
      profile.emoji = '🏛'
    } else if (lower.includes('integration')) {
      profile.name = 'Hermes'
      profile.role = 'Integration Engineer'
      profile.description = 'Systems integrator and connectors.'
      profile.emoji = '🛰'
    } else if (lower.includes('security')) {
      profile.name = 'Sentinel'
      profile.role = 'Security Engineer'
      profile.description = 'Security and hardening expert.'
      profile.emoji = '🛡'
    } else if (lower.includes('doc') || lower.includes('scribe') || lower.includes('docs')) {
      profile.name = 'Scribe'
      profile.role = 'Documentation Engineer'
      profile.description = 'Documentation and runbooks specialist.'
      profile.emoji = '✍'
    } else if (agent && agent.hostname) {
      profile.name = id || agent.hostname
      profile.description = `Host: ${agent.hostname}`
    }
    return profile
  }

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
        <div style={{ padding: 12 }}>
          <button className="big" onClick={() => { setShowStartModal(true); setStartEngineerId(agents && agents[0] ? agents[0].id : null) }} style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, fontSize: 16 }}>＋ Start Engineering</button>
          <h2 style={{ marginTop: 12 }}>Engineering Sessions</h2>
        </div>
        <ConversationList tasks={tasks} selectedId={selectedTask ? selectedTask.taskId : undefined} onSelect={(id) => setSelectedId(id)} />
      </div>

      {/* Start Engineering modal */}
      {showStartModal ? (
        <div className="modal-overlay" onClick={() => setShowStartModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Start Engineering</h3>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{agents ? `${agents.length} engineers` : ''}</div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <div style={{ flex: '0 0 320px' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Choose Primary Engineer</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
                  {Array.isArray(agents) && agents.length ? agents.map((a: any) => {
                    const p = deriveFriendlyProfile(a)
                    const isSelected = startEngineerId === a.id
                    const status = a.status || (a && a.isFresh === false ? 'offline' : 'unknown')
                    return (
                      <div key={a.id} onClick={() => setStartEngineerId(a.id)} style={{ padding: 10, borderRadius: 8, border: isSelected ? '2px solid #3b82f6' : '1px solid #e6eefc', background: '#fff', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div style={{ width: 40, height: 40, borderRadius: 999, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{p.emoji}</div>
                            <div>
                              <div style={{ fontWeight: 700 }}>{p.name}</div>
                              <div style={{ fontSize: 13, color: '#6b7280' }}>{p.role}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', fontSize: 12 }}>
                            <div style={{ fontWeight: 700 }}>{status}</div>
                            <div style={{ color: '#6b7280', fontSize: 12 }}>{a.agentId || a.id}</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>{p.description}</div>
                      </div>
                    )
                  }) : (<div>No agents available</div>)}
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Engineering Objective</div>
                <textarea value={startObjective} onChange={(e) => setStartObjective(e.target.value)} placeholder="Describe the objective or task you want to start" style={{ width: '100%', minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid #e6eefc', marginBottom: 12 }} />

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 800 }}>Session Type</div>
                  <div style={{ display: 'flex', gap: 8, marginLeft: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" name="stype" checked={startSessionType === 'conversation'} onChange={() => setStartSessionType('conversation')} /> Conversation First</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" name="stype" checked={startSessionType === 'review'} onChange={() => setStartSessionType('review')} /> Create Review Decision</label>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Conversation</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" name="cmode" checked={startConversationMode === 'new'} onChange={() => setStartConversationMode('new')} /> Start New Conversation</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" name="cmode" checked={startConversationMode === 'continue'} onChange={() => setStartConversationMode('continue')} /> Continue Existing</label>
                  </div>

                  {startConversationMode === 'continue' ? (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>Choose an existing conversation from this engineer</div>
                      <select value={startContinueConversationId || ''} onChange={(e) => setStartContinueConversationId(e.target.value || null)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e6eefc' }}>
                        <option value="">-- choose --</option>
                        {tasks.filter((t) => t && t.routing && t.routing.selectedAgentId === startEngineerId && t.conversationId).map((t) => (
                          <option key={t.taskId} value={t.conversationId}>{t.title || t.taskId} · {t.conversationId}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="small" onClick={() => setShowStartModal(false)}>Cancel</button>
                  <button className="big" onClick={async () => {
                    // create new task and set routing
                    const chosen = agents && agents.find((a: any) => a.id === startEngineerId) || (agents && agents[0])
                    const taskId = generateTaskId(true)
                    const title = startObjective && startObjective.trim().length ? (startObjective.trim().split(/\n/)[0].slice(0, 120)) : `New engineering session`
                    const newTask: any = {
                      taskId,
                      title,
                      status: 'pending_review',
                      openhandsResponse: '',
                      reviewerSummary: '',
                      proposedActions: [],
                      selectedAction: null,
                      notes: '',
                      rootTaskId: taskId,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      routing: chosen ? { selectedAgentId: chosen.id, selectedHostname: chosen.hostname, selectedRole: (chosen.roles && chosen.roles[0]) } : {},
                      messages: []
                    }

                    // add the objective as the first user message if present
                    if (startObjective && startObjective.trim()) {
                      newTask.messages.push({ id: uuid('msg-'), author: 'user', text: startObjective.trim(), createdAt: new Date().toISOString() })
                    }

                    try {
                      await handleTaskUpdate(newTask)
                      setSelectedId(taskId)
                      setShowStartModal(false)
                      const pname = deriveFriendlyProfile(chosen).name
                      setSuccessMessage(`Engineering session started with ${pname}.`)
                      setTimeout(() => setSuccessMessage(null), 4000)
                    } catch (e) {
                      console.error('start session error', e)
                    }

                    // reset modal state
                    setStartEngineerId(null)
                    setStartObjective('')
                    setStartSessionType('conversation')
                    setStartConversationMode('new')
                    setStartContinueConversationId(null)
                  }} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Start Engineering</button>
                </div>

              </div>
            </div>

          </div>
        </div>
      ) : null}


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
          {successMessage ? (
            <div style={{ padding: 8, background: '#ecfdf5', color: '#065f46', borderRadius: 8, marginBottom: 8 }}>{successMessage}</div>
          ) : null}
          <LifecycleRibbon task={selectedTask} />
        </div>

        <div style={{ flex: 1 }}>
          <ConversationPanel task={selectedTask} followups={followups} onTaskUpdate={handleTaskUpdate} onRefresh={async () => {
            try {
              const t = await fetchTasks()
              setTasks(Array.isArray(t) ? t : [])
            } catch (e) { console.error('refresh tasks error', e) }
          }} />
        </div>
      </div>

      <div style={{ width: 320, overflow: 'auto', padding: 12 }}>
        <h3>Operations</h3>
        <OperationsPanel runnerStatus={runnerStatus} agents={agents} />
      </div>
    </div>
  )
}
