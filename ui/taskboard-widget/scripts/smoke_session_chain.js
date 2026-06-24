#!/usr/bin/env node
// Smoke test for Taskboard session chain visualization logic
// Exits 0 on success, non-zero on failure

function buildSessionTree(tasks, rootId) {
  const all = Array.isArray(tasks) ? tasks : []
  const byId = {}
  const byParent = {}
  all.forEach((t) => { byId[t.taskId] = t; const p = t.parentTaskId || null; if (!byParent[p]) byParent[p] = []; byParent[p].push(t) })
  function buildNode(id) {
    const nodeTask = byId[id] || null
    const children = (byParent[id] || []).map((c) => buildNode(c.taskId))
    return { task: nodeTask, children }
  }
  return buildNode(rootId)
}

function flatten(node) {
  const out = []
  if (!node || !node.task) return out
  out.push(node.task)
  for (const c of (node.children || [])) out.push(...flatten(c))
  return out
}

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERT FAIL:', msg)
    process.exitCode = 2
    throw new Error(msg)
  }
}

(async function main() {
  try {
    const tasks = []
    // Root task with conversation and agent1
    tasks.push({ taskId: 'root-1', title: 'Root', rootTaskId: 'root-1', parentTaskId: null, conversationId: 'conv-abc', routing: { selectedAgentId: 'agent-1', selectedHostname: 'host-1' }, context: { previousRunDirectory: '/runs/root' } })
    // Child A: has same conversation and same agent
    tasks.push({ taskId: 'child-a', title: 'Child A', rootTaskId: 'root-1', parentTaskId: 'root-1', conversationId: 'conv-abc', routing: { selectedAgentId: 'agent-1', selectedHostname: 'host-1' }, context: {} })
    // Child B: missing conversationId
    tasks.push({ taskId: 'child-b', title: 'Child B', rootTaskId: 'root-1', parentTaskId: 'root-1', routing: { selectedAgentId: 'agent-1', selectedHostname: 'host-1' }, context: {} })
    // Child C: different agent (mismatch)
    tasks.push({ taskId: 'child-c', title: 'Child C', rootTaskId: 'root-1', parentTaskId: 'root-1', conversationId: 'conv-abc', routing: { selectedAgentId: 'agent-2', selectedHostname: 'host-2' }, context: {} })

    const tree = buildSessionTree(tasks, 'root-1')
    const flat = flatten(tree).map(t => t.taskId)

    console.log('Session tree order:', flat.join(' -> '))
    // Root should be first
    assert(flat[0] === 'root-1', 'root not first')
    // child-a should be present
    assert(flat.includes('child-a'), 'child-a missing')
    // child-b exists and has missing conversation
    const childB = tasks.find(t => t.taskId === 'child-b')
    assert(childB && !childB.conversationId, 'child-b should be missing conversationId')
    // detect missing conversation in presence of parent conversation
    const parent = tasks.find(t => t.taskId === 'root-1')
    assert(parent && parent.conversationId, 'parent should have conversationId')
    // detect agent mismatch for child-c
    const childC = tasks.find(t => t.taskId === 'child-c')
    assert(childC && childC.routing && childC.routing.selectedAgentId === 'agent-2', 'child-c agent mismatch test setup failed')

    // Now emulate the same checks the UI would perform
    let detectedMissing = false
    let detectedMismatch = false
    function walk(node, parentTask) {
      if (!node || !node.task) return
      const t = node.task
      if (!t.conversationId && parentTask && !!parentTask.conversationId) detectedMissing = true
      if (parentTask && parentTask.routing && t.routing && parentTask.routing.selectedAgentId !== t.routing.selectedAgentId) detectedMismatch = true
      for (const c of (node.children || [])) walk(c, t)
    }
    walk(tree, null)

    assert(detectedMissing, 'failed to detect missing conversation for child-b')
    assert(detectedMismatch, 'failed to detect agent mismatch for child-c')

    console.log('SMOKE PASS: session chain logic OK')
    process.exit(0)
  } catch (e) {
    console.error('SMOKE FAIL:', e && e.message)
    process.exit(process.exitCode || 1)
  }
})()
