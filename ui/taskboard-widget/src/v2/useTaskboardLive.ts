import { useEffect, useState } from 'react'
import { fetchTasks, fetchFollowups, fetchRunnerStatus, fetchAgents } from './api'
import connectExecutionStream from './stream'

export default function useTaskboardLive() {
  const [tasks, setTasks] = useState<any[]>([])
  const [followups, setFollowups] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [runnerStatus, setRunnerStatus] = useState<any>(null)
  const [isPolling, setIsPolling] = useState<boolean>(false)
  const [pollTimedOut, setPollTimedOut] = useState<boolean>(false)
  const [streamConnected, setStreamConnected] = useState<boolean>(false)
  const [streamError, setStreamError] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    let pollCancelled = false
    let streamConn: any = null
    let connectTimer: any = null
    const intervalMs = 10000

    async function doRefresh() {
      try {
        const t = await fetchTasks().catch(() => null)
        if (!cancelled && t && Array.isArray(t)) setTasks(t)
        const f = await fetchFollowups().catch(() => null)
        if (!cancelled && f && Array.isArray(f)) setFollowups(f)
        const a = await fetchAgents().catch(() => null)
        if (!cancelled && a) setAgents(Array.isArray(a) ? a : (Array.isArray(a.agents) ? a.agents : []))
        const r = await fetchRunnerStatus().catch(() => null)
        if (!cancelled && r) setRunnerStatus(r)
        setPollTimedOut(false)
      } catch (e) {
        // ignore
      }
    }

    async function doPoll() {
      if (pollCancelled) return
      try {
        await doRefresh()
      } catch (e) {}
      if (!pollCancelled) setTimeout(doPoll, intervalMs)
    }

    function startPolling() {
      try { setIsPolling(true) } catch (e) {}
      pollCancelled = false
      doPoll()
    }

    function handleStreamEvent(obj: any) {
      if (!obj) return
      try {
        const ttype = obj.type || obj.event || null

        // Full tasks array
        if (ttype === 'tasks' || Array.isArray(obj.tasks) || Array.isArray(obj.payload) && obj.payload.length) {
          const payload = obj.tasks || obj.payload || obj
          const list = Array.isArray(payload) ? payload : (Array.isArray(payload.tasks) ? payload.tasks : [])
          if (list && Array.isArray(list)) {
            setTasks(list)
          }
          return
        }

        // Single task update
        if (ttype === 'task' || obj.task || obj.taskId || (obj.payload && obj.payload && obj.payload.taskId)) {
          const updated = obj.payload || obj.task || obj
          if (!updated) return
          setTasks((prev: any[]) => {
            try {
              if (!updated.taskId) {
                // If payload is an array, replace
                if (Array.isArray(updated)) return updated
                return prev
              }
              const idx = prev.findIndex((p: any) => p && p.taskId === updated.taskId)
              if (idx >= 0) {
                const merged = Object.assign({}, prev[idx] || {}, updated || {})
                const next = prev.slice()
                next[idx] = merged
                return next
              }
              // new task - prepend
              return [updated].concat(prev || [])
            } catch (e) { return prev }
          })
          return
        }

        // Followups
        if (ttype === 'followups' || obj.followups) {
          const payload = obj.payload || obj.followups || obj
          const list = Array.isArray(payload) ? payload : (Array.isArray(payload.followups) ? payload.followups : [])
          if (list) setFollowups(list)
          return
        }

        // Agents
        if (ttype === 'agents' || obj.agents) {
          const payload = obj.payload || obj.agents || obj
          const list = Array.isArray(payload) ? payload : (Array.isArray(payload.agents) ? payload.agents : [])
          if (list) setAgents(list)
          return
        }

        // Runner
        if (ttype === 'runner' || obj.runner) {
          const payload = obj.payload || obj.runner || obj
          setRunnerStatus(payload)
          return
        }

        // Log streaming events: { stream: 'stdout'|'stderr', data: '...', taskId }
        if (ttype === 'log' || obj.stream || obj.data) {
          const streamName = obj.stream || obj.logType || 'stdout'
          const chunk = obj.data || obj.line || ''
          const taskId = obj.taskId || (obj.payload && obj.payload.taskId) || null
          if (!taskId) return
          setTasks((prev: any[]) => {
            try {
              const copy = JSON.parse(JSON.stringify(prev || []))
              const idx = copy.findIndex((t: any) => t && t.taskId === taskId)
              if (idx >= 0) {
                const t = copy[idx] || {}
                const exec = t.executionReport || t.execution || t.execution_report || {}
                t.executionReport = exec
                if (streamName === 'stderr') exec.stderr = (exec.stderr || '') + String(chunk)
                else exec.stdout = (exec.stdout || '') + String(chunk)
                copy[idx] = t
              }
              return copy
            } catch (e) { return prev }
          })
          return
        }

      } catch (e) {
        // ignore malformed
      }
    }

    try {
      const conn = connectExecutionStream(undefined, {
        onOpen: () => {
          if (cancelled) return
          setStreamConnected(true)
          setIsPolling(false)
          setPollTimedOut(false)
          try { if (connectTimer) { clearTimeout(connectTimer); connectTimer = null } } catch (e) {}
        },
        onEvent: (evt) => { if (cancelled) return; handleStreamEvent(evt) },
        onError: (err) => {
          if (cancelled) return
          setStreamError(err)
          setStreamConnected(false)
          try { if (streamConn && streamConn.close) streamConn.close() } catch (e) {}
          streamConn = null
          startPolling()
        },
        onClose: () => {
          if (cancelled) return
          setStreamConnected(false)
          startPolling()
        }
      })

      streamConn = conn
      // If stream not established quickly, fallback to polling
      connectTimer = setTimeout(() => {
        if (!streamConn) return
        if (!streamConnected) {
          try { streamConn && streamConn.close && streamConn.close() } catch (e) {}
          streamConn = null
          startPolling()
        }
      }, 2500)

      // ensure we have an initial snapshot while trying stream
      doRefresh()

      if (!streamConn) startPolling()
    } catch (e) {
      // fallback to polling
      doRefresh()
      startPolling()
    }

    return () => {
      cancelled = true
      pollCancelled = true
      try { setIsPolling(false); setPollTimedOut(false); setStreamConnected(false) } catch (e) {}
      try { if (streamConn && streamConn.close) streamConn.close() } catch (e) {}
      try { if (connectTimer) clearTimeout(connectTimer) } catch (e) {}
    }
  }, [])

  async function doRefreshOnce() {
    try {
      const t = await fetchTasks().catch(() => null)
      if (t && Array.isArray(t)) setTasks(t)
      const f = await fetchFollowups().catch(() => null)
      if (f && Array.isArray(f)) setFollowups(f)
      const a = await fetchAgents().catch(() => null)
      if (a) setAgents(Array.isArray(a) ? a : (Array.isArray(a.agents) ? a.agents : []))
      const r = await fetchRunnerStatus().catch(() => null)
      if (r) setRunnerStatus(r)
      setPollTimedOut(false)
    } catch (e) {}
  }

  return { tasks, setTasks, followups, setFollowups, agents, setAgents, runnerStatus, setRunnerStatus, isPolling, pollTimedOut, streamConnected, streamError, doRefresh: doRefreshOnce }
}
