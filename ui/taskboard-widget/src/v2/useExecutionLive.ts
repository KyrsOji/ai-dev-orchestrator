import { useEffect, useState } from 'react'
import { fetchTasks, fetchAgents, fetchRunnerStatus } from './api'
import connectExecutionStream from './stream'

export default function useExecutionLive(task: any) {
  const [live, setLive] = useState<any>(task)
  const [agents, setAgents] = useState<any>(null)
  const [runnerStub, setRunnerStub] = useState<any>(null)
  const [isPolling, setIsPolling] = useState<boolean>(false)
  const [pollTimedOut, setPollTimedOut] = useState<boolean>(false)
  const [streamConnected, setStreamConnected] = useState<boolean>(false)
  const [streamError, setStreamError] = useState<any>(null)

  useEffect(() => { setLive(task) }, [task && task.taskId, task && task.updatedAt])

  useEffect(() => {
    if (!task || !task.taskId) {
      // no task: fetch agents/runner as a one-off
      let cancelled = false
      fetchAgents().then((a) => { if (!cancelled) setAgents(a) }).catch(() => {})
      fetchRunnerStatus().then((r) => { if (!cancelled) setRunnerStub(r) }).catch(() => {})
      return () => { cancelled = true }
    }

    let cancelled = false
    let pollCancelled = false
    let streamConn: any = null
    let connectTimer: any = null

    const intervalMs = 2000
    const timeoutMs = 90000
    const start = Date.now()
    setPollTimedOut(false)
    setStreamError(null)

    function shouldContinuePolling(t: any) {
      if (!t) return false
      const s = String((t.status || '')).toLowerCase()
      if (t.dispatched) return true
      if (s === 'running' || s === 'dispatched' || s === 'queued' || s === 'pending_review' || s === 'reviewing') return true
      return false
    }

    async function doPoll() {
      let updated: any = null
      try {
        if (pollCancelled) return
        const tasks = await fetchTasks().catch(() => null)
        if (tasks && Array.isArray(tasks)) {
          updated = tasks.find((x: any) => x && x.taskId === task.taskId)
          if (updated) setLive(updated)
        }
        const ag = await fetchAgents().catch(() => null)
        if (ag) setAgents(ag)
        const r = await fetchRunnerStatus().catch(() => null)
        if (r) setRunnerStub(r)
      } catch (e) {
        // ignore
      }

      const elapsed = Date.now() - start
      const current = updated || live || task

      if (!pollCancelled && elapsed < timeoutMs && shouldContinuePolling(current)) {
        setTimeout(doPoll, intervalMs)
      } else {
        setIsPolling(false)
        if (!pollCancelled && elapsed >= timeoutMs) {
          const execNow = current && (current.executionReport || current.execution || current.execution_report)
          if (!execNow) setPollTimedOut(true)
        }
      }
    }

    function startPolling() {
      // avoid double-start
      try { setIsPolling(true) } catch (e) {}
      pollCancelled = false
      doPoll()
    }

    function handleStreamEvent(obj: any) {
      if (!obj) return
      try {
        const ttype = obj.type || obj.event || null
        // If this is a task payload or contains a taskId, merge into live
        if (ttype === 'task' || obj.task || obj.taskId || (obj.payload && obj.payload.taskId)) {
          const updated = obj.payload || obj.task || obj
          // ensure matching taskId if present
          if (!updated || !updated.taskId || String(updated.taskId) === String(task.taskId)) {
            setLive((prev: any) => {
              try {
                // shallow merge
                const merged = Object.assign({}, prev || {}, updated || {})
                return merged
              } catch (e) { return updated }
            })
          }
          return
        }

        if (ttype === 'agents' || obj.agents) {
          const payload = obj.payload || obj.agents || obj
          setAgents(payload)
          return
        }

        if (ttype === 'runner' || obj.runner) {
          const payload = obj.payload || obj.runner || obj
          setRunnerStub(payload)
          return
        }

        // log streaming events: { stream: 'stdout'|'stderr', data: '...' }
        if (ttype === 'log' || obj.stream || obj.data) {
          const streamName = obj.stream || (obj.logType) || 'stdout'
          const chunk = obj.data || obj.line || ''
          setLive((prev: any) => {
            try {
              const copy = JSON.parse(JSON.stringify(prev || {}))
              const exec = copy.executionReport || copy.execution || copy.execution_report || {}
              if (!copy.executionReport) copy.executionReport = exec
              if (streamName === 'stderr') {
                exec.stderr = (exec.stderr || '') + String(chunk)
              } else {
                exec.stdout = (exec.stdout || '') + String(chunk)
              }
              return copy
            } catch (e) { return prev }
          })
          return
        }

        // fallback: if object has executionReport for our task
        if (obj.executionReport && (obj.taskId ? String(obj.taskId) === String(task.taskId) : true)) {
          setLive((prev: any) => {
            try { return Object.assign({}, prev || {}, { executionReport: obj.executionReport }) } catch (e) { return prev }
          })
          return
        }

      } catch (e) {
        // ignore malformed events
      }
    }

    // Try to establish a streaming connection (SSE or WebSocket)
    try {
      const conn = connectExecutionStream(task.taskId, {
        onOpen: () => {
          if (cancelled) return
          setStreamConnected(true)
          setIsPolling(false)
          setPollTimedOut(false)
          // clear connect timer if pending
          try { if (connectTimer) { clearTimeout(connectTimer); connectTimer = null } } catch (e) {}
        },
        onEvent: (evt) => {
          if (cancelled) return
          handleStreamEvent(evt)
        },
        onError: (err) => {
          if (cancelled) return
          setStreamError(err)
          setStreamConnected(false)
          // close stream connection
          try { if (streamConn && streamConn.close) streamConn.close() } catch (e) {}
          streamConn = null
          // fallback to polling
          startPolling()
        },
        onClose: () => {
          if (cancelled) return
          setStreamConnected(false)
          // fallback to polling
          startPolling()
        }
      })

      streamConn = conn

      // If stream is not established quickly, fallback to polling after a short timeout
      connectTimer = setTimeout(() => {
        if (!streamConn) return
        // If stream didn't signal onOpen yet, start polling as fallback
        // (some server setups may not support stream endpoint)
        if (!streamConnected) {
          try { streamConn && streamConn.close && streamConn.close() } catch (e) {}
          streamConn = null
          startPolling()
        }
      }, 2500)

      if (!streamConn) {
        startPolling()
      }
    } catch (e) {
      // unable to connect stream: fallback to polling
      startPolling()
    }

    return () => {
      cancelled = true
      pollCancelled = true
      try { setIsPolling(false); setPollTimedOut(false); setStreamConnected(false) } catch (e) {}
      try { if (streamConn && streamConn.close) streamConn.close() } catch (e) {}
      try { if (connectTimer) clearTimeout(connectTimer) } catch (e) {}
    }
  }, [task && task.taskId])

  async function doRefresh() {
    try {
      const tasks = await fetchTasks().catch(() => null)
      if (tasks && Array.isArray(tasks)) {
        const updated = tasks.find((x: any) => x && x.taskId === (task && task.taskId))
        if (updated) setLive(updated)
      }
      const ag = await fetchAgents().catch(() => null)
      if (ag) setAgents(ag)
      const r = await fetchRunnerStatus().catch(() => null)
      if (r) setRunnerStub(r)
      setPollTimedOut(false)
    } catch (e) {
      // ignore
    }
  }

  return { live, agents, runnerStub, isPolling, pollTimedOut, doRefresh, streamConnected, streamError }
}
