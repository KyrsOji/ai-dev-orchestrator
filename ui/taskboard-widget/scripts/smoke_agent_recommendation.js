#!/usr/bin/env node
'use strict'

// Smoke test for agent recommendation algorithm
// NOTE: This script mirrors the recommendation logic in src/agentRecommendation.ts (kept in JS for smoke testing)
// Creates three agents and ensures the fresh idle ofbiz agent wins

function scoreAgent(selectedRole, a, agents) {
  let score = 0
  const reasons = []

  // Role match / missing role
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

  // Idle status
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
  }

  // Memory 0..10
  if (typeof a.memoryGb === 'number' && memVals.length) {
    let memScore = 0
    if (minMem === maxMem) memScore = 5
    else memScore = ((a.memoryGb - minMem) / (maxMem - minMem)) * 10
    score += memScore
  }

  // Disk 0..5
  if (typeof a.diskFreeGb === 'number' && diskVals.length) {
    let diskScore = 0
    if (minDisk === maxDisk) diskScore = 2.5
    else diskScore = ((a.diskFreeGb - minDisk) / (maxDisk - minDisk)) * 5
    score += diskScore
  }

  return { score: Math.round((score + Number.EPSILON) * 10) / 10, reasons }
}

function recommend(selectedRole, agents) {
  if (!agents || agents.length === 0) return null

  let best = null
  let bestScore = -Infinity
  for (const a of agents) {
    const { score, reasons } = scoreAgent(selectedRole, a, agents)
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
      agentId: 'ofbiz-fresh-idle',
      id: 'ofbiz-fresh-idle',
      hostname: 'ofbiz-01.local',
      roles: ['ofbiz'],
      status: 'idle',
      cpuCount: 8,
      memoryGb: 16,
      diskFreeGb: 200,
      loadAverage: 0.2,
      lastSeen: new Date().toISOString(),
      freshnessSeconds: 0,
      isFresh: true,
    },
    {
      agentId: 'ofbiz-stale',
      id: 'ofbiz-stale',
      hostname: 'ofbiz-02.local',
      roles: ['ofbiz'],
      status: 'idle',
      cpuCount: 4,
      memoryGb: 8,
      diskFreeGb: 150,
      loadAverage: 0.1,
      lastSeen: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      freshnessSeconds: 3600,
      isFresh: false,
    },
    {
      agentId: 'other-fresh',
      id: 'other-fresh',
      hostname: 'other-01.local',
      roles: ['general'],
      status: 'idle',
      cpuCount: 4,
      memoryGb: 8,
      diskFreeGb: 100,
      loadAverage: 0.5,
      lastSeen: new Date().toISOString(),
      freshnessSeconds: 0,
      isFresh: true,
    }
  ]

  const rec = recommend('ofbiz', agents)
  if (!rec) {
    console.error('No recommendation produced')
    process.exit(1)
  }

  console.log('Recommendation winner:', rec.agentId, 'score=', rec.score)
  console.log('Reasons:')
  rec.reasons.forEach((r) => console.log(' -', r))

  if (rec.agentId !== 'ofbiz-fresh-idle') {
    console.error('SMOKE FAIL: expected ofbiz-fresh-idle to win')
    process.exit(1)
  }

  console.log('SMOKE PASS: recommended fresh idle ofbiz agent as expected')
  process.exit(0)
}

runSmoke()
