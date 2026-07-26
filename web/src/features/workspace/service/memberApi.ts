import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type {
  AddMemberInput, Member, UpdateWorkspaceInput, WorkspaceDetail, WorkspaceRole,
} from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  workspace ปัจจุบัน + สมาชิก
//
//  ทุก endpoint ที่นี่ผูกกับ workspace — apiClient แนบ X-Workspace-Id ให้เอง
//  จาก tokenStore จึงไม่ต้องส่ง id ใน path (เซิร์ฟเวอร์ใช้คำว่า "current")
// ═══════════════════════════════════════════════════════════════════════════

export async function getCurrentWorkspace(signal?: AbortSignal): Promise<WorkspaceDetail> {
  const { data } = await apiClient.get<ApiEnvelope<WorkspaceDetail>>('/workspaces/current', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function updateCurrentWorkspace(
  input: UpdateWorkspaceInput,
): Promise<WorkspaceDetail> {
  const { data } = await apiClient.patch<ApiEnvelope<WorkspaceDetail>>('/workspaces/current', input)
  return unwrap(data)
}

export async function listMembers(signal?: AbortSignal): Promise<Member[]> {
  const { data } = await apiClient.get<ApiEnvelope<Member[]>>('/workspaces/current/members', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function addMember(input: AddMemberInput): Promise<Member> {
  const { data } = await apiClient.post<ApiEnvelope<Member>>('/workspaces/current/members', input)
  return unwrap(data)
}

export async function updateMemberRole(userId: string, role: WorkspaceRole): Promise<void> {
  await apiClient.patch(`/workspaces/current/members/${userId}`, { role })
}

export async function removeMember(userId: string): Promise<void> {
  await apiClient.delete(`/workspaces/current/members/${userId}`)
}
