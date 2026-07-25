import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { CreatePageInput, Page, PageNode } from '../types'

export async function fetchTree(signal?: AbortSignal): Promise<PageNode[]> {
  const { data } = await apiClient.get<ApiEnvelope<PageNode[]>>('/pages', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function fetchPage(pageId: string, signal?: AbortSignal): Promise<Page> {
  const { data } = await apiClient.get<ApiEnvelope<Page>>(`/pages/${pageId}`, {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function createPage(input: CreatePageInput): Promise<Page> {
  const { data } = await apiClient.post<ApiEnvelope<Page>>('/pages', input)
  return unwrap(data)
}

export async function deletePage(pageId: string): Promise<number> {
  const { data } = await apiClient.delete<ApiEnvelope<number>>(`/pages/${pageId}`)
  return unwrap(data)
}

export async function movePage(
  pageId: string,
  input: { parentId: string | null; afterPageId?: string },
): Promise<void> {
  await apiClient.post(`/pages/${pageId}/move`, input)
}
