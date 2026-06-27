#!/usr/bin/env node
'use strict'

// Fetch live agents endpoint and compute recommendation for role 'ofbiz'
// Uses same scoring logic as smoke test.

async function fetchAgents(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
  return res.json()
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

  if (a.isFresh) { score += 25; reasons.push('Fresh heartbeat') } else { score -= 100; reasons.push('Stale') }
  if (a.status === 'idle') { score += 25; reasons.push('Idle') }

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

async function main() {
  const url = 'https://obiz.yahlife.com/taskboard/api/agents'
  try {
    const data = await fetchAgents(url)
    const agents = Array.isArray(data) ? data : (Array.isArray(data.agents) ? data.agents : [])
    if (!Array.isArray(agents)) {
      console.error('Unexpected response shape from agents endpoint')
      process.exit(2)
    }
    const rec = recommend('ofbiz', agents)
    console.log('Live recommendation result:', rec)
    if (rec && rec.agentId === 'ofbiz-dev-01') {
      console.log('LIVE CHECK PASS: recommended ofbiz-dev-01 as expected')
      process.exit(0)
    } else {
      console.error('LIVE CHECK FAIL: expected ofbiz-dev-01, got', rec && rec.agentId)
      process.exit(1)
    }
  } catch (e) {
    console.error('LIVE CHECK ERROR:', e.message || e)
    process.exit(3)
  }
}

main()
