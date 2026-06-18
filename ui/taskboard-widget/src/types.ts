export type ActionType = 'commit' | 'push' | 'docs' | 'test' | 'manual'

export interface ProposedAction {
  id: string
  type: ActionType | string
  description: string
  payload?: any
}

export type MessageAuthor = 'user' | 'system' | 'reviewer' | 'openhands' | 'runner'

export interface Message {
  id: string
  author: MessageAuthor
  text: string
  createdAt?: string
  data?: any
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
  // routing information for multi-agent readiness
  routing?: {
    selectedAgentId?: string
    selectedHostname?: string
    selectedRole?: string
  }
  // last update time
  updatedAt?: string
  // Chat/thread messages (optional)
  messages?: Message[]
}

export interface Agent {
  agentId: string
  id?: string
  hostname: string
  roles: string[]
  status?: string
  cpuCount?: number
  memoryGb?: number
  diskFreeGb?: number
  loadAverage?: number
  lastSeen?: string
  freshnessSeconds?: number
  isFresh?: boolean
  raw?: any
}

