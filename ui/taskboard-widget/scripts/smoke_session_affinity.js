#!/usr/bin/env node
'use strict'

// Smoke test for session affinity recommendation behavior
// Case A: conversationId exists, selectedAgentId=ofbiz-affinity => expected winner ofbiz-affinity
// Case B: conversationId missing => expected normal scoring where other-lowload wins

function scoreAgent(selectedRole, a, agents, taskContext) {
  let score = 0
  const reasons = []

  const hasConversation = taskContext && !!taskContext.conversationId
  const convAgentId = hasConversation ? taskContext.selectedAgentId : undefined
  const convHostname = hasConversation ? taskContext.selectedHostname : undefined

  if (hasConversation) {
    reasons.push('Existing OpenHands conversation')
    if (convAgentId && (a.agentId === convAgentId || a.id === convAgentId)) {
      score += 200
      reasons.push('Same agent as conversation')
    } else if (convHostname && a.hostname && a.hostname === convHostname) {
      score += 100
      reasons.push('Same host as conversation')
    } else {
      score -= 50
      reasons.push('Different agent (load balancing)')
    }
  }

  // Role match
  if (Array.isArray(a.roles) && a.roles.includes(selectedRole)) {
    score += 100
    reasons.push(`Role match: ${selectedRole}`)
  } else {
    score -= 1000
    reasons.push('Missing role')
  }

  // Freshness
  if (a.isFresh) {
    score += 25
    reasons.push('Fresh heartbeat')
  } else {
    score -= 100
    reasons.push('Stale')
  }

  // Idle
  if (a.status === 'idle') {
    score += 25
    reasons.push('Idle')
  }

  // prepare normalization arrays
  const loadVals = agents.map(x => (typeof x.loadAverage === 'number' ? x.loadAverage : NaN)).filter(n => !Number.isNaN(n))
  const memVals = agents.map(x => (typeof x.memoryGb === 'number' ? x.memoryGb : NaN)).filter(n => !Number.isNaN(n))
  const diskVals = agents.map(x => (typeof x.diskFreeGb === 'number' ? x.diskFreeGb : NaN)).filter(n => !Number.isNaN(n))

  const minLoad = loadVals.length ? Math.min(...loadVals) : 0
  const maxLoad = loadVals.length ? Math.max(...loadVals) : 0
  const minMem = memVals.length ? Math.min(...memVals) : 0
  const maxMem = memVals.length ? Math.max(...memVals) : 0
  const minDisk = diskVals.length ? Math.min(...diskVals) : 0
  const maxDisk = diskVals.length ? Math.max(...diskVals) : 0

  // Lower load 0..20
  if (typeof a.loadAverage === 'number' && loadVals.length) {
    let loadScore = 0
    if (minLoad === maxLoad) loadScore = 10
    else loadScore = ((maxLoad - a.loadAverage) / (maxLoad - minLoad)) * 20
    score += loadScore
    if (a.loadAverage === minLoad) reasons.push('Lowest load')
    else reasons.push('Lower load')
  }

  // Memory 0..10
  if (typeof a.memoryGb === 'number' && memVals.length) {
    let memScore = 0
    if (minMem === maxMem) memScore = 5
    else memScore = ((a.memoryGb - minMem) / (maxMem - minMem)) * 10
    score += memScore
    if (a.memoryGb === maxMem) reasons.push('Most memory')
    else reasons.push('Memory available')
  }

  // Disk 0..5
  if (typeof a.diskFreeGb === 'number' && diskVals.length) {
    let diskScore = 0
    if (minDisk === maxDisk) diskScore = 2.5
    else diskScore = ((a.diskFreeGb - minDisk) / (maxDisk - minDisk)) * 5
    score += diskScore
    if (a.diskFreeGb === maxDisk) reasons.push('Most disk')
    else reasons.push('Disk available')
  }

  return { score: Math.round((score + Number.EPSILON) * 10) / 10, reasons }
}

function recommend(selectedRole, agents, taskContext) {
  if (!agents || agents.length === 0) return null

  let best = null
  let bestScore = -Infinity
  for (const a of agents) {
    const { score, reasons } = scoreAgent(selectedRole, a, agents, taskContext)
    if (score > bestScore) {
      bestScore = score
      best = { agentId: a.agentId || a.id || '', hostname: a.hostname || '', score, reasons }
    }
  }
  return best
}

function runSmoke() {
  const agents = [
    {
      agentId: 'ofbiz-affinity',
      id: 'ofbiz-affinity',
      hostname: 'ofbiz-01.local',
      roles: ['ofbiz'],
      status: 'idle',
      cpuCount: 8,
      memoryGb: 16,
      diskFreeGb: 200,
      loadAverage: 0.5,
      lastSeen: new Date().toISOString(),
      freshnessSeconds: 0,
      isFresh: true,
    },
    {
      agentId: 'other-lowload',
      id: 'other-lowload',
      hostname: 'other-01.local',
      roles: ['ofbiz'],
      status: 'idle',
      cpuCount: 4,
      memoryGb: 8,
      diskFreeGb: 100,
      loadAverage: 0.1,
      lastSeen: new Date().toISOString(),
      freshnessSeconds: 0,
      isFresh: true,
    }
  ]

  // Case A: conversation exists and is associated with ofbiz-affinity
  const taskContextA = { conversationId: 'conv-1', selectedAgentId: 'ofbiz-affinity', selectedHostname: 'ofbiz-01.local' }
  const recA = recommend('ofbiz', agents, taskContextA)
  console.log('Case A Recommendation:', recA && recA.agentId, 'score=', recA && recA.score)
  if (!recA || recA.agentId !== 'ofbiz-affinity') {
    console.error('SMOKE FAIL: Case A expected ofbiz-affinity to win')
    process.exit(1)
  }

  // Case B: no conversation -> normal scoring (other-lowload should win due to lower load)
  const recB = recommend('ofbiz', agents, null)
  console.log('Case B Recommendation:', recB && recB.agentId, 'score=', recB && recB.score)
  if (!recB || recB.agentId !== 'other-lowload') {
    console.error('SMOKE FAIL: Case B expected other-lowload to win')
    process.exit(1)
  }

  console.log('SMOKE PASS: session affinity behavior OK')
  process.exit(0)
}

runSmoke()
