import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { CreateWorkspaceInput, WorkspaceSummary } from '../types'

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
  const { data } = await apiClient.post<ApiEnvelope<WorkspaceSummary>>('/workspaces', input)
  return unwrap(data)
}

export async function listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
  const { data } = await apiClient.get<ApiEnvelope<WorkspaceSummary[]>>('/workspaces', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}
