export type ActionType = 'commit' | 'push' | 'docs' | 'test' | 'manual'

export interface ProposedAction {
  id: string
  type: ActionType | string
  description: string
  payload?: any
}

export interface Task {
  taskId: string
  title: string
  status: 'pending_review' | 'approved' | 'completed' | 'deferred' | 'denied'
  openhandsResponse: string
  reviewerSummary: string
  proposedActions: ProposedAction[]
  selectedAction: string | null
  notes: string
}
