import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth'
import * as tokenApi from '../service/tokenApi'
import type { CreateApiTokenInput } from '../types'
import { workspaceKeys } from './useMembers'

// ═══════════════════════════════════════════════════════════════════════════
//  API token ของ workspace ปัจจุบัน
//
//  ⚠️ ค่าจริงของ token ที่เพิ่งสร้างไม่ถูกเก็บลง query cache — mutateAsync คืน
//     ให้ผู้เรียกเอาไปถือใน component state เท่านั้น
//
//     react-query cache เป็นที่ที่ของอยู่นานกว่าที่คิด (มี devtools อ่านได้
//     และถ้าวันหนึ่งใส่ persister มันจะไหลลง localStorage ทันทีโดยไม่มีใคร
//     ทบทวนเรื่องนี้ซ้ำ) ความลับที่แสดงครั้งเดียวควรตายไปพร้อมกับ component
// ═══════════════════════════════════════════════════════════════════════════

export const tokenKeys = {
  all: (workspaceId: string) => [...workspaceKeys.current(workspaceId), 'tokens'] as const,
}

export function useApiTokens() {
  const { currentWorkspace } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useQuery({
    queryKey: tokenKeys.all(workspaceId),
    queryFn: ({ signal }) => tokenApi.listApiTokens(signal),
    enabled: workspaceId !== '',
  })
}

function useTokenMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  const { currentWorkspace } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tokenKeys.all(workspaceId) })
    },
  })
}

export function useCreateApiToken() {
  return useTokenMutation((input: CreateApiTokenInput) => tokenApi.createApiToken(input))
}

export function useRevokeApiToken() {
  return useTokenMutation((tokenId: string) => tokenApi.revokeApiToken(tokenId))
}
