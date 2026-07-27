import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { ActivityFeed, ActivityQuery, Note } from '../types'

export async function fetchActivity(
  query: ActivityQuery,
  signal?: AbortSignal,
): Promise<ActivityFeed> {
  const params = new URLSearchParams()
  if (query.pageId !== undefined) params.set('pageId', query.pageId)
  if (query.actorKind !== undefined) params.set('actorKind', query.actorKind)
  if (query.limit !== undefined) params.set('limit', String(query.limit))

  const suffix = params.size > 0 ? `?${params.toString()}` : ''

  const { data } = await apiClient.get<ApiEnvelope<ActivityFeed>>(`/activity${suffix}`, {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function fetchNotes(pageId: string, signal?: AbortSignal): Promise<Note[]> {
  const { data } = await apiClient.get<ApiEnvelope<Note[]>>(`/pages/${pageId}/notes`, {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function addNote(pageId: string, body: string): Promise<Note> {
  const { data } = await apiClient.post<ApiEnvelope<Note>>(`/pages/${pageId}/notes`, { body })
  return unwrap(data)
}
