import React, { useEffect, useState } from 'react'
import ConversationHeader from './ConversationHeader'
import ConversationTimeline from './ConversationTimeline'
import ConversationActionCard from './ConversationActionCard'
import ConversationFollowupCard from './ConversationFollowupCard'
import ConversationComposer from './ConversationComposer'

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
}

export default function ConversationWorkspace(props: any) {
  const { task, tasks, messages, openTask } = props


  // Follow-ups state and polling
  const [followups, setFollowups] = useState<any[]>([])
  const [loadingFollowups, setLoadingFollowups] = useState<boolean>(false)

  useEffect(() => {
    let mounted = true
    let intervalId: any = null

    async function fetchFollowups() {
      setLoadingFollowups(true)
      try {
        const res = await fetch('/taskboard/api/followups')
        if (!res.ok) {
          console.error('Failed to fetch followups', res.status)
          return
        }
        const data = await res.json()
        if (!mounted) return
        // Ensure newest-first ordering (by generatedAt descending if available)
        const sorted = Array.isArray(data)
          ? data.slice().sort((a: any, b: any) => {
              const ta = a && a.generatedAt ? Date.parse(a.generatedAt) : 0
              const tb = b && b.generatedAt ? Date.parse(b.generatedAt) : 0
              return tb - ta
            })
          : []
        setFollowups(sorted)
      } catch (e) {
        console.error('Error fetching followups', e)
      } finally {
        if (mounted) setLoadingFollowups(false)
      }
    }

    // Initial fetch
    fetchFollowups()

    // Poll every 30s
    intervalId = setInterval(fetchFollowups, 30000)

    return () => {
      mounted = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  // Build unified timeline events with normalized timestamps (oldest-first)
  const events: any[] = []
  let seq = 0
  const parseTs = (s: any) => {
    if (!s) return null
    const t = Date.parse(String(s))
    return Number.isFinite(t) ? t : null
  }

  // Collect candidate times to derive a deterministic fallback base
  const candidateTimes: number[] = []
  if (Array.isArray(messages)) {
    messages.forEach((m: any) => {
      const t = parseTs(m && m.createdAt)
      if (t) candidateTimes.push(t)
    })
  }
  if (Array.isArray(followups)) {
    followups.forEach((f: any) => {
      const t = parseTs(f && f.generatedAt)
      if (t) candidateTimes.push(t)
    })
  }
  const taskTime = parseTs(task && (task.generatedAt || task.updatedAt || task.createdAt || task.notesUpdatedAt))
  if (taskTime) candidateTimes.push(taskTime)

  const baseTime = candidateTimes.length ? Math.min(...candidateTimes) : 0

  function mkEvent(obj: any) {
    seq += 1
    obj.seq = seq
    if (obj.ts === undefined || obj.ts === null) {
      // deterministic fallback (base + seq * 1000ms)
      obj.ts = baseTime + obj.seq * 1000
    }
    // ensure child objects that expect a createdAt have a stable value
    try {
      if (obj.type === 'message' && obj.message) {
        if (!obj.message.createdAt) obj.message.createdAt = new Date(obj.ts).toISOString()
      }
      if (obj.type === 'system' && obj.event) {
        if (!obj.event.createdAt) obj.event.createdAt = new Date(obj.ts).toISOString()
      }
      if (obj.type === 'followup' && obj.followup) {
        if (!obj.followup.generatedAt) obj.followup.generatedAt = new Date(obj.ts).toISOString()
      }
    } catch (e) {
      // ignore
    }

    events.push(obj)
  }

  // Messages
  if (Array.isArray(messages)) {
    messages.forEach((m: any, i: number) => {
      if (!m) return
      const ts = parseTs(m.createdAt)
      if (m.author === 'system') mkEvent({ id: m.id || `system-${i}`, type: 'system', event: m, ts })
      else mkEvent({ id: m.id || `msg-${i}`, type: 'message', message: m, ts })
    })
  }

  // Reviewer summary
  if (task && task.reviewerSummary) {
    const ts = parseTs(task.generatedAt) || parseTs(task.updatedAt) || parseTs(task.createdAt) || null
    mkEvent({ id: `reviewer-summary-${task.taskId || Math.random()}`, type: 'message', message: { author: 'reviewer', createdAt: task.generatedAt || task.updatedAt || null, text: task.reviewerSummary }, ts })
  }

  // Actions
  const actionsTs = parseTs(task && task.generatedAt) || parseTs(task && task.updatedAt) || null
  mkEvent({ id: `actions-${task && task.taskId ? task.taskId : 'na'}`, type: 'action', task, ts: actionsTs })

  // Follow-ups
  if (Array.isArray(followups) && followups.length) {
    followups.forEach((f: any, i: number) => {
      const ts = parseTs(f.generatedAt)
      mkEvent({ id: f.suggestionId || `followup-${i}`, type: 'followup', followup: f, ts })
    })
  }

  // Notes
  if (task && task.notes) {
    const ts = parseTs(task.notesUpdatedAt) || parseTs(task.updatedAt) || parseTs(task.createdAt) || null
    mkEvent({ id: `notes-${task.taskId || Math.random()}`, type: 'message', message: { author: 'note', createdAt: task.notesUpdatedAt || task.updatedAt || null, text: task.notes }, ts })
  }

  // Sort oldest-first (by timestamp, then seq for stable tie-break)
  const sortedEvents = events.slice().sort((a: any, b: any) => {
    if (a.ts !== b.ts) return a.ts - b.ts
    return a.seq - b.seq
  })

  return (
    <div className="conversation-workspace" style={{ ...containerStyle, height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <ConversationHeader task={task} tasks={tasks} openTask={openTask} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
        <ConversationTimeline events={sortedEvents} />
      </div>

      <div style={{ marginTop: 8 }}>
        <ConversationComposer
          placeholder="Write a note or update task..."
          disabled={!task}
          initialText={task && task.notes ? task.notes : ''}
          onSubmit={props.onComposeSubmit}
          sendLabel="Save Note"
        />
      </div>
    </div>
  )
}
