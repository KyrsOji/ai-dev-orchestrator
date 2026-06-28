import React from 'react'
import { useEffect, useState } from 'react'
import useExecutionLive from './useExecutionLive'
import ExecutionDetailsDrawer from './ExecutionDetailsDrawer'

function formatIso(iso: any) {
  try {
    if (!iso) return 'unknown'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleString()
  } catch (e) { return String(iso) }
}

function formatDurationSeconds(sec: any) {
  try {
    const s = Number(sec)
    if (!isFinite(s)) return null
    const abs = Math.max(0, Math.floor(s))
    const hours = Math.floor(abs / 3600)
    const minutes = Math.floor((abs % 3600) / 60)
    const seconds = abs % 60
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  } catch (e) { return null }
}

function formatDurationFromTimestamps(start: any, end: any) {
  try {
    if (!start) return null
    const s = new Date(start).getTime()
    if (isNaN(s)) return null
    const e = end ? new Date(end).getTime() : Date.now()
    if (isNaN(e)) return null
    const ms = Math.max(0, e - s)
    const sec = Math.floor(ms / 1000)
    return formatDurationSeconds(sec)
  } catch (e) { return null }
}

function computePhaseFromTask(t: any) {
  if (!t) return 'Queued'
  const exec = t.executionReport || t.execution || t.execution_report || null
  // prefer an explicit phase/stage if the execution report provides one
  const phaseCandidate = exec && (exec.phase || exec.stage || exec.step || exec.currentPhase)
  if (phaseCandidate) return String(phaseCandidate)
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

function isWebUrl(s: any) {
  if (!s) return false
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:' } catch (e) { return false }
}

function formatDurationHuman(value: any) {
  if (value === null || value === undefined) return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  let seconds = Math.round(n)
  const parts: string[] = []
  const h = Math.floor(seconds / 3600)
  if (h) { parts.push(`${h}h`); seconds -= h * 3600 }
  const m = Math.floor(seconds / 60)
  if (m) { parts.push(`${m}m`); seconds -= m * 60 }
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

function shortenPath(s: any, len = 70) {
  if (!s) return ''
  const str = String(s)
  if (str.length <= len) return str
  return `${str.slice(0, Math.max(8, len - 12))}...${str.slice(-8)}`
}

export default function ExecutionMonitor({ task, openExecutionDetails }: { task: any; openExecutionDetails?: (exec: any) => void }) {
  const { live, agents, runnerStub, isPolling, pollTimedOut, doRefresh: refresh, streamConnected } = useExecutionLive(task)
  const [showDetails, setShowDetails] = useState<boolean>(false)
  const [now, setNow] = useState<number>(Date.now())

  const t = live || task || {}
  const phase = computePhaseFromTask(t)
  const lastActivity = t.lastActivityAt || t.updatedAt || t.updated_at || null
  const reviewer = t.reviewerSummary || t.approver || t.reviewer || t.decision || null

  // Normalize agent/runner info
  let runnerObj: any = null
  if (agents) {
    if (Array.isArray(agents)) {
      const agentId = t && t.routing && (t.routing.selectedAgentId || t.routing.selectedAgent || (t.routing.selected && t.routing.selected.agentId))
      runnerObj = (agentId && agents.find((r: any) => r && (r.agentId === agentId || r.id === agentId || r.hostname === agentId))) || agents[0]
    } else if (agents && Array.isArray(agents.agents)) {
      const agentId = t && t.routing && (t.routing.selectedAgentId || t.routing.selectedAgent)
      runnerObj = (agentId && agents.agents.find((r: any) => r && (r.agentId === agentId || r.id === agentId || r.hostname === agentId))) || agents.agents[0]
    }
  } else if (runnerStub) {
    runnerObj = runnerStub
  }

  const runnerStatus = (runnerObj && (runnerObj.status || runnerObj.state)) || null
  const runnerLastSeen = runnerObj && (runnerObj.lastSeen || runnerObj.last_seen || runnerObj.lastSeenAt || runnerObj.updatedAt || runnerObj.last_seen_at || null)

  const exec = t.executionReport || t.execution || t.execution_report || null

  const execPhase = exec && (exec.phase || exec.stage || exec.step || exec.currentPhase) || null

  // Return code (if present)
  const returnCode = exec && (exec.returnCode || exec.return_code || exec.rc || exec.exitCode || exec.exit_code)

  // Queue position / depth (if provided by backend)
  const queuePosition = t && (t.queuePosition || t.queue_pos || t.queue_position || t.queue) || (exec && (exec.queuePosition || exec.queue_pos || exec.queue_position)) || null


  // Prefer explicit execution duration; otherwise derive from timestamps (and show live elapsed when running)
  const durationRaw = exec && (exec.executionDurationSeconds || exec.duration || exec.elapsed || exec.time)
  const startedRaw = exec && (exec.startedAt || exec.executionStartedAt || exec.execution_started_at || exec.startTime || exec.createdAt)
  const finishedRaw = exec && (exec.completedAt || exec.finishedAt || exec.completed_at || exec.updatedAt || exec.finished_at)
  let elapsedFromTimestamps: number | null = null
  let elapsedSeconds: number | null = null
  let startedMs: number | null = null
  let finishedMs: number | null = null
  try {
    if (startedRaw) {
      const s = new Date(startedRaw).getTime()
      if (!Number.isNaN(s)) startedMs = s
    }
    if (finishedRaw) {
      const f = new Date(finishedRaw).getTime()
      if (!Number.isNaN(f)) finishedMs = f
    }
    if (startedMs !== null && finishedMs !== null && finishedMs >= startedMs) {
      elapsedFromTimestamps = Math.round((finishedMs - startedMs) / 1000)
      elapsedSeconds = elapsedFromTimestamps
    } else if (startedMs !== null && (finishedMs === null)) {
      // running: compute elapsed against live 'now' state (updated via effect below)
      elapsedSeconds = Math.round((now - startedMs) / 1000)
    }
  } catch (e) { /* ignore */ }

  const durationText = formatDurationHuman(durationRaw || elapsedSeconds || elapsedFromTimestamps)
  const stdout = exec && (exec.stdout || exec.output || exec.response || exec.responsePreview || exec.response_preview) || null
  const stderr = exec && (exec.stderr || exec.errorOutput || null) || null
  const runDir = exec && (exec.runDirectory || exec.run_directory || exec.runDir) || null
  const artifacts = exec && (exec.artifacts || exec.filesChanged || exec.files_changed || exec.files || exec.changedFiles) || null

  useEffect(() => {
    // When execution has started but not finished, update the 'now' timestamp every second
    let id: any = null
    try {
      if (startedMs !== null && finishedMs === null) {
        id = setInterval(() => setNow(Date.now()), 1000)
      } else {
        // ensure a fresh 'now' is captured when not actively running
        setNow(Date.now())
      }
    } catch (e) {}
    return () => { if (id) clearInterval(id) }
  }, [startedMs, finishedMs])


  async function doRefresh() {
    try {
      await refresh()
    } catch (e) {}
  }

  function copyToClipboard(text: string) {
    try { if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(String(text)) } catch (e) {}
  }

  return (
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, border: '1px solid #eef2ff', background: '#fff', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 140, fontWeight: 700 }}>Execution</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Phase</div>
          <div style={{ fontWeight: 800 }}>{phase}{execPhase && execPhase !== phase ? (' — ' + String(execPhase)) : ''}{isPolling ? ' \u00b7 polling' : ''}{streamConnected ? ' \u00b7 live' : ''}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>Last: {lastActivity ? formatIso(lastActivity) : 'unknown'}</div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Reviewer:</div>
          <div style={{ fontWeight: 700 }}>{reviewer ? String(reviewer).slice(0, 60) : 'unknown'}</div>

          <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Runner:</div>
          <div style={{ fontWeight: 700 }}>{runnerStatus || 'unknown'}</div>

          {runnerLastSeen ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Runner update: <strong style={{ fontWeight: 700 }}>{runnerLastSeen ? formatIso(runnerLastSeen) : 'unknown'}</strong></div>
          ) : null}

          <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Kafka:</div>
          <div style={{ fontWeight: 700 }}>{(runnerObj && (runnerObj.kafka || (runnerObj.raw && runnerObj.raw.kafka))) ? String(runnerObj.kafka || (runnerObj.raw && runnerObj.raw.kafka)) : 'unknown'}</div>

          {queuePosition ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Queue:</div>
          ) : null}
          {queuePosition ? (
            <div style={{ fontWeight: 700 }}>{String(queuePosition)}</div>
          ) : null}

          {returnCode !== undefined && returnCode !== null ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>Exit:</div>
          ) : null}
          {returnCode !== undefined && returnCode !== null ? (
            <div style={{ fontWeight: 700 }}>{String(returnCode)}</div>
          ) : null}

          {durationText ? (
            <div style={{ marginLeft: 12, fontSize: 12, color: '#6b7280' }}>Elapsed: <strong style={{ fontWeight: 700 }}>{durationText}</strong></div>
          ) : null}
        </div>

        {runDir ? (
          <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isWebUrl(runDir) ? (
              <div>Logs: <a className="small" href={String(runDir)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} aria-label="Open logs in new tab">Open in new tab</a></div>
            ) : (
              <div>Logs: Available (not shown for security)</div>
            )}
          </div>
        ) : null}

        {(stdout || stderr) ? (
          <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: '#f8fafc', border: '1px solid #e6eefc', fontSize: 12, maxHeight: 160, overflow: 'auto' }}>
            {stdout ? <div><strong>Output</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(stdout).slice(0, 2000)}</pre></div> : null}
            {stderr ? <div style={{ marginTop: 8 }}><strong style={{ color: '#ef4444' }}>Errors</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{String(stderr).slice(0, 2000)}</pre></div> : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          {runDir ? (
            isWebUrl(runDir) ? (
              <a className="small" href={String(runDir)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} aria-label="Open logs in new tab">View full logs</a>
            ) : (
              <button className="small" onClick={() => { if (openExecutionDetails) { openExecutionDetails(exec) } else { setShowDetails(true) } }} aria-label="Open execution details">Open execution details</button>
            )
          ) : null}

          {!runDir ? (
            <button className="small" onClick={() => { if (openExecutionDetails) { openExecutionDetails(exec) } else { setShowDetails(true) } }} aria-label="Open execution details">View execution details</button>
          ) : null}

          {artifacts && Array.isArray(artifacts) && artifacts.length ? (
            <button className="small" onClick={() => { if (openExecutionDetails) { openExecutionDetails(exec) } else { setShowDetails(true) } }} aria-label="Open artifacts">Open artifacts</button>
          ) : null}

          {pollTimedOut && !exec ? (
            <div style={{ marginLeft: 'auto', color: '#374151', background: '#fff7ed', border: '1px solid #ffedd5', padding: 8, borderRadius: 6, fontSize: 13 }}>
              <div>Polling timed out — no execution report received from runner.</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button className="small" onClick={() => doRefresh()}>Retry</button>
                <button className="small" onClick={() => { if (openExecutionDetails) { openExecutionDetails(exec) } else { setShowDetails(true) } }}>Open execution details</button>
              </div>
            </div>
          ) : null}
        </div>

        {showDetails && exec ? (
          <div style={{ marginTop: 8 }}>
            <ExecutionDetailsDrawer exec={exec} />
            <div style={{ marginTop: 8 }}><button className="small" onClick={() => setShowDetails(false)} aria-label="Close execution details">Close</button></div>
          </div>
        ) : null}

      </div>
    </div>
  )
}
