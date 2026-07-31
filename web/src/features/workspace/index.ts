// ═══════════════════════════════════════════════════════════════════════════
//  barrel — public surface เดียวของ feature นี้
//  ข้างนอกต้อง import จากที่นี่ ห้ามเจาะเข้า service/ หรือ hooks/ ตรง ๆ
//  (บังคับด้วย eslint-plugin-boundaries)
// ═══════════════════════════════════════════════════════════════════════════
export { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
export { WorkspaceSettings } from './components/WorkspaceSettings'
export { MemberSettings } from './components/MemberSettings'
export { AiConnectionSettings } from './components/AiConnectionSettings'

export { useCreateWorkspace } from './hooks/useWorkspaces'
export {
  useCurrentWorkspace, useMembers, useUpdateWorkspace,
  useAddMember, useUpdateMemberRole, useRemoveMember, workspaceKeys,
} from './hooks/useMembers'
export {
  useApiTokens, useCreateApiToken, useRevokeApiToken, tokenKeys,
} from './hooks/useApiTokens'

export type {
  WorkspaceSummary, WorkspaceRole, CreateWorkspaceInput,
  WorkspaceDetail, UpdateWorkspaceInput, Member, AddMemberInput, UserKind,
  ApiToken, ApiTokenStatus, CreatedApiToken, CreateApiTokenInput,
} from './types'
export { ROLE_LABELS, ASSIGNABLE_ROLES } from './types'
