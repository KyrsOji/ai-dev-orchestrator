#!/usr/bin/env node
'use strict'

function iso(s) { return (new Date(s)).toISOString() }

function generateNotifications({ notifications = [], prevTasks = {}, prevAgents = {}, tasks = [], agents = [], selected = null }) {
  const existingIds = new Set((notifications || []).map(n => n.id))
  const newNotifs = []
  const nowIso = new Date().toISOString()

  for (const t of tasks) {
    try {
      const msgs = Array.isArray(t.messages) ? t.messages : []
      const taskCreatedId = `task_created:${t.taskId}`
      if (!prevTasks[t.taskId]) {
        if (!existingIds.has(taskCreatedId)) {
          const createdAt = t.createdAt || t.updatedAt || (msgs[0] && msgs[0].createdAt) || nowIso
          newNotifs.push({ id: taskCreatedId, taskId: t.taskId, type: 'task_created', title: 'Task created', message: t.title || '', createdAt, read: selected === t.taskId })
          existingIds.add(taskCreatedId)
        }
        prevTasks[t.taskId] = true
      }

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
        const isResult = author === 'result' || author === 'openhands' || (m.data && m.data._runner_marker)
        if (isResult) {
          const id = `result_updated:${t.taskId}:${m.id || m.createdAt || Math.random().toString(36).slice(2,8)}`
          if (!existingIds.has(id)) {
            newNotifs.push({ id, taskId: t.taskId, type: 'result_updated', title: 'Result updated', message: (m.text || '').slice(0,200), createdAt: m.createdAt || t.updatedAt || nowIso, read: selected === t.taskId })
            existingIds.add(id)
          }
        }

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

  // Agent stale detection
  for (const a of (agents || [])) {
    const prevFresh = prevAgents[a.agentId]
    const isFresh = !!a.isFresh
    const id = `agent_stale:${a.agentId}:${a.lastSeen || nowIso}`
    if (prevFresh === undefined) {
      prevAgents[a.agentId] = isFresh
    } else if (prevFresh && !isFresh) {
      if (!existingIds.has(id)) {
        newNotifs.push({ id, taskId: '', type: 'agent_stale', title: 'Agent became stale', message: `${a.agentId} is stale`, createdAt: a.lastSeen || nowIso, read: false })
        existingIds.add(id)
      }
      prevAgents[a.agentId] = isFresh
    } else {
      prevAgents[a.agentId] = isFresh
    }
  }

  const merged = [...newNotifs, ...notifications].sort((A,B) => B.createdAt.localeCompare(A.createdAt))
  return { notifications: merged, prevTasks, prevAgents }
}

function markNotificationsReadForTask(notifs, taskId) {
  return notifs.map(n => (n.taskId === taskId ? { ...n, read: true } : n))
}

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERT FAILED:', msg)
    process.exit(2)
  }
}

async function main() {
  console.log('SMOKE: Notification Center — start')

  // sample data timestamps
  const t1 = '2026-06-19T20:00:00.000Z'
  const t2 = '2026-06-19T20:05:00.000Z'
  const t3 = '2026-06-19T20:10:00.000Z'
  const t4 = '2026-06-19T20:15:00.000Z'

  const tasks = [
    { taskId: 'TASK-1', title: 'Task One', updatedAt: t1, messages: [] },
    { taskId: 'TASK-2', title: 'Task Two', updatedAt: t2, messages: [ { id: 'r1', author: 'result', text: 'Result v1', createdAt: t2 } ] },
    { taskId: 'TASK-3', title: 'Task Three', updatedAt: t3, messages: [ { id: 'f1', author: 'follow_up', text: 'Follow-up task created', createdAt: t3, data: { followUpTask: { taskId: 'TASK-3-FU', title: 'FU Task' } } } ] },
    { taskId: 'TASK-4', title: 'Task Four', updatedAt: t4, messages: [ { id: 's1', author: 'second_opinion', text: 'Please review', createdAt: t4 } ] }
  ]

  const agents1 = [
    { agentId: 'agent-fresh-idle', hostname: 'host-a', roles: ['ofbiz'], status: 'idle', isFresh: true, lastSeen: '2026-06-19T20:20:00.000Z', memoryGb: 8, diskFreeGb: 50, loadAverage: 0.3 },
    { agentId: 'agent-will-stale', hostname: 'host-b', roles: ['ofbiz'], status: 'idle', isFresh: true, lastSeen: '2026-06-19T20:18:00.000Z', memoryGb: 4, diskFreeGb: 20, loadAverage: 1.5 }
  ]

  // initial pass
  let prevTasks = {}
  let prevAgents = {}
  let notifications = []

  const res1 = generateNotifications({ notifications, prevTasks, prevAgents, tasks, agents: agents1, selected: null })
  notifications = res1.notifications
  prevTasks = res1.prevTasks
  prevAgents = res1.prevAgents

  console.log('Generated notifications (initial):')
  for (const n of notifications) console.log(` - ${n.id} [${n.type}] ${n.createdAt} ${n.title} (${n.taskId||''})`)

  // required types must be present
  const types = new Set(notifications.map(n => n.type))
  assert(types.has('task_created'), 'missing task_created notification')
  assert(types.has('result_updated'), 'missing result_updated notification')
  assert(types.has('follow_up_created'), 'missing follow_up_created notification')
  assert(types.has('opinion_added'), 'missing opinion_added notification')
  console.log('SMOKE PASS: initial notification types present')

  // simulate agent going stale
  const agents2 = [ ...agents1.map(a => ({ ...a } )) ]
  agents2[1].isFresh = false
  agents2[1].lastSeen = '2026-06-19T21:20:00.000Z' // newer timestamp -> will be newest notification

  const res2 = generateNotifications({ notifications, prevTasks, prevAgents, tasks, agents: agents2, selected: null })
  notifications = res2.notifications
  prevTasks = res2.prevTasks
  prevAgents = res2.prevAgents

  console.log('Generated notifications (after agent stale):')
  for (const n of notifications.slice(0, 6)) console.log(` - ${n.id} [${n.type}] ${n.createdAt} ${n.title} (${n.taskId||''})`)

  assert(new Set(notifications.map(n => n.type)).has('agent_stale'), 'missing agent_stale notification')
  console.log('SMOKE PASS: agent_stale notification generated')

  // assert newest-first ordering
  for (let i = 1; i < notifications.length; i++) {
    const a = notifications[i-1].createdAt
    const b = notifications[i].createdAt
    assert(a >= b, `notifications not sorted newest-first at index ${i-1} (${a} < ${b})`)
  }
  console.log('SMOKE PASS: notifications sorted newest-first')

  // simulate opening TASK-2 and marking its notifications read
  const beforeUnread = notifications.filter(n => n.taskId === 'TASK-2').filter(n => !n.read).length
  // ensure we have at least one
  assert(beforeUnread > 0, 'no unread notifications for TASK-2 to test marking read')

  notifications = markNotificationsReadForTask(notifications, 'TASK-2')
  const afterUnread = notifications.filter(n => n.taskId === 'TASK-2').filter(n => !n.read).length
  assert(afterUnread === 0, 'not all TASK-2 notifications marked read')
  console.log('SMOKE PASS: marking notifications for a task read works correctly')

  console.log('SMOKE: Notification Center — all checks passed')
  process.exit(0)
}

main().catch(e => { console.error('FATAL', e); process.exit(2) })
