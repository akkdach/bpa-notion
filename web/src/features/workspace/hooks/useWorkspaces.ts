import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/features/auth'
import { createWorkspace } from '../service/workspaceApi'
import type { CreateWorkspaceInput } from '../types'

/**
 * สร้าง workspace แล้วสลับไปที่ตัวใหม่ทันที
 *
 * ต้อง refreshWorkspaces ก่อน selectWorkspace เพราะ AuthProvider ตรวจว่า
 * id ที่เลือกอยู่ในรายการที่เป็นสมาชิกจริงหรือไม่
 */
export function useCreateWorkspace() {
  const { refreshWorkspaces, selectWorkspace } = useAuth()

  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => createWorkspace(input),
    onSuccess: async (workspace) => {
      await refreshWorkspaces()
      selectWorkspace(workspace.id)
    },
  })
}
