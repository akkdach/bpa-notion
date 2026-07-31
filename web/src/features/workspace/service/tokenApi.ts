import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { ApiToken, CreateApiTokenInput, CreatedApiToken } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  API token ของ workspace ปัจจุบัน
//
//  ไม่มี GET รายใบโดยเจตนา — ไม่มีอะไรให้ดูเพิ่มจากในลิสต์ และการมี endpoint
//  รายใบชวนให้คนเข้าใจผิดว่าขอค่าจริงคืนได้
// ═══════════════════════════════════════════════════════════════════════════

export async function listApiTokens(signal?: AbortSignal): Promise<ApiToken[]> {
  const { data } = await apiClient.get<ApiEnvelope<ApiToken[]>>('/workspaces/current/tokens', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function createApiToken(input: CreateApiTokenInput): Promise<CreatedApiToken> {
  const { data } = await apiClient.post<ApiEnvelope<CreatedApiToken>>(
    '/workspaces/current/tokens',
    input,
  )
  return unwrap(data)
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await apiClient.delete(`/workspaces/current/tokens/${tokenId}`)
}
