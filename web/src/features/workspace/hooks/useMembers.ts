import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth'
import * as memberApi from '../service/memberApi'
import type { AddMemberInput, UpdateWorkspaceInput, WorkspaceRole } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ข้อมูล workspace ปัจจุบันและสมาชิก
//
//  key ผูกกับ workspace ที่เลือกอยู่ ไม่ใช่ key คงที่ — สลับ workspace แล้วต้อง
//  โหลดใหม่ ไม่ใช่โชว์ของเก่าค้างไว้ (AuthProvider เรียก queryClient.clear()
//  ตอนสลับอยู่แล้ว แต่ key ที่ถูกต้องทำให้ไม่ต้องพึ่งข้อเท็จจริงนั้น)
// ═══════════════════════════════════════════════════════════════════════════

export const workspaceKeys = {
  current: (workspaceId: string) => ['workspace', workspaceId] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
}

export function useCurrentWorkspace() {
  const { currentWorkspace } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useQuery({
    queryKey: workspaceKeys.current(workspaceId),
    queryFn: ({ signal }) => memberApi.getCurrentWorkspace(signal),
    enabled: workspaceId !== '',
  })
}

export function useMembers() {
  const { currentWorkspace } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: ({ signal }) => memberApi.listMembers(signal),
    enabled: workspaceId !== '',
  })
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient()
  const { currentWorkspace, refreshWorkspaces } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => memberApi.updateCurrentWorkspace(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.current(workspaceId) })
      // ⚠️ ชื่อ workspace โผล่ใน switcher ด้วย ซึ่งมาจาก AuthProvider ไม่ใช่ query นี้
      //    ไม่รีเฟรชตรงนี้ด้วย ผู้ใช้จะเปลี่ยนชื่อแล้วเห็นชื่อเก่าค้างในแถบข้าง
      await refreshWorkspaces()
    },
  })
}

/** invalidate ทั้ง members และ current เพราะ memberCount อยู่ใน current */
function useMemberMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient()
  const { currentWorkspace } = useAuth()
  const workspaceId = currentWorkspace?.id ?? ''

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.current(workspaceId) })
    },
  })
}

export function useAddMember() {
  return useMemberMutation((input: AddMemberInput) => memberApi.addMember(input))
}

export function useUpdateMemberRole() {
  return useMemberMutation(
    ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      memberApi.updateMemberRole(userId, role),
  )
}

export function useRemoveMember() {
  return useMemberMutation((userId: string) => memberApi.removeMember(userId))
}
