#!/usr/bin/env node
'use strict'

// Smoke test for Agent Queue visibility grouping logic
// Creates sample agents and tasks and validates counts for ofbiz-dev-01 and unassigned bucket

function computeGroups(agents, tasks) {
  const runningStates = new Set(['running', 'submitted'])
  const queuedStates = new Set(['pending_review', 'approved'])
  const completedStates = new Set(['completed', 'dry_run_completed', 'executed', 'prepared'])

  const groups = {}
  for (const a of (agents || [])) {
    groups[a.agentId] = { agent: a, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }
  }
  groups['__unassigned__'] = { agent: null, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }

  for (const t of (tasks || [])) {
    const aid = (t && t.routing && (t.routing.selectedAgentId || t.routing.selectedAgentId)) || '__unassigned__'
    if (!groups[aid]) groups[aid] = { agent: null, tasks: [], runningCount: 0, queuedCount: 0, completedCount: 0, otherCount: 0 }
    groups[aid].tasks.push(t)
    const s = (t && t.status) ? t.status : ''
    if (runningStates.has(s)) groups[aid].runningCount++
    else if (queuedStates.has(s)) groups[aid].queuedCount++
    else if (completedStates.has(s)) groups[aid].completedCount++
    else groups[aid].otherCount++
  }

  const agentOrder = (agents || []).map(a => a.agentId).concat(['__unassigned__'])
  return { groups, agentOrder }
}

function runSmoke() {
  const agents = [
    {
      agentId: 'ofbiz-dev-01', id: 'ofbiz-dev-01', hostname: 'ofbiz-dev-01.local', roles: ['ofbiz'], status: 'idle', cpuCount: 8, memoryGb: 16, diskFreeGb: 200, loadAverage: 0.2, lastSeen: new Date().toISOString(), freshnessSeconds: 0, isFresh: true
    },
    {
      agentId: 'other-agent', id: 'other-agent', hostname: 'other-01.local', roles: ['general'], status: 'idle', cpuCount: 4, memoryGb: 8, diskFreeGb: 100, loadAverage: 0.5, lastSeen: new Date().toISOString(), freshnessSeconds: 0, isFresh: true
    }
  ]

  const tasks = [
    { taskId: 'TASK-1', title: 'Completed task', status: 'completed', routing: { selectedAgentId: 'ofbiz-dev-01', selectedHostname: 'ofbiz-dev-01.local', selectedRole: 'ofbiz' } },
    { taskId: 'TASK-2', title: 'Queued task', status: 'pending_review', routing: { selectedAgentId: 'ofbiz-dev-01', selectedHostname: 'ofbiz-dev-01.local', selectedRole: 'ofbiz' } },
    { taskId: 'TASK-3', title: 'Unassigned task', status: 'pending_review', routing: { } }
  ]

  const { groups, agentOrder } = computeGroups(agents, tasks)

  const ofbiz = groups['ofbiz-dev-01']
  const unassigned = groups['__unassigned__']

  console.log('AGENTS:', Object.keys(groups))
  console.log('ofbiz counts: running=%d queued=%d completed=%d totalAssigned=%d', ofbiz.runningCount, ofbiz.queuedCount, ofbiz.completedCount, (ofbiz.tasks || []).length)
  console.log('unassigned tasks:', (unassigned.tasks || []).map(t => t.taskId))

  let ok = true
  if (!ofbiz) { console.error('SMOKE FAIL: ofbiz-dev-01 group missing'); ok = false }
  else {
    if (ofbiz.runningCount !== 0) { console.error('SMOKE FAIL: expected runningCount 0 for ofbiz-dev-01, got', ofbiz.runningCount); ok = false }
    if (ofbiz.queuedCount !== 1) { console.error('SMOKE FAIL: expected queuedCount 1 for ofbiz-dev-01, got', ofbiz.queuedCount); ok = false }
    if (ofbiz.completedCount !== 1) { console.error('SMOKE FAIL: expected completedCount 1 for ofbiz-dev-01, got', ofbiz.completedCount); ok = false }
  }

  if (!unassigned) { console.error('SMOKE FAIL: unassigned group missing'); ok = false }
  else if ((unassigned.tasks || []).length !== 1) { console.error('SMOKE FAIL: expected 1 unassigned task, got', (unassigned.tasks || []).length); ok = false }

  if (!ok) process.exit(1)
  console.log('SMOKE PASS: Agent Queue grouping logic behaves as expected')
  process.exit(0)
}

runSmoke()
