export interface ApiResponse<T = any> {
  status: 'success' | 'error' | 'queued'
  data?: T
  error?: string | any
  message?: string
  details?: any
}

export interface CreateProjectRequest {
  name: string
  gitURL: string
}

export interface CreateProjectResponse {
  project: {
    id: string
    name: string
    gitURL: string
    subDomain: string
  }
}

export interface DeployRequest {
  projectId: string
}

export interface DeployResponse {
  deploymentId: string
}

export interface LogsResponse {
  logs: LogEntry[]
}

export interface LogEntry {
  event_id: string
  deployment_id: string
  log: string
  timestamp: string
}
