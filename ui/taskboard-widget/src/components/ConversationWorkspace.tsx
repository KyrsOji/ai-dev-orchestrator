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

  // Build unified timeline events
  const events: any[] = []

  // Add messages (system/openhands/reviewer) from props
  if (Array.isArray(messages)) {
    const msgs = messages.slice().sort((a: any, b: any) => {
      const ta = a && a.createdAt ? Date.parse(a.createdAt) : 0
      const tb = b && b.createdAt ? Date.parse(b.createdAt) : 0
      return ta - tb
    })
    msgs.forEach((m: any, i: number) => {
      if (!m) return
      if (m.author === 'system') events.push({ id: m.id || `system-${i}`, type: 'system', event: m })
      else events.push({ id: m.id || `msg-${i}`, type: 'message', message: m })
    })
  }

  // Reviewer summary as a message event
  if (task && task.reviewerSummary) {
    events.push({ id: `reviewer-summary-${task.taskId || Math.random()}`, type: 'message', message: { author: 'reviewer', createdAt: task.generatedAt || new Date().toISOString(), text: task.reviewerSummary } })
  }

  // Actions inline after reviewer summary
  events.push({ id: `actions-${task && task.taskId ? task.taskId : 'na'}`, type: 'action', task })

  // Follow-ups inline
  if (Array.isArray(followups) && followups.length) {
    followups.forEach((f: any, i: number) => {
      events.push({ id: f.suggestionId || `followup-${i}`, type: 'followup', followup: f, createdAt: f.generatedAt || null })
    })
  }

  // Notes as message events
  if (task && task.notes) {
    events.push({ id: `notes-${task.taskId || Math.random()}`, type: 'message', message: { author: 'note', createdAt: task.notesUpdatedAt || new Date().toISOString(), text: task.notes } })
  }

  return (
    <div className="conversation-workspace" style={{ ...containerStyle, height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <ConversationHeader task={task} tasks={tasks} openTask={openTask} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
        <ConversationTimeline events={events} />
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
