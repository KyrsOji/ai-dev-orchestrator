import { Agent, AgentRecommendation } from './types'

// Pure recommendation function — scores agents for a given role
export function recommendAgent(selectedRole: string, agents: Agent[]): AgentRecommendation {
  if (!agents || agents.length === 0) {
    return { agentId: '', hostname: '', score: -Infinity, reasons: ['no agents available'] }
  }

  // gather metric arrays for normalization
  const loadVals = agents.map((a) => (typeof a.loadAverage === 'number' ? a.loadAverage : NaN)).filter((n) => !Number.isNaN(n))
  const memVals = agents.map((a) => (typeof a.memoryGb === 'number' ? a.memoryGb : NaN)).filter((n) => !Number.isNaN(n))
  const diskVals = agents.map((a) => (typeof a.diskFreeGb === 'number' ? a.diskFreeGb : NaN)).filter((n) => !Number.isNaN(n))

  const minLoad = loadVals.length ? Math.min(...loadVals) : 0
  const maxLoad = loadVals.length ? Math.max(...loadVals) : 0
  const minMem = memVals.length ? Math.min(...memVals) : 0
  const maxMem = memVals.length ? Math.max(...memVals) : 0
  const minDisk = diskVals.length ? Math.min(...diskVals) : 0
  const maxDisk = diskVals.length ? Math.max(...diskVals) : 0

  let best: AgentRecommendation | null = null
  let bestScore = -Infinity

  for (const a of agents) {
    let score = 0
    const reasons: string[] = []

    // Role match / missing role (strong penalty)
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

    // Lower load: normalized 0..20 (lower is better)
    if (typeof a.loadAverage === 'number' && loadVals.length) {
      let loadScore = 0
      if (minLoad === maxLoad) loadScore = 10 // neutral when all equal
      else loadScore = ((maxLoad - a.loadAverage) / (maxLoad - minLoad)) * 20
      score += loadScore
      if (a.loadAverage === minLoad) reasons.push('Lowest load')
      else reasons.push('Lower load')
    }

    // Memory available: normalized 0..10 (higher is better)
    if (typeof a.memoryGb === 'number' && memVals.length) {
      let memScore = 0
      if (minMem === maxMem) memScore = 5
      else memScore = ((a.memoryGb - minMem) / (maxMem - minMem)) * 10
      score += memScore
      if (a.memoryGb === maxMem) reasons.push('Most memory')
      else reasons.push('Memory available')
    }

    // Disk available: normalized 0..5 (higher is better)
    if (typeof a.diskFreeGb === 'number' && diskVals.length) {
      let diskScore = 0
      if (minDisk === maxDisk) diskScore = 2.5
      else diskScore = ((a.diskFreeGb - minDisk) / (maxDisk - minDisk)) * 5
      score += diskScore
      if (a.diskFreeGb === maxDisk) reasons.push('Most disk')
      else reasons.push('Disk available')
    }

    const rounded = Math.round((score + Number.EPSILON) * 10) / 10

    if (rounded > bestScore) {
      bestScore = rounded
      best = { agentId: a.agentId || a.id || '', hostname: a.hostname || '', score: rounded, reasons }
    }
  }

  return best || { agentId: '', hostname: '', score: -Infinity, reasons: ['no suitable agent'] }
}
