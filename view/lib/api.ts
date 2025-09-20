import { CreateProjectRequest, CreateProjectResponse, DeployRequest, DeployResponse, LogsResponse, ApiResponse } from '@/types/api'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return response.json()
  }

  async createProject(data: CreateProjectRequest): Promise<ApiResponse<CreateProjectResponse>> {
    return this.request('/project', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deployProject(data: DeployRequest): Promise<ApiResponse<DeployResponse>> {
    return this.request('/deploy', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getLogs(deploymentId: string): Promise<ApiResponse<LogsResponse>> {
    return this.request(`/logs/${deploymentId}`)
  }
}

export const apiClient = new ApiClient()
