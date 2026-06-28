import { useEffect, useState } from 'react'
import { fetchTasks, fetchAgents, fetchRunnerStatus } from './api'

export default function useExecutionLive(task: any) {
  const [live, setLive] = useState<any>(task)
  const [agents, setAgents] = useState<any>(null)
  const [runnerStub, setRunnerStub] = useState<any>(null)
  const [isPolling, setIsPolling] = useState<boolean>(false)
  const [pollTimedOut, setPollTimedOut] = useState<boolean>(false)

  useEffect(() => { setLive(task) }, [task && task.taskId, task && task.updatedAt])

  useEffect(() => {
    if (!task || !task.taskId) return
    let cancelled = false
    const intervalMs = 2000
    const timeoutMs = 90000
    const start = Date.now()
    setPollTimedOut(false)

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
        if (cancelled) return
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

      if (!cancelled && elapsed < timeoutMs && shouldContinuePolling(current)) {
        setTimeout(doPoll, intervalMs)
      } else {
        setIsPolling(false)
        if (!cancelled && elapsed >= timeoutMs) {
          const execNow = current && (current.executionReport || current.execution || current.execution_report)
          if (!execNow) setPollTimedOut(true)
        }
      }
    }

    if (shouldContinuePolling(task)) {
      setIsPolling(true)
      doPoll()
    } else {
      fetchAgents().then((a) => { if (!cancelled) setAgents(a) }).catch(() => {})
      fetchRunnerStatus().then((r) => { if (!cancelled) setRunnerStub(r) }).catch(() => {})
    }

    return () => { cancelled = true; setIsPolling(false); setPollTimedOut(false) }
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

  return { live, agents, runnerStub, isPolling, pollTimedOut, doRefresh }
}
