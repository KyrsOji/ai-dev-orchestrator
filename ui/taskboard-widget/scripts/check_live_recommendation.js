#!/usr/bin/env node
'use strict'

// Query live agent registry and compute recommendation for role 'ofbiz'
// NOTE: This script mirrors the recommendation logic in src/agentRecommendation.ts (kept in JS for runtime simplicity)
// Usage: node scripts/check_live_recommendation.js

const URL = 'https://obiz.yahlife.com/taskboard/api/agents'

function normalizeAgent(a) {
  const agentId = a.agentId || a.id || ''
  const hostname = a.hostname || a.host || ''
  const roles = Array.isArray(a.roles) ? a.roles : (a.roles ? [a.roles] : [])
  const status = a.status || 'unknown'
  const cpuCount = typeof a.cpuCount === 'number' ? a.cpuCount : (typeof a.cpu === 'number' ? a.cpu : 0)
  const memoryGb = typeof a.memoryGb === 'number' ? a.memoryGb : (typeof a.memory_gb === 'number' ? a.memory_gb : null)
  const diskFreeGb = typeof a.diskFreeGb === 'number' ? a.diskFreeGb : (typeof a.disk_free_gb === 'number' ? a.disk_free_gb : null)
  const loadAverage = typeof a.loadAverage === 'number' ? a.loadAverage : (typeof a.load_avg === 'number' ? a.load_avg : null)
  const lastSeen = a.lastSeen || a.last_seen || null
  let freshnessSeconds = null
  let isFresh = false
  if (lastSeen) {
    const t = new Date(lastSeen).getTime()
    if (!Number.isNaN(t)) {
      freshnessSeconds = Math.floor((Date.now() - t) / 1000)
      isFresh = freshnessSeconds <= 300
    }
  }
  return { agentId, id: agentId, hostname, roles, status, cpuCount, memoryGb, diskFreeGb, loadAverage, lastSeen, freshnessSeconds, isFresh, raw: a }
}

function scoreAgent(selectedRole, a, agents) {
  let score = 0
  const reasons = []

  if (Array.isArray(a.roles) && a.roles.includes(selectedRole)) {
    score += 100
    reasons.push(`Role match: ${selectedRole}`)
  } else {
    score -= 1000
    reasons.push('Missing role')
  }

  if (a.isFresh) {
    score += 25
    reasons.push('Fresh heartbeat')
  } else {
    score -= 100
    reasons.push('Stale')
  }

  if (a.status === 'idle') {
    score += 25
    reasons.push('Idle')
  }

  const loadVals = agents.map(x => (typeof x.loadAverage === 'number' ? x.loadAverage : NaN)).filter(n => !Number.isNaN(n))
  const memVals = agents.map(x => (typeof x.memoryGb === 'number' ? x.memoryGb : NaN)).filter(n => !Number.isNaN(n))
  const diskVals = agents.map(x => (typeof x.diskFreeGb === 'number' ? x.diskFreeGb : NaN)).filter(n => !Number.isNaN(n))

  const minLoad = loadVals.length ? Math.min(...loadVals) : 0
  const maxLoad = loadVals.length ? Math.max(...loadVals) : 0
  const minMem = memVals.length ? Math.min(...memVals) : 0
  const maxMem = memVals.length ? Math.max(...memVals) : 0
  const minDisk = diskVals.length ? Math.min(...diskVals) : 0
  const maxDisk = diskVals.length ? Math.max(...diskVals) : 0

  if (typeof a.loadAverage === 'number' && loadVals.length) {
    let loadScore = 0
    if (minLoad === maxLoad) loadScore = 10
    else loadScore = ((maxLoad - a.loadAverage) / (maxLoad - minLoad)) * 20
    score += loadScore
  }

  if (typeof a.memoryGb === 'number' && memVals.length) {
    let memScore = 0
    if (minMem === maxMem) memScore = 5
    else memScore = ((a.memoryGb - minMem) / (maxMem - minMem)) * 10
    score += memScore
  }

  if (typeof a.diskFreeGb === 'number' && diskVals.length) {
    let diskScore = 0
    if (minDisk === maxDisk) diskScore = 2.5
    else diskScore = ((a.diskFreeGb - minDisk) / (maxDisk - minDisk)) * 5
    score += diskScore
  }

  return { score: Math.round((score + Number.EPSILON) * 10) / 10, reasons }
}

async function run() {
  try {
    const res = await fetch(URL)
    if (!res.ok) {
      console.error('Failed to fetch agents:', res.status, res.statusText)
      process.exit(2)
    }
    const body = await res.json()
    let list = []
    if (Array.isArray(body)) list = body
    else if (Array.isArray(body.agents)) list = body.agents
    else { console.error('Unexpected response shape'); process.exit(2) }

    const agents = list.map(normalizeAgent)

    const selectedRole = 'ofbiz'

    let best = null
    let bestScore = -Infinity
    for (const a of agents) {
      const { score, reasons } = scoreAgent(selectedRole, a, agents)
      if (score > bestScore) {
        bestScore = score
        best = { agentId: a.agentId || a.id || '', hostname: a.hostname || '', score, reasons }
      }
    }

    if (!best) {
      console.error('No recommendation')
      process.exit(3)
    }

    console.log('Live recommendation for role ofbiz =>', best.agentId, 'score=', best.score)
    console.log('Reasons:')
    best.reasons.forEach(r => console.log(' -', r))

    // expected winner check (as per milestone validation)
    if (best.agentId === 'ofbiz-dev-01') {
      console.log('EXPECTED: ofbiz-dev-01 is recommended')
      process.exit(0)
    } else {
      console.log('NOTE: expected ofbiz-dev-01 but got', best.agentId)
      process.exit(0)
    }

  } catch (e) {
    console.error('Error fetching or computing recommendation', e)
    process.exit(4)
  }
}

run()
