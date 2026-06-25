export async function fetchTasks() {
  const res = await fetch('/taskboard/api/tasks')
  if (!res.ok) throw new Error('Failed to fetch tasks')
  return res.json()
}

export async function fetchFollowups() {
  const res = await fetch('/taskboard/api/followups')
  if (!res.ok) throw new Error('Failed to fetch followups')
  return res.json()
}

export async function fetchRunnerStatus() {
  const res = await fetch('/taskboard/api/runner-status')
  if (!res.ok) throw new Error('Failed to fetch runner status')
  return res.json()
}

export async function fetchAgents() {
  const res = await fetch('/taskboard/api/agents')
  if (!res.ok) throw new Error('Failed to fetch agents')
  return res.json()
}
