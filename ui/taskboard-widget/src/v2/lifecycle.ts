export const STAGES = [
  'Conversation',
  'Decision',
  'Approved',
  'Dispatched',
  'Running',
  'Evidence',
  'Reviewed',
  'Complete'
]

const COMPLETED_STATES = new Set(['completed', 'executed', 'dry_run_completed', 'finished', 'success'])

export function determineStage(task: any): string {
  if (!task) return 'Conversation'

  const status = (task.status || '').toString().toLowerCase()
  const exec = task.executionReport || null
  const execStatus = (exec && (exec.status || exec.executionStatus)) ? String(exec.status || exec.executionStatus).toLowerCase() : (task.executionStatus ? String(task.executionStatus).toLowerCase() : '')

  // If a follow-up decision is active for a completed task, treat it as a Decision lifecycle for the follow-up
  try {
    if (task && (String(task.status).toLowerCase() === 'followup' || (task.followUp && task.followUp.active))) {
      return 'Decision'
    }
  } catch (e) {}

  // 1) Completed
  if (
    task.completed === true ||
    task.completedAt ||
    COMPLETED_STATES.has(status) ||
    (execStatus && COMPLETED_STATES.has(execStatus)) ||
    (exec && (exec.completedAt || (exec.status && COMPLETED_STATES.has(String(exec.status).toLowerCase()))))
  ) {
    return 'Complete'
  }

  // 2) Reviewer completed
  if (
    (task.reviewerSummary && String(task.reviewerSummary).trim().length > 0) ||
    (task.reviewerDecision && String(task.reviewerDecision).toLowerCase() === 'approved')
  ) {
    return 'Reviewed'
  }

  // 3) Execution evidence exists
  if (exec && Object.keys(exec).length > 0) return 'Evidence'

  // 4) Execution running
  if (execStatus === 'running' || status === 'running') return 'Running'

  // 5) Dispatched
  if (task.dispatched === true || task.dispatchedAt) return 'Dispatched'

  // 6) Approved
  if (status === 'approved' || task.executionApproved === true || (task.decision && String(task.decision).toLowerCase() === 'approved')) return 'Approved'

  // 7) Decision
  if (Array.isArray(task.proposedActions) && task.proposedActions.length > 0) return 'Decision'

  // default
  return 'Conversation'
}
