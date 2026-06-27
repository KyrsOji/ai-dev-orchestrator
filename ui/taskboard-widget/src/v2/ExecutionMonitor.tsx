import React from 'react'
import { useEffect, useState } from 'react'
import { fetchTasks, fetchRunnerStatus } from './api'

function formatIso(iso: any) {
  try {
    if (!iso) return 'unknown'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleString()
  } catch (e) { return String(iso) }
}

function computePhaseFromTask(t: any) {
  if (!t) return 'Queued'
  const exec = t.executionReport || t.execution || t.execution_report || null
  const status = (exec && (exec.status || exec.executionStatus || exec.state)) || (t && t.status) || null
  const s = status ? String(status).toLowerCase() : ''
  if (s.includes('failed') || s === 'failed') return 'Failed'
  if (s.includes('completed') || s === 'completed' || s === 'success') return 'Completed'
  if (s.includes('running') || s === 'running') return 'Running'
  if (t && (t.dispatched || s === 'dispatched')) return 'Dispatched'
  if (s === 'approved' || s === 'reviewed' || s === 'pending_review' || s === 'reviewing') return 'Reviewing'
  if (s === 'queued' || s === 'pending') return 'Queued'
  return 'Queued'
}

export default function ExecutionMonitor({ task }: { task: any }) {
  const [live, setLive] = useState<any>(task)
  const [runner, setRunner] = useState<any>(null)
  const [isPolling, setIsPolling] = useState<boolean>(false)

  useEffect(() => { setLive(task) }, [task && task.taskId, task && task.updatedAt])

  useEffect(() => {
    if (!task || !task.taskId) return
    let cancelled = false
    const intervalMs = 2000
    const timeoutMs = 90000
    const start = Date.now()

    function shouldContinuePolling(t: any) {
      if (!t) return false
      const s = String((t.status || '')).toLowerCase()
      if (t.dispatched) return true
      if (s === 'running' || s === 'dispatched' || s === 'queued' || s === 'pending_review' || s === 'reviewing') return true
      return false
    }

    async function doPoll() {
      try {
        if (cancelled) return
        const tasks = await fetchTasks().catch(() => null)
        if (tasks && Array.isArray(tasks)) {
          const updated = tasks.find((x: any) => x && x.taskId === task.taskId)
          if (updated) setLive(updated)
        }
        const r = await fetchRunnerStatus().catch(() => null)
        if (r) setRunner(r)
      } catch (e) {
        // ignore
      }

      if (Date.now() - start < timeoutMs && !cancelled && shouldContinuePolling(live || task)) {
        setTimeout(doPoll, intervalMs)
      } else {
        setIsPolling(false)
      }
    }

    // Start polling only if task is dispatched/running
    if (shouldContinuePolling(task)) {
      setIsPolling(true)
      doPoll()
    } else {
      // fetch runner status once
      fetchRunnerStatus().then((r) => { if (!cancelled) setRunner(r) }).catch(() => {})
    }

    return () => { cancelled = true; setIsPolling(false) }
  }, [task && task.taskId])

  const t = live || task || {}
  const phase = computePhaseFromTask(t)
  const lastActivity = t.lastActivityAt || t.updatedAt || t.updated_at || null
  const reviewer = t.reviewerSummary || t.approver || t.reviewer || t.decision || null
  const runnerStatus = (runner && (runner.status || runner.state)) || null
  const exec = t.executionReport || t.execution || t.execution_report || null
  const duration = exec && (exec.executionDurationSeconds || exec.duration || exec.elapsed || exec.time) || null
  const stdout = exec && (exec.stdout || exec.output || exec.response || exec.responsePreview || exec.response_preview) || null
  const stderr = exec && (exec.stderr || exec.errorOutput || null) || null
  const runDir = exec && (exec.runDirectory || exec.run_directory || exec.runDir) || null

  return (
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, border: '1px solid #eef2ff', background: '#fff', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 140, fontWeight: 700 }}>Execution</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Phase</div>
          <div style={{ fontWeight: 800 }}>{phase}{isPolling ? ' · polling' : ''}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>Last: {lastActivity ? formatIso(lastActivity) : 'unknown'}</div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Reviewer:</div>
          <div style={{ fontWeight: 700 }}>{reviewer ? String(reviewer).slice(0, 60) : 'unknown'}</div>

          <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Runner:</div>
          <div style={{ fontWeight: 700 }}>{runnerStatus || 'unknown'}</div>

          <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Kafka:</div>
          <div style={{ fontWeight: 700 }}>{(runner && runner.kafka) ? String(runner.kafka) : 'unknown'}</div>

          {duration ? (
            <div style={{ marginLeft: 12, fontSize: 12, color: '#6b7280' }}>Duration: <strong style={{ fontWeight: 700 }}>{String(duration)}</strong></div>
          ) : null}
        </div>

        {runDir ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>Run dir: <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' }}>{String(runDir)}</code></div>
        ) : null}

        {(stdout || stderr) ? (
          <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: '#f8fafc', border: '1px solid #e6eefc', fontSize: 12, maxHeight: 160, overflow: 'auto' }}>
            {stdout ? <div><strong>Output</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(stdout).slice(0, 2000)}</pre></div> : null}
            {stderr ? <div style={{ marginTop: 8 }}><strong style={{ color: '#ef4444' }}>Errors</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(stderr).slice(0, 2000)}</pre></div> : null}
          </div>
        ) : null}

      </div>
    </div>
  )
}
